# Redesign preview site (Render)

The UI redesign lives on the `redesign` branch. It is deployed as a **second
static site** on Render, built from that branch, that talks to the **existing
Staging API and its data**. The Staging site (`hlcentral-staging`) is not
touched.

At first both sites shared one API and one database. Since then the `redesign`
branch has grown its own server work (the Nov 2026 plan, Stages 0–5: snooze,
the server timer, events, files, drafts, Connect sign-in and more, with 12 new
migrations), which the Staging API does not have. To test the preview properly,
give it **its own API and database**: see "Its own API and database" below.
Until then, the new screens that need the server fail on the preview.

The site is created by hand in the dashboard; it is not in `render.yaml` (the
Blueprint syncs from `main` and must not grow a service for a temporary branch).

## Before you start

The Staging API must already have the `CORS_ORIGIN` change that accepts a
comma-separated list (branch `cors-multiple-origins`, merged into `staging` and
deployed). Without it, a second origin in `CORS_ORIGIN` breaks the Staging site
too.

## 1. Create the static site

Render dashboard → the **healthy-tasks** project → **staging** environment →
**New** → **Static Site**:

| Field             | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| Repository        | `zev-hl/healthy-tasks`                                                               |
| Branch            | `redesign`                                                                           |
| Name              | e.g. `hlcentral-redesign` (gives `https://hlcentral-redesign.onrender.com` if free)  |
| Root directory    | _(leave blank — the repo root)_                                                      |
| Build command     | `npm ci --include=dev && npm run build:shared && npm run build --workspace frontend` |
| Publish directory | `./frontend/dist`                                                                    |
| Auto-deploy       | On commit                                                                            |

**Environment variables** (all baked in at build time; copy the values from the
`hlcentral-staging` site's Environment page):

| Key                        | Value                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `VITE_API_URL`             | the Staging API, `https://hlcentral-api-staging.onrender.com`     |
| `VITE_GOOGLE_CLIENT_ID`    | same as `hlcentral-staging`'s (the Staging OAuth client)          |
| `VITE_QUEUE_DASHBOARD_URL` | same as `hlcentral-staging`'s (`…-api-staging…/bullmq`), optional |

After it is created, open the new site → **Redirects/Rewrites** → add:

| Source | Destination   | Action  |
| ------ | ------------- | ------- |
| `/*`   | `/index.html` | Rewrite |

(The SPA fallback, so `/tasks`, `/goals`, `/admin/...` work on refresh.)

## 2. Let the Staging API accept the new site

`hlcentral-api-staging` → **Environment** → `CORS_ORIGIN`, add the new origin
after a comma (exact origin: `https://`, no trailing slash):

```
https://hlcentral-staging.onrender.com,https://hlcentral-redesign.onrender.com
```

Save (the API restarts). Leave `FRONTEND_URL` as the Staging site: links in
emails (password reset, notifications) keep pointing there.

## 3. Attachments: the bucket's CORS rule

Files go straight between the browser and the Staging bucket (pre-signed URLs),
so the bucket's own CORS policy must name the new site too, or uploads and
downloads fail on the preview. Cloudflare R2 → the Staging bucket → **Settings**
→ **CORS policy** → add the new origin to `AllowedOrigins`, next to the Staging
site's.

## 4. Google sign-in

If company accounts sign in with Google on Staging: Google Cloud Console →
**APIs & Services** → **Credentials** → the **Staging** OAuth client →
**Authorized JavaScript origins** → add `https://hlcentral-redesign.onrender.com`
(your real address). Otherwise Google answers `origin_mismatch`. Changes can take
a few minutes. Password sign-in needs nothing extra.

## Checks

- [ ] The preview loads and signing in works (password, and Google if used).
- [ ] The browser console shows no CORS errors; pages stay signed in while used.
- [ ] Uploading and opening an attachment works.
- [ ] The Staging site still works as before.

## Its own API and database (the `redesign` server)

The preview gets its own API, built from `redesign`, and its own Neon branch,
copied from Staging's data. Staging's site, API and database stay untouched.
Nothing here goes in `render.yaml` (the Blueprint syncs from `main`).

Checked on Nov 20, 2026: `staging` has no commit or migration that `redesign`
lacks; `redesign` adds 12 migrations on top. So a copy of Staging's database
takes `redesign`'s migrations cleanly.

### A. The database: a Neon branch

1. Neon → the project with Staging's database → **Branches** → **Create
   branch**. Name it `redesign` and set its parent to Staging's branch. "Data:
   current", so it starts as a copy of Staging's data.
2. Open the new branch → **Connect** → copy the **pooled** connection string
   (the host has `-pooler`). Add `?sslmode=require` if it isn't there. This is
   the new API's `DATABASE_URL`.

The copy includes real people's names and email addresses, so email is turned
off below (point 3 of C).

### B. The API: a Render web service

Render → **New** → **Web Service** → the `zev-hl/healthy-tasks` repository:

| Setting | Value |
| --- | --- |
| Name | `hlcentral-api-redesign` (gives `https://hlcentral-api-redesign.onrender.com`) |
| Branch | `redesign` |
| Region | Virginia (same as Neon) |
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build:shared && npm run prisma:generate --workspace backend && npm run build --workspace backend` |
| Pre-deploy command | `npm run prisma:deploy --workspace backend` |
| Start command | `node backend/dist/server.js` |
| Health check path | `/health` |
| Plan | Starter is enough for testing |
| Auto-deploy | On commit |

The pre-deploy command applies `redesign`'s 12 migrations to the new branch on
the first deploy.

### C. The API's environment variables

1. **Required:**
   - `DATABASE_URL`: the Neon `redesign` branch string from A.
   - `JWT_SECRET`: a new one (`openssl rand -base64 48`), not Staging's, so
     sign-ins are separate.
   - `NODE_ENV=production`
2. **The site:**
   - `CORS_ORIGIN=https://hlcentral-redesign.onrender.com`
   - `FRONTEND_URL=https://hlcentral-redesign.onrender.com` (links in emails
     and the reset page)
3. **Email off:**
   - `EMAIL_PROVIDER=console`
   - `EMAIL_DELIVERY=direct`

   The copied data has real addresses: with `console`, no email leaves the
   server, and reset links appear in the service's logs. Don't set `REDIS_URL`.
4. **Same as Staging's API:** copy these values from `hlcentral-api-staging` →
   Environment.
   - `BUSINESS_TIMEZONE`, `JWT_EXPIRES_IN`, `PASSWORD_RESET_EXPIRES_IN`,
     `GOOGLE_CLIENT_ID`, `GOOGLE_ALLOWED_DOMAIN`
   - The storage settings: `STORAGE_DRIVER` (if set), `S3_ENDPOINT`,
     `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`,
     `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`. The copied data's files live in
     Staging's bucket, and its CORS rule already names the preview (step 3
     above). New uploads get their own unique keys.
