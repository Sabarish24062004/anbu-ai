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
| Jobs          | pg-boss                                                                      | Durable jobs stored in Postgres; no Redis                                                                         |
| Dates         | luxon                                                                        | Timezone/DST-correct trigger calculation                                                                          |
| LLM           | Adapter interface; default = free hosted tier (e.g. Gemini); Ollama optional | Dev PC (7.7 GB RAM, 2 GB GPU) is too small for a good local Tamil model                                           |

## Assistant flow

user text/transcript → language layer (detect script, normalise Tanglish, deterministic date extraction)
→ LLM chooses a whitelisted tool with JSON args → zod validation → clarification/confirmation if needed
→ service call (scoped to authenticated user, idempotency key) → reply generated from the tool result.

## Reminder flow

create/update event → transaction (event + reminders) → trigger = local start − lead, converted to UTC
→ pg-boss job keyed by reminder id (idempotent) → worker marks processing → delivery attempt logged
→ status sent/failed. Event cancel/reschedule cancels and re-registers jobs. App mirrors upcoming
reminders as local notifications. Delivery is best-effort and reported honestly in the UI.

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
- **Not yet:** rate limiting on `/auth` (Phase 7), cleanup of expired idempotency keys and refresh
  tokens (Phase 3 jobs), reminder rows (Phase 3).

## Milestone plan

0. Discovery ✅
1. Foundation: monorepo, lint/format, Prisma schema + migration, env, /health, mobile ↔ API check
2. Auth + events/tasks/important dates + conflicts + timezone tests
3. Reminders (pg-boss, restart recovery, dedupe, local notifications)
4. Assistant tool-calling
5. Tamil/English voice
6. Memory + daily planning
7. Hardening + release
