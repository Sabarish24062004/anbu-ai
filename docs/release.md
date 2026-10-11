# Releasing Anbu AI

Two parts ship separately: the **API** (Node + PostgreSQL, on a server you control) and the
**mobile app** (built with EAS). Do them in this order: the app needs the API's public URL.

## Install on your Android phone as an app (APK)

A standalone app with its own icon, no Expo Go needed. Expo builds it in the cloud (free account).

1. Create a free account at https://expo.dev/signup.
2. In `apps/mobile`, sign in and build (the first build asks a few questions; answer **Yes** to
   creating the EAS project and to generating a new Android keystore):

   ```bash
   cd apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest build --platform android --profile preview
   ```

3. When it finishes (about 10–20 minutes on the free tier) it prints a link and QR code. Open it on
   the phone, download the APK and install it (Android asks to allow installing from the browser).

The `preview` build talks to `http://10.77.224.233:4000` (set in `eas.json`). If the PC's address
changes, change it on the sign-in screen or in Settings → Server address; no rebuild is needed.
The API must be running on the PC (`npm run dev:api`) and the phone on the same Wi-Fi. Plain HTTP
is allowed for this (home network) via `expo-build-properties`; a public server should use HTTPS.

## 0. Hosting on your own PC with Cloudflare Tunnel

The API can run on the development PC and be reached from anywhere through a Cloudflare Tunnel:
`cloudflared` connects out to Cloudflare, so no router ports or static IP are needed, and Cloudflare
provides HTTPS. Reminders and push only work while the PC is on and awake, so set Windows to never
sleep while plugged in (Settings → System → Power).

In `services/api/.env` set `TRUST_PROXY_HOPS=1` (the tunnel is one proxy hop; without it every
request looks like it comes from the tunnel and shares one rate limit).

### Temporary address (no account, no domain)

```bash
npm run dev:api        # terminal 1
npm run tunnel         # terminal 2: prints https://<random-words>.trycloudflare.com
```

Point the app at it when starting Expo (PowerShell):

```powershell
$env:EXPO_PUBLIC_API_URL = "https://<random-words>.trycloudflare.com"; npm run dev:mobile
```

The address changes every time the tunnel restarts, so this is for testing (e.g. your phone on
mobile data), not for an installed build. A brand-new address can take a minute or two to resolve;
Settings → Server status in the app shows whether it is reachable.

While the API is public, anyone with the address can try to sign up: create your account, then
set `REGISTRATION_OPEN=false` and restart the API.

### Permanent address (needs a domain on Cloudflare)

1. Add a domain to Cloudflare (buy it in Cloudflare Registrar, or move an existing domain's
   nameservers to Cloudflare).
2. `cloudflared tunnel login` (approve in the browser and pick the domain), then
   `cloudflared tunnel create anbu-api` and
   `cloudflared tunnel route dns anbu-api api.<your-domain>`.
3. Create `%USERPROFILE%\.cloudflared\config.yml`:

   ```yaml
   tunnel: anbu-api
   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
   ingress:
     - hostname: api.<your-domain>
       service: http://localhost:4000
     - service: http_status:404
   ```

4. Run it as a Windows service so it starts with the PC: `cloudflared service install` (from an
   administrator terminal; see Cloudflare's docs for the current service options).
5. Run the API itself on startup too (Task Scheduler or a service wrapper such as NSSM running
   `npm run start -w @anbu/api` in the repository folder), with the production settings below.
6. Set `EXPO_PUBLIC_API_URL=https://api.<your-domain>` for EAS builds (section 2).

## 1. API

### Requirements

- Node.js ≥ 22.12 and PostgreSQL ≥ 16, on a host reachable over **HTTPS** (phones will not send
  credentials to plain HTTP in release builds, and should not).
- A reverse proxy that terminates TLS (Caddy, nginx, or the platform's load balancer).
- **One API process.** Rate limits are kept in memory and the reminder worker runs in-process; both
  are safe with one instance. Running several needs a shared rate-limit store first.

### Environment

Copy `.env.example` to `services/api/.env` on the server and set at least:

| Variable              | Production value                                                  |
| --------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`            | `production`                                                      |
| `DATABASE_URL`        | The production database                                           |
| `JWT_ACCESS_SECRET`   | A new random value (≥ 32 chars); never reuse the development one  |
| `TRUST_PROXY_HOPS`    | `1` behind one reverse proxy (so rate limits see real client IPs) |
| `REGISTRATION_OPEN`   | `true` until your account exists, then `false`                    |
| `CORS_ORIGINS`        | Empty unless you serve the web app                                |
| `GEMINI_API_KEY`      | See the privacy note below                                        |
| `RATE_LIMITS_ENABLED` | `true`                                                            |

Generate a secret with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

### Deploy

```bash
npm ci --omit=dev        # tsx and prisma are runtime dependencies
npm run db:generate -w @anbu/api
npm run db:deploy        # applies pending migrations; never use migrate dev in production
npm run start -w @anbu/api
```

Run it under a process manager (systemd, pm2, or the platform's) that restarts it on failure and
sends `SIGTERM` on shutdown; the server then stops the reminder worker and closes the database.
`GET /health` returns 200 when the database is reachable and 503 otherwise, for health checks.

Back up the database daily (`pg_dump`); it holds everything users have entered.

### Privacy: the model provider

With a **free-tier** Gemini key, Google may use prompts (schedules, names, voice transcripts) to
improve its products and human reviewers may read them. That was accepted for development
(see `architecture.md`, Phase 4). For anyone else using the app, use a key from a Google Cloud
project **with billing enabled**, where prompts are not used for training, or leave the key unset
to run without the assistant. Tell users which applies.

## 2. Mobile app (EAS)

Expo Go is fine for development. Release builds — and remote push — need EAS.

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init                       # adds extra.eas.projectId to app.json; commit it
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://api.your-domain.example --environment production --environment preview
```

Without `EXPO_PUBLIC_API_URL` a release build cannot find the API (the Settings screen shows the URL
it is using).

| Profile       | Command                                          | Use                                    |
| ------------- | ------------------------------------------------ | -------------------------------------- |
| `development` | `npx eas-cli@latest build --profile development` | Dev client with push; replaces Expo Go |
| `preview`     | `npx eas-cli@latest build --profile preview`     | Installable APK / ad-hoc iOS to test   |
| `production`  | `npx eas-cli@latest build --profile production`  | Store builds                           |

### Remote push

Once a build has an EAS project id, the app registers its Expo push token (`POST /devices`) and
the server sends reminders through Expo's push service; that phone then stops scheduling its own
local reminder notifications, so alerts are not duplicated. Set up credentials once:

- **Android:** create a Firebase project, download the FCM v1 service-account key and upload it with
  `npx eas-cli@latest credentials` (Android → Google Service Account → FCM V1).
- **iOS:** EAS creates the APNs key during the first iOS build (needs an Apple Developer account).
- If you enable "enhanced push security" in the EAS dashboard, set `EXPO_ACCESS_TOKEN` on the API.

### Before submitting to the stores

- Replace the placeholder icon and splash images in `apps/mobile/assets`.
- Write a privacy policy that names the data stored (schedule, tasks, dates, memories,
  conversations, voice transcripts), the model provider, and how to export or delete it
  (Settings → Account).
- Have the Tamil text reviewed by a native speaker.
- Test on real Android and iOS devices: notifications, voice in Tamil, a phone without a Tamil voice.

## 3. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: typecheck, lint, formatting and the
full API test suite against PostgreSQL 18, with `TZ=Asia/Kolkata` to catch time-zone bugs.
