# Anbu AI — Architecture (Phase 0)

## Principles

- Database + deterministic scheduler are the source of truth. The LLM interprets and explains; it never owns state.
- Scheduling, reminders and manual CRUD work with the LLM and voice services offline.
- Every mutation: validated (zod) → transactional → idempotent → response built from the real result.

## Components

| Layer         | Choice                                                                       | Notes                                                                                                             |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mobile        | Expo (SDK 57) + React Native + TypeScript + Expo Router                      | React Query for server state, Zustand for UI state, expo-secure-store for tokens                                  |
| Notifications | expo-notifications (local)                                                   | Remote push needs a dev build; Expo Go supports local only                                                        |
| TTS           | expo-speech (adapter)                                                        | Tamil depends on the device having a ta-IN voice — verify per device                                              |
| STT           | expo-speech-recognition (adapter)                                            | Requires a development build (EAS); text fallback always available                                                |
| API           | Node 24 + Express 5 + TypeScript                                             | Modules: auth, users, preferences, events, tasks, important-dates, reminders, scheduling, assistant, ai-providers |
| DB            | PostgreSQL 18 (local service) + Prisma                                       | UUID ids, UTC timestamps + user IANA timezone, recurrence stored as local-time rules                              |
| Jobs          | In-process reminder worker over the `Reminder` table                         | `FOR UPDATE SKIP LOCKED` claims; no Redis, no pg-boss (see Phase 3 decisions)                                     |
| Dates         | luxon                                                                        | Timezone/DST-correct trigger calculation                                                                          |
| LLM           | Adapter interface; default = free hosted tier (e.g. Gemini); Ollama optional | Dev PC (7.7 GB RAM, 2 GB GPU) is too small for a good local Tamil model                                           |

## Assistant flow

user text/transcript → language layer (detect script, normalise Tanglish, deterministic date extraction)
→ LLM chooses a whitelisted tool with JSON args → zod validation → clarification/confirmation if needed
→ service call (scoped to authenticated user, idempotency key) → reply generated from the tool result.

## Reminder flow

create/update/cancel an event, task or important date → one transaction writes the item and
reconciles its reminder rows for the next 7 days (keyed by occurrence + offset) → the worker claims
due rows (`PENDING → PROCESSING`, `FOR UPDATE SKIP LOCKED`), delivers, logs a delivery attempt and
marks them `SENT` (or retries, then `FAILED`) → the app lists them under "Due now". Separately, the
app schedules the next 72 hours of `PENDING` reminders as local notifications, which is what alerts
the user while the app is closed.

## Decisions (2026-10-10)

- Repo: separate monorepo at `C:\Users\hp\anbu-ai` (npm workspaces).
- LLM default: free hosted tier; Ollama optional adapter.
- Test devices: Android and iPhone.
- Default timezone Asia/Kolkata; default reminder lead 15 min.

## API (Phase 2)

All routes except `/health` and `/auth/*` need `Authorization: Bearer <accessToken>` and only ever
see the signed-in user's rows. Errors are `{ error: { code, message, details? } }`.

