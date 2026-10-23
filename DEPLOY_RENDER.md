# Deploying HL Central on Render

This is the operator's checklist for standing up **Staging** and **Production** on
Render from [`render.yaml`](./render.yaml). It contains **no secret values** —
only the variable names and what to put in each. Enter real values in the Render
dashboard, per environment.

> **You do the Render dashboard steps.** This repo only prepares the code and the
> Blueprint. Nothing here deploys anything by itself.

---

## 0. One-time prerequisites

1. Create a `staging` branch (the Staging services deploy from it; Production
   deploys from `main`):
   ```bash
   git switch -c staging && git push -u origin staging
   ```
2. In Neon, create a **branch** of your production database for Staging. You'll
   have two connection strings: one for the real prod DB, one for the branch.
3. Provision object storage for attachments (AWS S3 / Cloudflare R2 / Backblaze
   B2). Create **two separate buckets** — one for Staging, one for Production —
   so test uploads never mix with real files.
4. In Render: **New → Blueprint**, connect this repo, and select the branch to
   sync the Blueprint from: **`main`**. Render reads `render.yaml`, creates the
   `healthy-tasks` project with both environments, and prompts for every
   `sync: false` variable below.

After the environments exist:

- Mark **Production** as a **protected environment** (Environment → Settings) so
  destructive changes require admin access.
- Do a one-time admin seed for each environment (see §4).

---

## 1. What differs between Staging and Production

| Variable            | Staging                                  | Production                              |
| ------------------- | ---------------------------------------- | --------------------------------------- |
| `DATABASE_URL`      | Neon **branch** connection string        | Neon **real** prod connection string    |
| `JWT_SECRET`        | its own long random value                | a **different** long random value       |
| `FRONTEND_URL`      | staging web URL                          | production web URL                      |
| `CORS_ORIGIN`       | = staging web URL                        | = production web URL                    |
| `VITE_API_URL`      | staging API URL                          | production API URL                      |
| `S3_BUCKET`         | `healthy-tasks-staging` (or similar)     | `healthy-tasks-prod` (or similar)       |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | staging credentials        | **different** production credentials     |
| `EMAIL_PROVIDER`    | `console` (stay stubbed)                 | `smtp` at go-live (see §5)              |
| `SEED_ADMIN_*`      | staging admin                            | production admin                        |
| `QUEUE_DASHBOARD_USER` / `_PASSWORD` | its own pair: the queue dashboard (§6) | a **different** pair (§6)   |
| `VITE_QUEUE_DASHBOARD_URL` | staging API + `/bullmq`                   | production API + `/bullmq`              |

**Never reuse a value across environments — especially `DATABASE_URL`, `JWT_SECRET`,
and the S3 credentials.**

---

## 2. Backend service — full variable list

Set these on `healthy-tasks-api-prod` **and** `healthy-tasks-api-staging`.
"Committed" = already has a safe value in `render.yaml`, nothing to enter.

### Differs per environment — you enter these (secret)

- [ ] **`DATABASE_URL`** — Postgres connection string. Purpose: the database the
      app reads/writes. Staging → Neon branch; Production → real Neon DB. The app
      **crashes on boot if this is missing.**
- [ ] **`JWT_SECRET`** — long random string used to sign login tokens. Different
      per environment. The app **crashes on boot if this is missing.**

### Differs per environment — you enter these (not secret, but URL-dependent)

- [ ] **`FRONTEND_URL`** — base URL of this env's frontend. Purpose: builds the
      links inside password-reset emails.
- [ ] **`CORS_ORIGIN`** — must equal this env's frontend origin exactly. Purpose:
      lets the SPA call the API from the browser. If this is wrong, the app loads
      but every API call is blocked by CORS.

### Same in both — already committed in `render.yaml`

- [x] `NODE_ENV=production` — controls app behavior (disables verbose error
      responses; quiets Prisma logging to errors-only). Set in **both**
      environments; it does not decide which data the app touches.
- [x] `JWT_EXPIRES_IN=8h` — idle-session window.
- [x] `PASSWORD_RESET_EXPIRES_IN=60m` — reset-link lifetime.
- [x] `EMAIL_FROM` — the From: header.
- [x] `STORAGE_DRIVER=s3` — use real object storage (the `memory` driver is for
      tests only).

### Daily alert tasks (HLAI-112) — optional, you enter these

- [ ] **`EXCLUSIVES_DAILY_TASKS_AT`** — when the Daily alert tasks are made,
      24-hour `HH:MM` on the business clock (`BUSINESS_TIMEZONE`). Each covers the
      day before, from the same time to a minute before it. Left unset (or empty):
      `08:30`. Saving it restarts the API; its boot log then shows e.g. `Daily
      alert tasks: 8:30 AM New York time, covering the day before (8:30 AM to 8:29
      AM)`. A wrong value (`8:30 AM`, `8.30`, a lone space) stops the API at
      start-up, saying what is wanted.

