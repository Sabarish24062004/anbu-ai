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
| TTS           | expo-speech                                                                  | Tamil depends on the device having a ta-IN voice; Settings warns when it is missing                               |
| STT           | Recorded on the phone (expo-audio), transcribed by Gemini on the server      | Works in Expo Go; on-device recognition would need a development build                                            |
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

## Assistant (Phase 4)

| Route                                                             | Notes                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /assistant/status`                                           | `{ available }`: whether a model is configured        |
| `POST /assistant/messages`                                        | `{ conversationId?, text }` → reply, actions, pending |
| `GET /assistant/conversations/latest` · `/:id`                    | Messages and any action awaiting confirmation         |
| `POST /assistant/conversations/:id/pending/:pid/confirm\|decline` | Answer a confirmation card (no model involved)        |

Turn flow: load history (last 12 messages) → model call with a whitelisted tool set → each tool call
is validated with the same zod schemas as the REST API and runs through the same services, scoped to
the signed-in user → results go back to the model → final text. The user message, tool calls,
pending confirmation and reply are stored in one transaction.

### Phase 4 decisions

- **Provider: Gemini free tier, chosen knowingly.** Google's terms for unpaid use allow prompts and
  responses to be used to improve its products and read by human reviewers, and ask users not to
  submit personal information. The assistant sends schedules, tasks and names. The user accepted this
  (2026-10-10); the app shows a short notice under the chat box. Switching to a billing-enabled key
  removes it without code changes. The provider sits behind `LlmProvider`, so another model is one
  adapter.
- **Interactions API, stateless** (`store: false`), as the current function-calling docs describe.
  Model steps are sent back exactly as received, so thought signatures stay valid. Default model
  `gemini-3.5-flash-lite` (fast and cheap; `GEMINI_MODEL` to change).
- **Tools, not free text.** The model can only call: `get_agenda`, `search_events`, `create_event`,
  `update_event`, `cancel_event`, `list_tasks`, `create_task`, `complete_task`,
  `create_important_date`, `list_upcoming_dates`. It cannot delete anything. Unknown tools, invalid
  arguments and ids belonging to other users come back to the model as errors.
- **Confirmation before risk.** Cancelling, and saving over a clash, become a pending action (30 min
  TTL) that the user confirms by button or by saying yes (`confirm_pending_action`). Confirming twice
  applies it once.
- **Truthful replies.** Every reply carries `actions` built from service results. If the model fails
  after making changes, the reply is a fixed Tamil/English account of those changes; if it fails
  before, nothing is stored and the API returns 503 (`ASSISTANT_UNAVAILABLE` / `ASSISTANT_BUSY`).
- **Limits.** 2,000 characters per message, 6 model calls and 8 tool calls per step per turn,
  30 s per model request. Tool results are marked as data in the prompt so text inside event titles
  cannot instruct the model.
- **Not yet:** deterministic Tamil/Tanglish date extraction before the model (the model resolves
  relative dates from the current local time it is given), streaming replies, voice (Phase 5).

## Voice (Phase 5)

`POST /assistant/voice` `{ conversationId?, audio (base64), mimeType }` → transcribe → same turn as a
typed message → `{ transcript, userMessage, reply, pendingAction }`. `GET /assistant/status` also
reports `voice`.

### Phase 5 decisions

- **Server-side transcription instead of on-device recognition.** `expo-speech-recognition` needs a
  development build; recording with `expo-audio` and transcribing with Gemini works in Expo Go and
  handles Tamil/English mixing in one pass. The prompt asks for Tamil words in Tamil script and
  English in English letters. The same free-tier privacy terms apply to the audio.
- **Small, short recordings.** Mono AAC (`.m4a`), 16 kHz, 32 kbps: about 240 KB per minute. Limit
  60 s on the phone and 2 MB on the server; only `/assistant/voice` accepts a body above 100 KB
  (3 MB). `audio/mp4` is sent to Gemini as `audio/m4a`, the type it documents.
- **No audio kept.** The phone deletes the recording after reading it; the server never stores
  audio, only the transcript as the user's message. An empty transcript returns 422 `NO_SPEECH`
  and stores nothing.
- **Spoken replies** use `expo-speech` with the reply's language (`ta-IN` / `en-IN`), preferring an
  Indian voice. Replies are read aloud after a spoken question when `voiceResponsesEnabled` is on;
  every assistant message also has a "read aloud" button. Settings warns when the phone has no Tamil
  voice (common on Android), in which case Tamil replies are shown but not spoken.
- **Language detection** recognises Tanglish (Tamil typed in Latin letters) by a small word list,
  and each turn tells the model which language to reply in.
- **Verified live (2026-10-10):** an English voice command was transcribed exactly and became a task
  with the right time (4.7 s end to end). Tamil speech has not been tested yet: this PC has no Tamil
  text-to-speech voice to generate test audio.
- **Free-tier limits:** a voice message uses one transcription call plus two or three assistant
  calls, so the free tier's per-minute limit is reached after a few messages; the app then shows
  "busy".

## Memory and planning (Phase 6)

| Route                                          | Notes                                                |
| ---------------------------------------------- | ---------------------------------------------------- |
| `GET/POST /memories`, `DELETE /memories[/:id]` | What the assistant remembers; replace by key; forget |
| `GET /planning/day?date`                       | Deterministic plan for a local day (default today)   |

### Phase 6 decisions

- **Memory is explicit.** The assistant saves a fact (`remember`) only when the user states it about
  themselves or asks; it can `forget`. Facts are shown in the prompt as data, never instructions.
  Values that look like card, account, ID or OTP numbers are rejected by the server regardless of
  what the model does. Limit 100 per user. Users see and delete everything under Settings.
- **The planner is deterministic** (no model, works offline): the day window is wake → sleep
  (defaults 07:00–22:00; a sleep time before the wake time means after midnight), starting at the
  current time (rounded up to 5 minutes) once the day has begun. Events block their time plus
  travel/prep; events without an end block 30 minutes; all-day events do not block time.
- **Task suggestions** in order: overdue, then due that day (placed before the due time when
  possible, flagged `afterDue` otherwise), then undated high/urgent tasks. Length is
  `estimatedMinutes` (default 30, 5–240). Blocked tasks and tasks that do not fit are listed
  separately. Suggestions are not saved; `freeSlots` is the time left after them.
- **Morning brief.** The app schedules one local notification at the next wake time with a summary
  of that day's plan, refreshed whenever reminders sync (`dailyBriefEnabled`, default on).
- **Verified live (2026-10-10):** a stated habit was remembered; "plan my day" was answered from the
  plan; a request (in Tamil) to remember a card number was refused.

## Hardening (Phase 7)

| Route                                  | Notes                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| `POST /me/password`                    | Change password; revokes every other session            |
| `GET /me/export`                       | All the user's data as one JSON file (no secrets)       |
| `DELETE /me`                           | Delete the account and all its data (password required) |
| `POST /devices`, `/devices/unregister` | Expo push tokens of phones running an EAS build         |

### Phase 7 decisions

- **Rate limits** (in memory, per process): 300 requests/min per IP overall; 10 failed sign-ins per
  15 min per IP and per account; 10 registrations/hour per IP; 60 refreshes/15 min; 20 assistant
  turns/min per user (protects the model quota). Errors use the normal shape, code `RATE_LIMITED`.
- **Exposure fixes from review:** voice bodies (3 MB) are parsed only after authentication;
  `trust proxy` is configurable (`TRUST_PROXY_HOPS`, default 0) so client IPs cannot be faked;
  at most 4 password hashes (128 MB each) run at once; registration can be closed
  (`REGISTRATION_OPEN=false`) for a personal server.
- **Account rights:** export everything (password hash, token hashes and idempotency records are
  excluded) and delete everything; deletion leaves a detached audit entry. Access tokens of a
  deleted or re-passworded account stop working at the next database check (most routes), and
  expire within 15 minutes regardless.
- **Maintenance** (hourly, in the worker): delete expired idempotency keys, expired refresh tokens
  (revoked ones are kept until expiry for replay detection) and reminder history older than 90 days.
- **Remote push** via Expo's push service as a second delivery channel. A phone registers only when
  it has an EAS project id (not Expo Go); it then stops scheduling local reminder notifications so
  alerts are not doubled, but keeps the local morning brief. `DeviceNotRegistered` retires a token;
  HTTP errors make the dispatcher retry. Push receipts are not checked yet.
- **Release:** `tsx` and `prisma` are runtime dependencies (start and migrate without dev tools);
  `eas.json` has development / preview / production profiles; see `docs/release.md`. CI runs every
  check against PostgreSQL 18 with `TZ=Asia/Kolkata`.

## One-off changes to repeating events (Phase 8)

| Route                                        | Notes                                              |
| -------------------------------------------- | -------------------------------------------------- |
| `POST /events/:id/occurrences/skip`          | `{ occurrence }`: exact start or local date        |
| `POST /events/:id/occurrences/move`          | `{ occurrence, startAt, endAt?, allowConflicts? }` |
| `DELETE /events/:id/exceptions/:exceptionId` | Restore the occurrence to the series' time         |

- `EventException` rows (SKIPPED / MOVED) are keyed by the occurrence's **original** start, so an
  occurrence can be moved repeatedly and still restored. A moved occurrence keeps the series'
  length unless an end is given; the new time is checked for clashes.
- One helper, `expandEvent`, applies exceptions; every expansion (agenda, clashes, reminders, day
  plan, search) goes through it, and its type requires the exceptions to be loaded, so a call site
  cannot forget them. Agenda occurrences carry `originalStart` and `moved`.
- Changing the series' schedule (start, end, rule, timezone, buffers) deletes its exceptions, as
  calendar apps do; editing the title or notes keeps them.
- Assistant tools `skip_occurrence` / `move_occurrence` (a clashing move asks first). Verified live:
  "Skip gym this Friday" and a Tamil "move this Sunday's gym to 8 am" changed only those days.

## Notification actions and app tests (Phase 9)

- Reminder notifications (local and push) carry **Done** and **Snooze 10 min** buttons
  (category `reminder`). Done completes a task (or acknowledges an event/date reminder); Snooze asks
  the server to remind again and, when it cannot (offline, or the reminder not yet marked sent),
  re-alerts locally. Both buttons open the app: Expo drops button taps when the app was closed and
  the button does not open it.
- The app's pure logic (date formatting, reminder and brief wording, error messages, translation
  completeness) lives in modules without React Native imports and is unit tested with Vitest;
  `npm test` runs API and app tests, and CI runs both.

## Milestone plan

0. Discovery ✅
1. Foundation: monorepo, lint/format, Prisma schema + migration, env, /health, mobile ↔ API check
2. Auth + events/tasks/important dates + conflicts + timezone tests
3. Reminders (worker, restart recovery, dedupe, local notifications) ✅
4. Assistant tool-calling ✅
5. Tamil/English voice ✅
6. Memory + daily planning ✅
7. Hardening + release ✅ (store submission pending: needs EAS account, icons, privacy policy)
8. One-off changes to repeating events ✅
9. Notification actions + app unit tests ✅