5. **New in `redesign`:**
   - `KEEP_SIGNED_IN_DAYS=30`
6. **Background work:**
   - `SCHEDULER_ENABLED`:
     - `true` while you test reminders, snooze wake-ups, the timer's "Still
       working?" and repeating templates. This keeps the Neon branch awake
       while the API runs.
     - `false` otherwise.
   - `EXCLUSIVES_SWEEP_ENABLED=false`: don't check Amazon from the preview.
     Leave out the `SP_API_*` keys. The Alert Log still shows the copied alerts.
7. **Leave unset** (each feature stays off and says so):
   - `CONNECT_*` (Connect isn't running yet)
   - `VAPID_*` (browser push)
   - `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_TOKEN_KEY`
     (Google Calendar)
   - `QUEUE_DASHBOARD_*`
   - `SEED_ADMIN_*` (the copied data already has Admins)

Deploy, then open `https://hlcentral-api-redesign.onrender.com/health`. It
should answer `{"status":"ok"}`. The deploy log shows the migrations applied.

### D. Point the preview site at it

1. The static site `hlcentral-redesign` → **Environment** → set `VITE_API_URL`
   to `https://hlcentral-api-redesign.onrender.com`.
2. **Manual Deploy** → **Clear build cache & deploy**. Vite bakes the address
   in at build time, so a plain restart isn't enough.
3. Google sign-in: the Google client already lists the preview's origin
   (step 4 above). Nothing to add for the API.
4. Optional, once it works: take the preview's origin back out of the Staging
   API's `CORS_ORIGIN` (step 2 above). Staging no longer serves it.

### E. Checks

- [ ] Sign in on the preview with the same password or Google account as on
      Staging (it is a copy).
- [ ] Network tab: requests go to `hlcentral-api-redesign`, with no CORS
      errors.
- [ ] Snooze a task, start and stop the timer, add an event on the Calendar,
      open Files. All work, with no 404s.
- [ ] A password reset shows its link in the new API's logs, and no email is
      sent.
- [ ] The Staging site still works and doesn't show the preview's changes.

To start over with fresh Staging data: in Neon, **Reset from parent** on the
`redesign` branch. The next API deploy (or a restart) re-applies the
migrations.

## Removing it later

Delete the static site and the `hlcentral-api-redesign` service, and the Neon
`redesign` branch. Take the preview's origin back out of `CORS_ORIGIN`, the
bucket's CORS policy and the Google client's origins.
