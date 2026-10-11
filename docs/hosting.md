# Free hosting (web + Android)

One codebase, three free services:

| Part              | Service                                                  | Free plan                                        |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------ |
| Database          | [Supabase](https://supabase.com) Postgres                | 500 MB; paused after 7 days without any activity |
| API               | [Render](https://render.com) web service (`render.yaml`) | 512 MB; sleeps after 15 min without requests     |
| Web app           | Render static site (`render.yaml`)                       | Served from a CDN; never sleeps                  |
| Keep-alive        | GitHub Actions (`.github/workflows/keep-alive.yml`)      | Pings the API every 10 min                       |
| Android app (APK) | EAS build, attached to a GitHub Release                  | Talks to the hosted API over HTTPS               |

Why these: Neon's free Postgres counts compute hours (about 400 a month at the smallest size),
and the reminder worker queries the database every 30 seconds, so it would run out mid-month;
Supabase's free database has no hour limit. Render runs the API from this repository with no
Docker or server to manage, and its 750 free hours a month cover one service running all month.

The keep-alive matters: a sleeping API cannot send reminders, and the first request after a
sleep takes about a minute. The pings also count as activity for Supabase.

## 1. Database (Supabase)

1. Sign up at https://supabase.com (GitHub sign-in works) and create a project:
   region **Southeast Asia (Singapore)**, and a database password made of **letters and numbers
   only** (other characters would need URL-encoding in the connection string). Keep it safe.
2. Open **Connect** (top of the project page) → **Connection string** → method
   **Session pooler** (the direct connection needs IPv6, and Render connects over IPv4). Copy the URI, put
   your password in place of `[YOUR-PASSWORD]` and add `?sslmode=require` at the end:

   ```
   postgresql://postgres.<project-ref>:<password>@aws-…pooler.supabase.com:5432/postgres?sslmode=require
   ```

   This is `DATABASE_URL`. Never commit it or paste it anywhere public.

## 2. API and web app (Render)

1. Sign up at https://render.com with GitHub and allow it to read this repository.
2. **New → Blueprint**, pick the repository. Render reads `render.yaml` and asks for:
   - `DATABASE_URL`: the string from step 1.
   - `GEMINI_API_KEY`: your key from https://aistudio.google.com/apikey (or leave empty to run
     without the assistant).
3. **Apply**. The first deploy installs, generates the Prisma client and applies the migrations
   to Supabase (`prisma migrate deploy`), then starts the API. `JWT_ACCESS_SECRET` is generated.
4. Check `https://anbu-ai-api.onrender.com/health` returns `"status":"ok"`, then open
   `https://anbu-ai-app.onrender.com`.

If Render had to change a service's address (names are shared by everyone), set the real
addresses in the Render dashboard: `EXPO_PUBLIC_API_URL` on **anbu-ai-app** (then redeploy it)
and `CORS_ORIGINS` on **anbu-ai-api**, and in `apps/mobile/eas.json`.

## 3. Keep-alive

In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**,
name `API_URL`, value `https://anbu-ai-api.onrender.com`. (Or `gh variable set API_URL --body
https://anbu-ai-api.onrender.com`.) Run **Actions → Keep API awake → Run workflow** once to check.

## 4. Android app

`apps/mobile/eas.json` points the `preview` (APK) and `production` builds at the hosted API:

```bash
cd apps/mobile
npx eas-cli@latest build --platform android --profile preview
```

Attach the APK to a new GitHub Release. An installed app that was given another server address
can be switched in Settings → Server address.

## Limits to know

- **Public sign-up** is open so anyone can try the demo. Rate limits are on, but every
  assistant message uses your Gemini free-tier quota, and on that tier Google may review
  prompts (the app says so under the chat box). Set `REGISTRATION_OPEN=false` on Render to close
  sign-up.
- **No backups** on Supabase's free plan: export with `pg_dump` (Supabase → Database → Backups
  explains how) if the data matters.
- **Push notifications** to installed phones need Firebase credentials (see `release.md`);
  without them the phone schedules its own reminders, which works the same while it has synced.
- **`TRUST_PROXY_HOPS=1`** assumes one proxy in front of the API; if every visitor shares one
  rate limit, the real number of Render proxies is higher (see `release.md`).
