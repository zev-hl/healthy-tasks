# Deploying Healthy Tasks on Render

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

### Email — see §5

- [ ] **`EMAIL_PROVIDER`** — `console` or `smtp`. Committed as `console`.
      **Flip Production to `smtp` at go-live** (you've said you want real emails).
- [ ] **`SMTP_HOST`**, **`SMTP_PORT`**, **`SMTP_USER`**, **`SMTP_PASS`** — from your
      email provider. Only used when `EMAIL_PROVIDER=smtp`. Production only.

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

- **Staging:** keep `console` even after Production is live, so test flows never
  email real people.
- **Production:** you want real emails. **Before go-live**, set `EMAIL_PROVIDER=smtp`
  and fill `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` from your provider
  (SendGrid, SES, Postmark, etc.), and set `EMAIL_FROM` to an address on a domain
  you've verified with that provider. Until you do, admins can still create users
  and reset passwords, but recipients won't get an email — the reset link only
  appears in the logs.

---

## 6. Pre-flight sanity checks

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