| Route                                                               | Notes                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /auth/register` · `/login` · `/refresh` · `/logout`           | Access JWT (15 min) + opaque refresh token (30 days)    |
| `GET/PATCH /me`, `PATCH /me/preferences`                            | Profile, timezone, language, reminder/work preferences  |
| `GET /events?from&to`                                               | Occurrences in range (recurrences expanded), ≤ 366 days |
| `POST /events`, `GET/PATCH/DELETE /events/:id`                      | 409 `SCHEDULE_CONFLICT` unless `allowConflicts: true`   |
| `POST /events/:id/cancel` · `/complete`                             | Repeating the same transition is a no-op                |
| `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST …/complete` | Dependencies (`blockedById`), recurring tasks           |
| `GET/POST /important-dates`, `GET …/upcoming?days`, `…/:id`         | Birthdays, anniversaries, one-off dates                 |

Mutating requests may send an `Idempotency-Key` header (8–128 URL-safe chars); a repeat with the same
body replays the stored response (`Idempotent-Replayed: true`), a different body gets 422.

### Phase 2 decisions

- **Times.** Clients send local wall-clock times (`2027-01-04T07:00`) interpreted in the record's
  timezone, or an instant with an offset. Responses use the record's offset
  (`2027-01-04T07:00:00.000+05:30`). Changing only an event's timezone keeps the instant.
- **Recurrence.** A subset of RFC 5545: `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY`
  (weekly), `COUNT` or `UNTIL`. Expanded in local time, so 09:00 stays 09:00 across DST. Months
  without the start day (31st, Feb 29) are skipped, per the RFC. Editing a single occurrence is not
  supported yet.
- **Conflicts** are advisory: overlapping timed events (busy span = start − travel − prep → end)
  return 409 with the clashing occurrences, so the app or assistant can ask before saving with
  `allowConflicts`. Back-to-back events do not clash; all-day and cancelled events never do.
  Recurring events are checked 90 days ahead.
- **Recurring tasks.** Completing one moves it to the next due date (reducing `COUNT`); it closes
  when the rule runs out. A task cannot be completed while its blocker is open.
- **Important dates.** Feb 29 is observed on Feb 28 in common years; "today" is computed in the
  date's own timezone.
- **Auth.** scrypt password hashes (OWASP parameters, stored per hash). Refresh tokens are single-use
  and rotated; replaying a used one revokes that sign-in's whole token family. Clients must not
  refresh concurrently. Login responses do not reveal whether an email exists.
- **Not yet (Phase 2):** rate limiting on `/auth` (Phase 7), cleanup of expired idempotency keys and refresh
  tokens (Phase 3 jobs), reminder rows (Phase 3).

## Reminders (Phase 3)

| Route                             | Notes                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `GET /reminders/upcoming?hours`   | `PENDING` reminders to schedule on the phone (default 72 h) |
| `GET /reminders/due`              | Fired in the last 24 h and not yet acknowledged             |
| `POST /reminders/:id/acknowledge` | `{ action: "COMPLETED" \| "DISMISSED" }`                    |
| `POST /reminders/:id/snooze`      | `{ minutes }`; only after the reminder has fired            |

### Phase 3 decisions

- **No pg-boss.** The `Reminder` table is already the durable queue. A second job store would have
  to be kept in sync on every edit, cancel and snooze. The worker runs inside the API process
  (`REMINDER_WORKER_ENABLED`, `REMINDER_POLL_SECONDS`, default 30 s) and is safe to run in several
  processes at once.
- **Rolling 7-day horizon.** Rows are created for triggers within 7 days; an hourly pass (and one at
  startup) extends it, so recurring items never need unbounded rows.
- **Exactly once.** Rows are unique per (item, occurrence, offset); state changes are conditional, so a
  reminder is delivered once even with overlapping workers. Re-planning never resurrects a sent
  reminder and never undoes a snooze.
- **Restart recovery.** Rows stuck in `PROCESSING` for 5 minutes return to `PENDING`. A reminder whose
  occurrence started more than 10 minutes ago is marked `FAILED` with `MISSED` rather than sent late.
- **Too-late reminders.** If an item is created after its reminder time (e.g. an event in 5 minutes
  with a 15-minute lead), one reminder fires immediately.
- **Date-only items** (birthdays, all-day events) remind at the user's `importantDateNotifyMinutes`
  (default 09:00) in the item's timezone; changing that preference re-plans them.
- **Delivery channels.** `IN_APP` (the "Due now" list) on the server, plus local notifications
  scheduled by the app (work in Expo Go). Remote push needs a development build and slots in as
  another `ReminderChannel` later. The iOS limit of 64 pending notifications is respected (60).
- **UTC sessions.** The Prisma pg adapter sends timestamps without an offset, so a non-UTC Postgres
  session time zone stored every instant shifted (here by −5:30) while Prisma round-trips still
  looked right. Every connection now runs with `TimeZone=UTC`; a regression test checks the stored
  value and `now()` agree.

## Milestone plan

0. Discovery ✅
1. Foundation: monorepo, lint/format, Prisma schema + migration, env, /health, mobile ↔ API check
2. Auth + events/tasks/important dates + conflicts + timezone tests
3. Reminders (worker, restart recovery, dedupe, local notifications) ✅
4. Assistant tool-calling
5. Tamil/English voice
6. Memory + daily planning
7. Hardening + release