### Email — see §5

- [ ] **`EMAIL_PROVIDER`** — `console` or `smtp`. Committed as `console`.
      **Flip Production to `smtp` at go-live** (you've said you want real emails).
- [ ] **`SMTP_HOST`**, **`SMTP_PORT`**, **`SMTP_USER`**, **`SMTP_PASS`** — from your
      email provider. Only used when `EMAIL_PROVIDER=smtp`. Production only.
- [ ] **`EMAIL_SEND_TEXT`** (HLAI-135) — optional. Leave it unset (or `"true"`) to send
      every email as HTML with its text version; `"false"` sends the HTML only. Any
      other value stops the server at start-up.

### Object storage (attachments) — you enter these

- [ ] **`S3_BUCKET`** — separate bucket per environment.
- [ ] **`S3_REGION`** — bucket region.
- [ ] **`S3_ENDPOINT`** — server-side endpoint (e.g.
      `https://s3.us-east-1.amazonaws.com`).
- [ ] **`S3_PUBLIC_ENDPOINT`** — endpoint the browser is signed against. For a
      real cloud bucket this is the **same** https URL as `S3_ENDPOINT` (the
      local split existed only because MinIO ran under a compose DNS name the
      browser couldn't reach).
- [ ] **`S3_ACCESS_KEY`**, **`S3_SECRET_KEY`** — bucket credentials (secret;
      different per environment).
- [ ] **`S3_FORCE_PATH_STYLE`** — `false` for AWS S3; `true` for MinIO / R2 /
      B2-style providers. Verify against your provider.

### One-time seed only

- [ ] **`SEED_ADMIN_EMAIL`**, **`SEED_ADMIN_PASSWORD`** — used only by the manual
      `db:seed` run that creates the first admin (§4). Can be removed afterward.

---

## 3. Frontend static site — variable list

Set on `healthy-tasks-web-prod` and `healthy-tasks-web-staging`:

- [ ] **`VITE_API_URL`** — https URL of this env's backend API. **Baked in at
      build time**, so set it before the first build and rebuild if it changes.
- [ ] **`VITE_QUEUE_DASHBOARD_URL`** — this env's queue dashboard, e.g.
      `https://hlcentral-api-staging.onrender.com/bullmq`. Purpose: the **Open queue
      dashboard** button on the profile page, shown to Admins only. Unset, the
      button is not shown. Also baked in at build time (§6).

---

## 4. First-run: seed the initial admin (per environment)

Migrations run automatically via the pre-deploy step. The first admin is **not**
auto-created (same as local). After the first successful deploy, open the
backend service's **Shell** in Render and run:

```bash
npm run db:seed --workspace backend
```

It uses `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Do this once per environment.
Change the admin password after first login.

---

## 5. Email: stubbed vs. real

Today the app ships a **console email stub** (`EMAIL_PROVIDER=console`): password
reset and admin-created-user emails are **printed to the backend logs, not sent**.
The SMTP path already exists (`backend/src/utils/mailer.ts`) and turns on purely
via env vars — no code change needed.

- **Staging:** all six email settings (`EMAIL_PROVIDER`, `EMAIL_FROM`,
  `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`) are `sync: false` and
  live only in the dashboard. Set `EMAIL_PROVIDER=smtp` there to send real
  email — until `SMTP_HOST` is set, sending fails — or `console` for log-only
  mail. With `smtp`, test with your own accounts, since resets and reminders
  reach real inboxes.
- **Production:** you want real emails. **Before go-live**, set `EMAIL_PROVIDER=smtp`
  and fill `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` from your provider
  (SendGrid, SES, Postmark, etc.), and set `EMAIL_FROM` to an address on a domain
  you've verified with that provider. Until you do, admins can still create users
  and reset passwords, but recipients won't get an email — the reset link only
  appears in the logs.

**HTML emails (HLAI-135).** Every email is sent as HTML — the logo and "HL
Central" at the top of a white card, the message, the main link as a button with
the plain link under it — with
its text version alongside, for mail apps that can't show HTML (spam filters
also trust an email with both a little more). `EMAIL_SEND_TEXT="false"` sends
the HTML only; nothing else needs setting. The logo travels inside each email (a
small picture attached to it, `backend/assets/email-logo.png`), so it needs no
setting and shows even in mail apps that block pictures from the internet.
To see every email without sending one, run `npm run email:preview --workspace
backend` on your own computer and open the `index.html` it prints.

---

## 6. Email queue: Key Value + the email worker inside the API

Emails go through a queue (BullMQ) held in a **Key Value** (Render's
Redis-compatible store), one per environment. The email worker that sends them
**runs inside each API** (`EMAIL_WORKER_IN_API`, on by default), so there is no
separate worker service. It retries a failed send every 2 minutes, 10 times,
records failures in the `FailedEmail` table, and deletes the `failed` ones every
Sunday 04:00 `BUSINESS_TIMEZONE`.

| | Production | Staging |
| --- | --- | --- |
| Key Value | `hlcentral-redis`: `256mb`, $10/month, kept on disk | `hlcentral-queue-staging`: `free`, $0, nothing kept through a restart |
| Created by | you, by hand; the Blueprint takes it over by its name on the first sync after merging to `main` | you, by hand; taken over the same way |
| Email worker | inside `hlcentral-api` | inside `hlcentral-api-staging` |

> **Cost:** $10/month, for the production Key Value, billed since it was created
> by hand (not from the merge). Because `render.yaml` names it `hlcentral-redis`
> with the same settings, the sync takes it over instead of creating a second one;
> renaming either side would make Render create (and bill) another. Only one free
> Key Value is allowed per workspace: if another already exists, staging needs
> `256mb` too.

What `render.yaml` sets up:

- `REDIS_URL` on each API, wired to that environment's Key Value (`fromService`).
- The Key Value uses `maxmemoryPolicy: noeviction` (BullMQ requires it; the default
  `allkeys-lru` silently deletes queued emails when memory is full) and accepts no
  connections from outside Render (`ipAllowList: []`).
- Both APIs start with `node backend/dist/server.js`, not `npm start`: npm exits on
  Render's stop signal without passing it on, so a deploy would cut off the emails
  being sent. Started with node, the API finishes them first.
- `BUSINESS_TIMEZONE=America/New_York` on both APIs (the weekly cleanup's clock).
- The `FailedEmail` table comes with the migrations, which the pre-deploy step
  applies as usual.
- `QUEUE_DASHBOARD_USER` and `QUEUE_DASHBOARD_PASSWORD` on each API, and
  `VITE_QUEUE_DASHBOARD_URL` on each website, empty until you fill them in (see
  **Queue dashboard** below). Render never fills or syncs them (`sync: false`), so
  they are set by hand in both environments, Production included.

### Staging (by hand)

1. Merge the PR into `staging`. The API deploys and still sends email directly.
2. **Staging API → Settings → Start Command:** `node backend/dist/server.js`.
3. **Staging → + New → Key Value:**
   - Name `hlcentral-queue-staging`; region **Virginia**, the same as the API (the
     internal URL only works within one region).
   - Maxmemory Policy **`noeviction`** (the form defaults to `allkeys-lru`).
   - Compute **Free** (the form defaults to $10, and a plan cannot be downgraded
     later).
   - No external access.

   Then **Connect → Internal URL**, and copy it.
4. **Staging API → Environment:** `REDIS_URL` = that internal URL and
   `EMAIL_DELIVERY` = `queue`, in the **same save** (queue mode without `REDIS_URL`
   stops the API from starting). It redeploys.
5. Optional: switch on the queue dashboard (see **Queue dashboard** below).

### Production (after merging to `main`)

1. Sync the Blueprint (automatic with Auto Sync on). It takes over
   `hlcentral-redis` (no new Key Value), wires `REDIS_URL` to it — the same internal
   address set by hand before — and sets the start command.
2. **Production API → Environment:** `EMAIL_DELIVERY` = `queue`. It redeploys.
3. Optional: switch on the queue dashboard (see **Queue dashboard** below).

To check it works (each environment):

- The API's boot log shows:
  - `email delivery: queued, sent by the email worker inside this API`
  - `5 at a time; a failed send is retried every 120s, up to 10 times`
  - `failed emails are cleaned up every Sunday at 04:00 America/New_York; next: …`
- Each email sent logs `[email-worker] sent … (try 1 of 11 …)` in the API's log.
- While `EMAIL_DELIVERY` is still `direct`, the API logs
  `⚠️ NOT PRODUCTION READY: EMAIL_DELIVERY is "direct" …` on every boot.
- Rolling back is instant: set `EMAIL_DELIVERY` back to `direct` (or remove it).

When an email fails:

- It is retried every 2 minutes, 10 times. The API's log shows each try and
  `no tries left` at the end.
- The queue dashboard (below) shows it under **Failed**, with a **Retry**
  button.
- Failed emails are also in the database: in Neon's
  SQL editor, `SELECT recipient, subject, status, attempts, "lastError",
  "failedAt" FROM "FailedEmail" ORDER BY "updatedAt" DESC;` (`retrying` = still
  being tried, `failed` = gave up). Sign-in links in them are stored without
  their token.
- To clear the `failed` rows before Sunday, open the API's **Shell** and run
  `npm run queue:clean-failed-emails --workspace backend`.

Moving the email worker to a service of its own (only if email volume ever slows
the API):

1. **+ New → Background Worker** (paid; there is no free plan): same repo and
   branch, region Virginia, the API's build command, start command
   `node backend/dist/worker.js`, shutdown delay 60 s. Environment:
   `NODE_ENV=production`, `BUSINESS_TIMEZONE=America/New_York`, `REDIS_URL` (the
   same Key Value), and `DATABASE_URL` plus the six email settings, all the same
   values as the API.
2. On the API: `EMAIL_WORKER_IN_API=false`.

### Queue dashboard

Each API can serve the queue dashboard (Bull Board) itself, at its own `/bullmq`
(`https://hlcentral-api-staging.onrender.com/bullmq`,
`https://hlcentral-api.onrender.com/bullmq`), behind the browser's own sign-in
box. It is the same dashboard as the local one: waiting, sent and failed emails, a
**Retry** button, and the weekly cleanup on the `maintenance` queue. It is on only
when `EMAIL_DELIVERY` is `queue` and both settings below are set, with a password
of at least 16 characters; otherwise that address is a 404.

Admins reach it from **Your profile → Queues Dashboard → Open queue dashboard**, which
opens it in a new tab. Nobody else sees that box.

To switch it on (each environment, with its **own** user name and password —
never Staging's pair on Production):

1. Make a password of 20 or more random characters (a password manager can
   generate one).
2. **API → Environment:** `QUEUE_DASHBOARD_USER` (any name, e.g. `hl-team`) and
   `QUEUE_DASHBOARD_PASSWORD`. It redeploys.
3. The boot log shows `queue dashboard: on at /bullmq (password protected)`. If
   something is missing it shows `⚠️ queue dashboard: off - …` and says what.
4. **Website (static site) → Environment:** `VITE_QUEUE_DASHBOARD_URL` = that API's
   address + `/bullmq`. Saving rebuilds the site (the address is built into it).
5. As an Admin, open **Your profile**: the **Queues Dashboard** box is under
   Notifications. Its button opens the dashboard; sign in there. The browser keeps
   the sign-in until it is fully closed; there is no sign-out button.

Good to know:

- **Only Admins see the button, but the dashboard checks its password, not who
  is signed in to HL Central.** Anyone given the password could open it by typing
  the address. So share each environment's user name and password with Admins
  only, privately (a direct message or a password manager). With them, a person
  sees who got which email, can read the emails, and can retry or delete them.
- To change the password, or to shut someone out, change
  `QUEUE_DASHBOARD_PASSWORD` and give the new one to the Admins. To switch the
  dashboard off, delete both settings (and `VITE_QUEUE_DASHBOARD_URL`, so the
  button goes too).
- Sign-in links (password reset, welcome) are shown as `token=[redacted]`.
  **Retry** sends the real link. **Duplicate** and **Update Data** start from what
  is shown, so their copy would carry the hidden link: use **Retry** for those
  emails.
- It needs no access to the Key Value from outside Render (`ipAllowList: []`). If
  you added your own address under the Key Value's **Networking** to reach it
  from your computer, remove it.
- Locally the dashboard is its own container, `http://localhost:3005/bullmq`, with
  no sign-in and reachable from your computer only; docker-compose points the
  profile button there.

---

## 7. Pre-flight sanity checks

- [ ] `render.yaml` synced without validation errors.
- [ ] Both API services show a healthy `/health` check.
- [ ] `DATABASE_URL` and `JWT_SECRET` set on **both** API services (or the service
      crash-loops on boot).
- [ ] Staging `DATABASE_URL` is the Neon **branch**, not the prod DB.
- [ ] `CORS_ORIGIN` on each API matches that env's frontend URL exactly (scheme +
      host, no trailing slash).
- [ ] `VITE_API_URL` on each frontend points at that env's API.
- [ ] Production marked as a protected environment.
- [ ] First admin seeded in each environment.
- [ ] Each API's boot log shows `email delivery: queued, sent by the email worker
      inside this API` and the weekly cleanup's next run (§6).
- [ ] The staging API's start command is `node backend/dist/server.js` (set by
      hand; production gets it from `render.yaml`).
- [ ] `EMAIL_DELIVERY` on each API stays unset (`direct`) until its Key Value
      exists and `REDIS_URL` is set.
- [ ] Where the queue dashboard is wanted: that API's boot line says `queue
      dashboard: on at /bullmq (password protected)`, its website has
      `VITE_QUEUE_DASHBOARD_URL`, and Staging and Production use different
      passwords (§6).
