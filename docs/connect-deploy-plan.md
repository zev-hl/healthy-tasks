# Our Connect on Render and Neon — deployment plan

**Status:** PLAN (nothing has been created yet). Written 2026-11-19.
**What this is:** the runbook for standing up our own copy of Connect (Brecx
Connect: chat and calls) on our Render account and our Neon database server, then
linking it to HL Central. Follow it in order. Each step says where to click, what
to set and how to check it worked.

**Read first:** `docs/connect-changes.md` (what HL Central and Connect each need)
and `docs/architecture.md` §22 (HL Central's side, built and switched off).

**About the facts here.** This repo does not contain Connect's source. What this
plan says about Connect comes from its source and docs as read in another session
(`render.yaml`, `docs/deploy-render.md`, `docs/migrate-neon-region.md`,
`apps/api/src/env.ts`, `services/sessions.ts`, `services/rtc/provider.ts`,
`tenancy/entitlements.ts`, `services/seed.ts`, migration
`packages/db/drizzle/0077_platform_core.sql`). Anything nobody has checked is
marked **⚠ check in Connect** — look it up before you rely on it. They are all
collected in §13.

---

## 0. The shape of it

```
Browser ── https://hlcentral.onrender.com (HL Central web, static)
   │          └─ chat pop-up: <iframe src="CONNECT_URL">  ──┐
   │                                                        ▼
   └──────── https://hlcentral-connect.onrender.com  (Connect: ONE Web Service,
                                                       API + Socket.IO + web app)
                  │  Postgres (pooled)       → Neon project "connect", N. Virginia
                  │  attachments             → Cloudflare R2 bucket "hl-connect"
                  │  mail                    → SMTP
                  │  calls (optional)        → LiveKit on a DigitalOcean droplet
                  │
HL Central API ───┤  CONNECT_URL + CONNECT_API_KEY  (HL Central → Connect bot API)
(hlcentral-api)   └  HLCENTRAL_URL + HLCENTRAL_KEY  (Connect → HL Central, K6/K7)
```

Decided by Connect's design, not open for choice:

- **One Render Web Service** holds both the API and the web app
  (`SERVE_WEB=true`). Connect's own docs: *"No Static Site is needed — and adding
  one would break sign-in"*, because two `*.onrender.com` services are different
  sites and the session cookie would not travel between them.
- **Postgres through Drizzle**; the migrations run **during the build**
  (`pnpm db:migrate` inside `render:build`).

---

## 1. Decisions and inputs to gather before starting

Settle these first; the steps below refer to them by number.

| # | Decision / input | Recommendation |
|---|---|---|
| D1 | The Connect source code, as a folder or archive with its Git history if possible | The owner provides it (§2) |
| D2 | GitHub repo name | `zev-hl/connect`, **private** |
| D3 | Render service name (becomes the address `<name>.onrender.com`, **cannot be changed later**) | `hlcentral-connect` |
| D4 | Render plan | **Standard** for production (§4.2 explains why not Starter) |
| D5 | Where the database lives | A **separate Neon project** `connect` in N. Virginia (§3) |
| D6 | Staging copy now or later | **Later**, when the Connect code changes for K4/K6/K7 start (§11) |
| D7 | SMTP account and the From address | Reuse HL Central's mail provider with its own From, e.g. `Connect <connect@…>` |
| D8 | First owner account: name, email, a temporary password | The owner's **HL Central address** (people are matched by email) |
| D9 | Custom domain, and who controls its DNS | Yes, both apps on one domain: e.g. `app.<domain>` + `connect.<domain>` (§8) |
| D10 | Calls: set up LiveKit now or later | Later is fine; decide before switching HL Central's link on (§7) |
| D11 | Workspace name shown in Connect (`WORKSPACE_NAME`) | e.g. `HL Central` |
| D12 | Who keeps the secrets (password manager / vault) | A shared vault the owner controls; `DATA_ENCRYPTION_KEY` above all |

---

## 2. Where the code comes from (GitHub)

Render deploys from a Git repository. Connect's source is **not** on GitHub
anywhere this account can see — only a local copy existed in another session.
So the first job is to put it in a private repo we own.

**The owner must provide the source (D1).** The owner has a local copy of the
full source (a pnpm monorepo with `pnpm-lock.yaml` and its own `render.yaml`).
Without it nothing below can start.

**Never put Connect's source in `zev-hl/healthy-tasks`.** That repo is public;
Connect's code is not ours to publish. It goes only in its own **private** repo.

1. **GitHub → New repository.** Owner `zev-hl`, name `connect` (D2),
   **Private**, no README / .gitignore / licence (the source brings its own).
2. On the machine holding the source:
   ```bash
   cd path/to/connect
   git status                       # if "not a git repository": git init && git add -A && git commit -m "Import Connect"
   git remote add origin git@github.com:zev-hl/connect.git
   git branch -M main
   git push -u origin main
   ```
   Before pushing, make sure no secrets are committed: look for `.env` files
   (`git ls-files | grep -i env`) and remove them from the commit if found.
3. **Check:** the repo page shows `apps/api`, `apps/web`, `packages/db`,
   `pnpm-lock.yaml`, `.node-version` (Node 22) and `package.json` with a
   `render:build` script. `.gitignore` excludes `node_modules` and `dist`.
4. **Give Render access to it.** Render → Account settings → *Git providers* →
   GitHub → *Configure* → in GitHub's Render app page, under *Repository
   access*, add `zev-hl/connect` (or "All repositories"). **Check:** in Render,
   *New → Web Service* lists `zev-hl/connect`.
5. Protect `main` in GitHub (Settings → Branches → require a pull request) if
   more than one person will push; Render deploys every commit to `main`.

---

## 3. The database (Neon)

### 3.1 The choice

Connect needs one Postgres database. Two ways to get it on our Neon account:

| | **A. New database inside HL Central's Neon project** | **B. Separate Neon project `connect`** (recommended) |
|---|---|---|
| Compute | **Shared** with HL Central's branch. In Neon a compute belongs to a branch, not to a database, so both apps run on the same machine. | Its own compute, sized and timed for Connect alone |
| Scale-to-zero | Connect needs it **off**, which keeps HL Central's production compute awake 24/7 too, undoing the Phase 14 savings (`docs/neon-cost-reduction-spec.md`: ~$75 → ~$2/month) | Off for Connect only; HL Central keeps suspending |
| Load | A busy Connect (Socket.IO, sweeps) slows HL Central and vice versa | Independent |
| Backups / restore | One restore window; restoring the branch for one app rolls the other back too | Each restored on its own |
| Branching for staging | A branch copies **both** apps' data | A branch copies Connect only |
| HL Central staging | Staging's Neon branch is kept tiny on purpose (0.25 CU fixed); a Connect database must **not** go there | Untouched |
| Cost | Roughly the same compute-hours (one always-on endpoint either way); saves at most the ~$2 HL Central spends now | One always-on 0.25 CU endpoint: ~$20–26/month (§12) |
| Admin | One project | One more project on the same Neon account and bill |

**Never put Connect's tables in HL Central's database.** Connect has its own
tables (`users`, `sessions`, `reminders`, `workspaces`, …) and Drizzle's own
migrations table; HL Central's Prisma tables (`"User"`, `"Reminder"`, …) differ
only by case and quoting and live in the same `public` schema. Sharing one
database invites confusion and makes either app's restore roll back the other.
So the minimum is a **separate database with its own role**; the question is
only whether it sits in HL Central's Neon project (A) or its own (B).

**Recommendation: B, a separate Neon project.** The money is about equal, and B
gives Connect its own compute (scaling with Connect's load, not HL Central's),
its own bill line, its own branches and restores, and keeps HL Central's
scale-to-zero savings intact.

### 3.2 Create it

1. **Neon console → New project.**
   - Name: `connect`.
   - Region: **AWS US East 1 (N. Virginia)** — the same as HL Central's Neon and
     the Render service. Region cannot be changed later. This matters a lot:
     Connect's team measured Render-Oregon → Neon-Ohio at about **614 ms per
     `select 1`** and message delivery p95 around 1 s, against a target under
     300 ms (Connect's `docs/migrate-neon-region.md`). Render Virginia + Neon
     N. Virginia, both chosen at creation, is what avoids that.
   - Postgres version: the version Connect is tested with. **⚠ check in Connect**
     (its docs or CI); if it says nothing, use the newest Neon offers.
   - Database name: `connect`. Neon also creates an owner role (e.g.
     `connect_owner`); keep it.
2. **Compute settings** (Branches → `main`/production → Computes → Edit):
   - **Scale to zero: off** (production). Connect keeps sockets open and runs
     background sweeps; suspending would add cold starts and break long queries.
   - Autoscaling: min **0.25 CU**, max **1 CU**. Raise the minimum only if the
     *Monitoring* page shows it pinned at the minimum during working hours.
3. **Restore window** (Settings → *Instant restore* / history retention): set it
   to the longest the plan allows (7 days on Launch when last checked — **check
   in Neon**). This is the "undo" for a bad migration (§10).
4. **Connection string:** *Connect* button → Database `connect`, role
   `connect_owner`, **Connection pooling: on**. Copy the string. **Check:** its
   host contains **`-pooler`** (e.g.
   `ep-xxxx-pooler.us-east-1.aws.neon.tech`) and it ends with
   `?sslmode=require` (keep any `channel_binding=require` Neon adds). This is
   `DATABASE_URL`. Store it in the vault.
5. Optional, belt and braces: a weekly `pg_dump` kept outside Neon (e.g. in R2).
   Remember the message bodies in it are encrypted: a dump is useless without
   `DATA_ENCRYPTION_KEY` (§4.4).

**Migrations through the pooler.** Connect's docs say to use the pooled string,
and its build runs `pnpm db:migrate` with it. If the migration step ever fails
with an error about prepared statements or advisory locks (PgBouncer
transaction mode), the fix is to run migrations with the **direct** string (the
same without `-pooler`). Whether Connect reads a separate variable for that is
**⚠ check in Connect** — `env.ts` lists no such variable, so it would be a small
change in Connect's `packages/db`.

---

## 4. The Render service

### 4.1 Blueprint or by hand

Connect's repo carries its own `render.yaml` (plan starter, region **oregon**,
branch main). **Create the service by hand** in the dashboard:

- It is one service; a Blueprint saves little.
- Render fixes **region and name at creation** and ignores later edits
  (`docs/render-virginia-migration.md`: HL Central's APIs were created in Oregon
  by mistake and had to be rebuilt). By hand, you see the region before clicking
  Create.
- A Blueprint from Connect's repo would create Oregon unless edited first, and
  then stays tied to that file.

Afterwards, update Connect's `render.yaml` in `zev-hl/connect` to match what was
created (name, `region: virginia`, plan) so the file describes reality. Do not
apply it as a Blueprint unless you mean to.

### 4.2 Create the Web Service

**Render → New → Project** `connect`, environment `production` (keeps it apart
from HL Central's `healthy-tasks` project, the way HL Central keeps production
and staging apart). After it exists: environment *Settings* → **Protected**.

Then in that environment **New → Web Service → `zev-hl/connect`**:

| Field | Value |
|---|---|
| Name | `hlcentral-connect` (D3) — gives `https://hlcentral-connect.onrender.com` if free. **Permanent.** |
| Region | **Virginia (US East)**. **Permanent.** Look at it twice. |
| Branch | `main` |
| Root directory | *(blank — the repo root)* |
| Runtime | Node |
| Build command | `pnpm run render:build` |
| Start command | `node --max-old-space-size=1536 apps/api/dist/index.js` |
| Instance type | **Standard** (2 GB RAM). See below. |
| Instances | 1 |

Then, under **Advanced** (or the service's Settings after creating):

| Setting | Value |
|---|---|
| Health check path | `/health` |
| Auto-deploy | On commit |
| Build filters → Ignored paths | `apps/mobile-v2/**` (also worth adding `apps/desktop/**`; neither is deployed) |
| Pre-deploy command | *(blank — migrations already run in the build)* |

**Why Standard, not Starter.** The start command lets Node's heap grow to
1,536 MB. A Starter instance has 512 MB of memory in total, so under load the
process can be killed for running out of memory long before Node's own limit
kicks in. Connect's own Blueprint uses Starter, so it may run fine at our size —
but production chat is the wrong place to find out. Standard (2 GB) fits the
1.5 GB heap. If cost matters more, start on Starter, watch *Metrics → Memory*
for a week, and move up (changing the instance type is allowed later; only
region and name are fixed). Free is not an option: it sleeps after idle and
drops sockets.

**Node and pnpm.** Render picks up Node 22 from `.node-version`. If the build log
says `pnpm: command not found`, change the build command to
`corepack enable && pnpm run render:build` (pnpm 9 comes from `packageManager`
in `package.json`). **⚠ check in Connect** whether its Render docs already say
which.

**Do not set `PORT` or `HOST`.** Render injects them.

**One instance, no autoscaling, no Redis.** The socket bus, presence, socket
tickets and rate limits are all held in the process today, so one instance needs
no Redis — and a second instance would split them. Redis (and code to use it)
must come before ever running two.

**Deploys drop open connections.** With one instance, every deploy closes all
WebSockets; clients reconnect and catch up, showing a "Reconnecting…" banner.
Deploy when the team is quiet. The migrations run during the build, while the
old version is still serving — so a migration must not break the running
version.

### 4.3 Environment variables

Enter these in the service's *Environment* page before the first deploy
finishes (or let the first deploy fail and redeploy after). Values marked 🔒 are
secrets: generate, put in the vault (D12), then paste.

**Required — fixed values**

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SERVE_WEB` | `true` |
| `COOKIE_SECURE` | `true` |
| `LOG_LEVEL` | `info` |
| `NODE_OPTIONS` | `--max-old-space-size=3072` (build heap; the web build needs ~2 GB) |

**Required — ours**

| Key | Value |
|---|---|
| `DATABASE_URL` 🔒 | the Neon pooled string from §3.2 |
| `WEB_ORIGIN` | `https://hlcentral-connect.onrender.com` (the CSRF allowlist — if wrong, **every write returns 403**) |
| `APP_URL` | the same address |
| `PUBLIC_APP_URL` | the same address (used in email links) |
| `WORKSPACE_NAME` | D11, e.g. `HL Central`. Whether it renames the built-in workspace (slug `brecx`, name "Brecx") or only the name shown: **⚠ check in Connect** |
| `DATA_ENCRYPTION_KEY` 🔒 | see §4.4 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` 🔒, `SMTP_FROM` | §5.2 |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_REPLY_TO` | as the provider needs (Gmail: port 465 + `SMTP_SECURE=true`, or 587 + `SMTP_REQUIRE_TLS=true`). Exact meaning **⚠ check in Connect** |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` 🔒, `R2_BUCKET` | §5.1 |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_NAME`, `SEED_OWNER_PASSWORD` 🔒 | D8; **delete after the first sign-in** (§6) |

`NODE_ENV=production` does not stop the build from getting its tools: the
build command installs dev dependencies on purpose (`--prod=false`).

**Leave unset now (optional; each turns a feature on)**

| Key(s) | What it is | Why off |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Calls | Until §7. **All three or none** — the API refuses to boot on a partial set |
| `PLATFORM_INTERNAL_URL`, `CONNECT_TO_PLATFORM_KEY_ID`, `CONNECT_TO_PLATFORM_SECRET`, `PLATFORM_ORIGIN`, `PLATFORM_ADMIN_*`, `PLATFORM_LINK_SWEEP`, `CONNECT_PROVISION_SECRET` | The Brecx Platform link (plans, billing, provisioning) | We have no Platform. Without it everyone is in the built-in **internal** workspace, which has every feature on and every limit unlimited (§9.2) |
| `APNS_*`, `FIREBASE_SERVICE_ACCOUNT`, `IOS_NOTIFICATION_FILTERING_FROM` | Mobile push | No mobile app of ours yet |
| `TICKET_BRECX_*`, `TICKET_LINKS`, `TICKET_SYNC_INTERVAL_MS` | The ticket app | Not ours |
| `WORKTRACK_*`, `CONNECT_TO_WORKTRACK_*` | WorkTrack | HL Central replaces it |
| `SITE_ORIGIN`, `LANDING_ORIGIN`, `LANDING_PAGE_URL`, `LEADS_NOTIFY_EMAIL` | Brecx's landing page | Not ours |
| `KLIPY_API_KEY` | GIF picker | Optional; add later if wanted |
| `GOOGLE_CALENDAR_API`, `GMAIL_API` | Google integrations | **⚠ check in Connect** what they enable |
| `CENTRAL_SIGNIN`, `CENTRAL_SIGNIN_ALLOW`, `CENTRAL_SIGNIN_URL`, `CENTRAL_AUTH_URL`, `CENTRAL_INVITES` | Central sign-in | Stage 5 (§9.6) |
| `SEED_ON_BOOT`, `SEED_USERS`, `SEED_RESET_PASSWORD` | Extra seeding | **Keep `SEED_RESET_PASSWORD` unset** (it may reset the owner's password on every boot — **⚠ check in Connect**). `SEED_OWNER_*` alone seeds the owner on our deploy (the log says `seeded owner <email>`, §4.5); if it doesn't, check `SEED_ON_BOOT` in `services/seed.ts` |
| `R2_INCLUDED_GB`, `R2_USD_PER_GB_MONTH` | Storage cost figures (likely for usage display) | Defaults are fine |
| `COOKIE_NAME`, `SESSION_TTL_DAYS`, `INVITE_TTL_DAYS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`, `MEETING_TOKEN_TTL_SECONDS`, `API_LOG` | Tuning | Defaults |
| `REMINDER_SWEEP`, `SCHEDULED_CALL_SWEEP`, `MEETING_SWEEP`, `WORKSPACE_PURGE_SWEEP` | Background sweeps | Defaults; **⚠ check in Connect** that they default to on in production |
| `HLCENTRAL_URL`, `HLCENTRAL_KEY` | Connect → HL Central (K6/K7) | Set in §9.4. Not in Connect's `env.ts` yet — they belong to the Connect changes still to be built |

### 4.4 `DATA_ENCRYPTION_KEY` — generate and back up first

It encrypts message bodies and meeting notes in the database.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- Put it in the vault **before** pasting it into Render, and in a second place
  the owner controls (a printed copy in a safe is fine). Render is not a backup.
- **Losing it means every encrypted message is unreadable for good**, including
  in every Neon restore and every dump.
- Never change it once messages exist. Whether Connect supports rotating it is
  **⚠ check in Connect**.
- Set it **before the first real message**. If it is ever added later, run once
  in the service's *Shell*: `pnpm --filter @brecx/api encrypt:backfill`.
- Without it the API stores plain text and logs a warning — watch for that
  warning in §4.5.

The other secrets (`SEED_OWNER_PASSWORD`, and later `HLCENTRAL_KEY`):
`openssl rand -base64 32` (or a password manager's generator).

### 4.5 First deploy and checks

Click **Deploy** (or *Manual Deploy → Deploy latest commit*). Watch the log:

1. `pnpm install` … then **`db:migrate`** runs against Neon (proves
   `DATABASE_URL` and the pooler work), then `pnpm build`.
   - **Exit 134** in the web build = JavaScript heap out of memory → raise
     `NODE_OPTIONS` (e.g. `--max-old-space-size=4096`).
   - **Exit 137** = the build machine itself ran out of memory → the build
     machine is too small. Render's larger build option (the *Performance*
     build pipeline, charged per build minute — **check in Render** for the
     current name and price) is the fix.
2. The service starts and the health check passes.

**Checks** (from Connect's `docs/deploy-render.md`, plus ours)

- Service *Settings* shows **Region: Virginia**. If not: delete it and recreate
  (§4.2) — it cannot be moved.
- The deploy log shows `[mail] SMTP ready at …`, `seeded owner <email>` and
  `Server listening at http://0.0.0.0:10000`.
- `curl -s https://hlcentral-connect.onrender.com/health` → `{"ok":true}`.
- `curl -s https://hlcentral-connect.onrender.com/api/v1/auth/me` →
  `{"user":null}` (the API answers and the database is reachable).
- Logs show **no** "data encryption key not set" warning.
- Neon → project `connect` → *Tables* shows Connect's tables.
- The address opens Connect's sign-in page.

**Troubleshooting** (Connect's `docs/deploy-render.md`)

| Symptom | Cause |
|---|---|
| Sign-in succeeds, then you are signed straight out | `COOKIE_SECURE` is not `true` |
| Reads work, every write is 403 | `WEB_ORIGIN` does not match the address in the browser |
| Dead links in invitation emails | `PUBLIC_APP_URL` |
| `drizzle-kit: not found` in the build | dev dependencies not installed — the build command must keep `--prod=false` |
| The migrate step fails | `DATABASE_URL` unset or unreachable |
| Lockfile error (`--frozen-lockfile`) | run `pnpm install` locally and commit `pnpm-lock.yaml` |
| Slow after being idle | a Free instance, or Neon scale-to-zero left on |

---

## 5. Storage and email

### 5.1 Cloudflare R2 (attachments)

HL Central's files are already in R2 on our Cloudflare account; Connect gets its
own bucket and its own token.

1. **Cloudflare → R2 → Create bucket** `hl-connect`, location hint *Eastern
   North America*. **Public access: off** (no r2.dev URL, no custom domain).
2. **Bucket → Settings → CORS policy:**
   ```json
   [
     {
       "AllowedOrigins": ["https://hlcentral-connect.onrender.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Add the custom domain here too when §8 happens.
3. **R2 → Manage API tokens → Create Account API token**: permission
   **Object Read & Write**, applied to **`hl-connect` only**. Copy the Access
   Key ID and Secret (shown once) into the vault.
4. Render: `R2_ACCOUNT_ID` (the account id on the R2 overview page),
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=hl-connect`.
5. **Check (after §6):** attach a file in a chat, reload, open it. A CORS error
   in the browser console means the CORS rule's origin is wrong.

### 5.2 Email (SMTP)

Carries invitations, 2FA codes and notification emails. **In production 2FA
enrolment refuses to start without mail**, and invitations are the only way in
(no self sign-up), so this is required.

1. Pick the account (D7). A Google Workspace mailbox with an **App Password**
   works: `smtp.gmail.com`, port 465 (`SMTP_SECURE=true`) or 587. Workspace
   limits sending to ~2,000/day per mailbox — plenty for us.
2. Set `SMTP_*` and `SMTP_FROM` in Render (§4.3).
3. **Check:** service *Shell* → `pnpm --filter @brecx/api mail:test` and confirm
   the mail arrives (and not in spam). Then send yourself an invitation in §6.

---

## 6. First sign-in and the workspace

The fresh database holds one built-in workspace (made by migration
`0077_platform_core.sql`: slug `brecx`, plan `internal`, billing-exempt, never
suspended). The seeded owner and everyone invited go into it. Sign-up is closed
(`signup.open = false`), so invitations are the only way in.

1. Open `https://hlcentral-connect.onrender.com`, sign in with
   `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`. If the account does not exist,
   see the `SEED_ON_BOOT` note in §4.3.
2. Send yourself (another address) an invitation — proves email and
   `PUBLIC_APP_URL`. Change the password; turn on 2FA.
3. **Render → Environment: delete all three `SEED_OWNER_*`.** Save → redeploy.
4. **Settings:** confirm the workspace name, and that **API access** and
   **scheduled calls** show (they should — §9.2).
5. **Invite people with their HL Central email addresses** — exactly the same
   address, because both apps match people by email. A typo means HL Central's
   notices and calls never reach that person. A practical way: export the
   active users from HL Central's Admin → Users screen, invite those.

**Check:** a second person accepts an invitation, both of you exchange messages
and an attachment.

---

## 7. Calls (LiveKit) — optional at first

### 7.1 What works without it

Every live call in Connect runs on LiveKit (`services/rtc/provider.ts`), and
LiveKit counts as set up only when all three `LIVEKIT_*` are set. (The old
`MEETINGS_PROVIDER` switch is obsolete; ignore it.)

- Chat, groups, attachments, notifications, scheduled-call cards and their
  reminders: **all work**.
- **Joining** a call: **fails** until LiveKit exists.
- From HL Central (K2 "Call on a task"): booking at a time succeeds — the call's
  card appears in Connect and HL Central's event gets the join link — but nobody
  can join it. HL Central has no separate switch to hide "Call" while chat is
  on: once `CONNECT_URL` is set the button shows.

**So:** do LiveKit as its own phase **after the first deploy and before HL
Central's Call button is announced**. If HL Central is linked earlier (for
notices and chat), tell people "calls are coming; don't use Call yet".

### 7.2 Setting it up (Connect's checklist)

1. **DigitalOcean → Create Droplet:** Ubuntu LTS, **Basic, Regular, 4 GB / 2
   vCPU ($24/month)**, region **NYC** (near users and Virginia). Add an SSH key.
   Optional backups +20%.
2. **Networking → Reserved IPs:** assign one to the droplet (free while
   assigned), so DNS survives a rebuild.
3. **DNS:** an A record `rtc.<domain>` → the Reserved IP (and `turn.<domain>`
   if the generator asks for a separate TURN name). Proxying off (if the DNS is
   Cloudflare: grey cloud, "DNS only").
4. **Firewall** (DigitalOcean → Networking → Firewalls), inbound:
   TCP 22 (better: your IP only), 80, 443, 7881; UDP 3478, 50000–60000.
5. On the droplet: install Docker, run LiveKit's config generator
   (`docker run --rm -it -v$PWD:/output livekit/generate`): single node,
   **TURN on**, your `rtc.` domain. It writes the config, a Caddy front for TLS,
   and the API key/secret. Start it as it instructs.
6. Render: `LIVEKIT_URL=wss://rtc.<domain>`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET` 🔒 — **all three at once** — then redeploy.
7. **Check:** the deploy boots; two people on different networks (one on a phone
   off Wi-Fi) hold a call with camera and screen share for a few minutes. Then
   from HL Central (after §9): "Call on a task" → *now* rings in Connect.

---

## 8. Address and domain

### 8.1 Start: the onrender.com address

Go live on `https://hlcentral-connect.onrender.com`. Everything in Connect works
there when used in its own tab.

### 8.2 The problem: the chat pop-up is cross-site

HL Central's chat pop-up (K1) puts Connect in a frame on HL Central's page.

- `onrender.com` is on the **Public Suffix List**, so `hlcentral.onrender.com`
  and `hlcentral-connect.onrender.com` are **different sites**, as unrelated as
  two companies' domains.
- Inside the frame, Connect's session cookie is then a **third-party cookie**. It
  is only sent if it is `SameSite=None; Secure`. Connect does set that when
  `COOKIE_SECURE=true` (and `Lax` on plain HTTP; `services/sessions.ts`), so
  framing from another site **can** work.
- But **Safari, Brave and private/incognito windows block third-party cookies**
  in frames (Firefox partitions them; Chrome users or company policies may block
  them). Those people would see the frame ask them to sign in, or fail to sign
  in. "Open in Connect" (a new tab) always works. The same-site custom domain
  below is the lasting fix.

### 8.3 The fix: both apps on one domain (recommended)

Serve both under one registrable domain we own, e.g.:

- `app.<domain>` → HL Central's web (`hlcentral` static site)
- `api.<domain>` → HL Central's API (optional, but tidy)
- `connect.<domain>` → Connect (`hlcentral-connect`)

Then the frame is **same-site**: the cookie is sent whether it is `Lax` or
`None`, and no browser blocks it. `<domain>` is D9: the company domain or one
bought for this. (Serving HL Central on `*.brecx.com`, which Connect already
allows, only makes sense if we control `brecx.com` — we don't, as far as we
know.)

**Steps for Connect's domain** (Render custom domains are included on paid
plans, with free TLS):

1. Render → `hlcentral-connect` → *Settings → Custom Domains* → add
   `connect.<domain>`.
2. DNS: a CNAME `connect` → `hlcentral-connect.onrender.com` (Cloudflare: DNS
   only). Wait for Render to show *Verified* and the certificate *Issued*.
3. Change together, in one save: `WEB_ORIGIN`, `APP_URL`, `PUBLIC_APP_URL` →
   `https://connect.<domain>`. (Whether `WEB_ORIGIN` takes more than one origin
   is **⚠ check in Connect**; assume one, so after this the onrender address
   is read-only.) Redeploy.
4. R2 CORS: add `https://connect.<domain>`.
5. LiveKit: nothing changes.
6. HL Central: `CONNECT_URL=https://connect.<domain>` (§9.3).
7. Optional: in Render, turn off the default `onrender.com` subdomain so there is
   one address.

**Moving HL Central to `app.<domain>` is a separate HL Central change**, done the
way `docs/render-virginia-migration.md` lists cross-references:
`CORS_ORIGIN` and `FRONTEND_URL` on `hlcentral-api`; `VITE_API_URL` and
`VITE_QUEUE_DASHBOARD_URL` on the `hlcentral` site (build-time: rebuild); the
Google OAuth client's authorised origins; HL Central's R2 bucket CORS; and
Connect's frame allowlist (§8.4). Plan it as its own small project; it is
not needed to go live.

### 8.4 Connect must allow HL Central to frame it (a code change)

Connect's `frame-ancestors` rule allows `*.brecx.com` plus the list
`EMBED_EXCEPTIONS` in `apps/api/src/app.ts`. HL Central's address is in neither,
so **until this change ships the pop-up frame stays blank** (the browser
refuses). This needs a commit in `zev-hl/connect`:

- Add `https://hlcentral.onrender.com` (production web) to `EMBED_EXCEPTIONS`.
- Add `https://app.<domain>` too once §8.3 happens.
- Staging (`https://hlcentral-staging.onrender.com`) and the redesign preview
  (`https://hlcentral-redesign.onrender.com`) only if staging HL Central is ever
  linked to a Connect (§11).
- Better: make the list come from an env var (e.g. `EMBED_ORIGINS`,
  comma-separated) so a new address needs no code. A suggestion; not in Connect
  today.

**Check:** open HL Central, click the chat button: Connect loads in the frame
(signed in, on browsers that allow it — §8.2). The browser console shows no
`frame-ancestors` error. HL Central's own pages send no CSP, so nothing needs
changing on HL Central's side for the frame itself.

---

## 9. Linking HL Central and Connect

From `docs/connect-changes.md` §1. Do it once §4–§6 pass (and §7 if calls
should work from day one).

### 9.1 Mint the key in Connect

Connect → **Settings → Misc → API access** → new key, **read/write**, named
**`HL Central`**. It is shown once: straight into the vault. (A send-only token
is not enough: K4 reads people's calendars.)

### 9.2 Bots and scheduled calls must be on

HL Central's notices (K3) go out as the HL Central bot, and "Call on a task" with
a time (K2) books a scheduled call; booking returns **403** if the workspace's
plan lacks either. With no Platform link everyone is in the built-in workspace,
plan `internal`, and an internal workspace has **every feature on and every
limit unlimited** (`tenancy/entitlements.ts`). So bots, API keys and scheduled
calls are available out of the box. Confirm it anyway:

1. In Connect's Settings, **API access** and **scheduled calls** are there.
2. Test directly with the key:
   ```bash
   curl -s -H "Authorization: Bearer $CONNECT_API_KEY" \
     https://hlcentral-connect.onrender.com/api/v1/bots/convenes
   ```
   A JSON answer (even an empty list) is good; **403** means not allowed.
3. **If it is 403 anyway:** check the workspace row in the database
   (`plan = 'internal'`, `is_internal = true` for id
   `00000000-0000-7000-8000-000000000001`) — something has changed it. Do
   **not** link the Platform to fix this.

### 9.3 Set HL Central's side

Render → `healthy-tasks` project → **production** → `hlcentral-api` →
*Environment* (production is Protected: lift protection for this, then
re-protect):

| Key | Value |
|---|---|
| `CONNECT_URL` | `https://hlcentral-connect.onrender.com` (later `https://connect.<domain>`), no trailing slash |
| `CONNECT_API_KEY` 🔒 | the key from §9.1 |
| `CONNECT_INBOUND_KEY` 🔒 | `openssl rand -base64 48` (32+ characters, or it stays off) |

*Save and deploy.*

These three are not in `render.yaml` today. Setting them in the dashboard works,
but add them to `render.yaml` as `sync: false` entries (production, and staging
if it is linked) in a follow-up change on `main`, so the Blueprint documents
them.

**Do not link staging HL Central to production Connect.** Staging's data has
real people's addresses: its notices and calls would reach them. Staging stays
unlinked until a staging Connect exists (§11).

**Checks (HL Central)**

- Signed in to HL Central: the **chat button** appears on every page; the
  notification settings show a **Connect** column. (`GET /api/connect` answers
  linked.)
- Turn on a Connect notice for yourself, then trigger one (comment on a task you
  follow): the HL Central bot messages you in Connect, with a link back.
- **Discuss in Connect** on a task: a group appears in Connect with the right
  people and a link back.
- **Call on a task** (if §7 is done): *now* rings; *at a time* books, and the
  event shows Connect's join link.
- Calendar → "Connect calls" layer shows nothing yet (K4's endpoint is not built
  in Connect; HL Central treats its 404 as "not yet"). Expected.
- Inbound key works:
  ```bash
  curl -s -H "Authorization: Bearer $CONNECT_INBOUND_KEY" \
    "https://hlcentral-api.onrender.com/api/integrations/connect/tasks?as=<your HL Central email>"
  ```
  → `{ "tasks": [ … ] }`. 401 = wrong key; 404 = no active HL Central user with
  that address.

### 9.4 Set Connect's side

On `hlcentral-connect`:

| Key | Value |
|---|---|
| `HLCENTRAL_URL` | `https://hlcentral-api.onrender.com` — HL Central's **API**, not its web site |
| `HLCENTRAL_KEY` 🔒 | the **same** value as HL Central's `CONNECT_INBOUND_KEY` |

These are for the Connect-side features still to be built (K6 "Create task in
HL Central", K7 the HL Central section and timer; `docs/connect-changes.md`
§4–§5). Connect's current `env.ts` does not read them, so setting them now
changes nothing until that code ships. Setting them now saves a step later.

### 9.5 Matching people

Accounts are matched **by email** in both directions. Anyone whose Connect
address differs from their HL Central address gets no notices and cannot be
added to task groups or calls. When someone's HL Central address changes (Admin
edit), change it in Connect too.

### 9.6 Later: Stage 5, HL Central as the sign-in hub

Stage 5 of the Nov 2026 plan will make HL Central the place people sign in, and
Connect has `CENTRAL_SIGNIN`, `CENTRAL_SIGNIN_ALLOW`, `CENTRAL_SIGNIN_URL`,
`CENTRAL_AUTH_URL` and `CENTRAL_INVITES` for that. **Not part of this plan**;
leave them unset. It is one more reason to put both apps on one domain (§8.3).

---

## 10. Order, checks and rollback

| Step | Do | Check | Roll back |
|---|---|---|---|
| 1 | §2 source → `zev-hl/connect`, Render access | Render lists the repo | Delete the repo |
| 2 | §3 Neon project `connect` | Pooled string has `-pooler`, region N. Virginia | Delete the project (nothing uses it) |
| 3 | §5.1 R2 bucket + token + CORS | Token scoped to `hl-connect` | Delete bucket and token |
| 4 | §5.2 SMTP account | — | — |
| 5 | §4.4 generate secrets, vault them | Two copies of `DATA_ENCRYPTION_KEY` exist | — |
| 6 | §4.2–4.3 Render service + env | Region **Virginia** before anything else | Delete the service (name becomes free again) |
| 7 | §4.5 first deploy | `/health`, tables in Neon, no warnings | Fix and redeploy |
| 8 | §5.2 `mail:test`, §6 owner, 2FA, delete seed password, invite 1 person | Two people chat with an attachment | — |
| 9 | §8.4 Connect `EMBED_EXCEPTIONS` commit | Pop-up frame loads (once linked) | Revert the commit |
| 10 | §7 LiveKit — after the first deploy, before Call is announced | A real two-person call | Unset all three `LIVEKIT_*` together; power off droplet |
| 11 | §9.1–9.2 key, bots, scheduled calls | `curl …/bots/convenes` is not 403 | Revoke the key |
| 12 | §9.3 HL Central env | The checks in §9.3 | **Unset `CONNECT_URL` and `CONNECT_API_KEY`** on `hlcentral-api` → every Connect feature in HL Central switches off; calls already booked stay as meetings |
| 13 | §9.4 Connect env | — | Unset |
| 14 | §6 step 5: invite everyone with HL Central addresses | — | — |
| 15 | §8.3 custom domain (when D9 is settled) | Pop-up signed in on Safari too | Point `CONNECT_URL`/`WEB_ORIGIN`… back at onrender.com |

**Rollback notes for Connect itself**

- Render's *Rollback* to an earlier deploy brings the old code back but **does
  not undo migrations** — they ran in the build. A migration that breaks the old
  code needs a Neon restore: Neon → project `connect` → *Restore* the branch to a
  time just before the deploy (messages sent since are lost) — or restore into a
  new branch and point `DATABASE_URL` at it to inspect first.
- Because the build migrates, **even a build that fails later can have changed
  the schema**. Before deploying a Connect change with migrations, note the time
  (for the restore point).
- A restore is only readable with the same `DATA_ENCRYPTION_KEY`.

---

## 11. A staging copy?

HL Central has production and staging in separate Render environments. For
Connect:

- **Not at first.** Connect starts as a stock copy plus a one-line frame change;
  production alone is enough to go live.
- **Yes, once Connect's code starts changing** for K4, K6 and K7
  (`docs/connect-changes.md` §3–§5), and to test HL Central staging against
  something without messaging real people.

If made: Render `connect` project → environment `staging` →
`hlcentral-connect-staging`, **Starter**, Virginia, branch `staging`; a Neon
branch `staging` in the `connect` project (0.25 CU fixed, **scale-to-zero on**),
made when production is still nearly empty or as a schema-only branch so it holds
no real messages; its own R2 bucket (`hl-connect-staging`) and token; its own
`DATA_ENCRYPTION_KEY`; the same LiveKit droplet with a second key pair if calls
are needed. Then link HL Central staging (its own key, its own inbound key) and
add `hlcentral-staging` / `hlcentral-redesign` to the frame allowlist.

**Staging cost:** Render Starter $7 + Neon ~$1–3 (asleep most of the time) + R2
~$0 ≈ **$8–10/month**.

---

## 12. Cost estimate (production, per month)

Prices as last known; check each dashboard before deciding.

| Item | Low | Recommended |
|---|---|---|
| Render web service | Starter **$7** | Standard **$25** |
| Neon project `connect` (0.25 CU always on ≈ 183 CU-hours; we paid ~$0.106/CU-hour in Aug 2026, list price may be higher) + storage (cents) | ~$20 | ~$20–26 (+ autoscaling peaks) |
| Cloudflare R2 (10 GB and the first million writes free; then $0.015/GB-month) | $0 | $0–2 |
| SMTP (existing mailbox) | $0 | $0 |
| **Without calls** | **~$27** | **~$45–55** |
| DigitalOcean droplet 4 GB / 2 vCPU (+ $4.80 backups, optional) | $24 | $24–29 |
| **With calls** | **~$51** | **~$70–85** |
| Custom domain (if a new one is bought) | ~$1/month | ~$1/month |
| Staging later (§11) | +$8–10 | +$8–10 |

Render build minutes may add a little if the larger build pipeline is needed
(§4.5).

---

## 13. Things to check in Connect (could not be verified from here)

1. Postgres version Connect expects (§3.2).
2. Whether migrations need a direct (non-pooled) URL, and if a variable exists
   for it (§3.2).
3. Whether Render's build needs `corepack enable` for pnpm (§4.2).
4. `SMTP_SECURE` / `SMTP_REQUIRE_TLS` / `SMTP_REPLY_TO` exact meaning (§4.3).
5. Whether `SEED_ON_BOOT` matters for `SEED_OWNER_*`; what `SEED_RESET_PASSWORD`
   does (§4.3).
6. Whether `WORKSPACE_NAME` renames the built-in workspace or only the name
   shown (§4.3).
7. What `GOOGLE_CALENDAR_API` and `GMAIL_API` enable (§4.3).
8. The sweeps' defaults in production (§4.3).
9. Whether `DATA_ENCRYPTION_KEY` can be rotated (§4.4).
10. Whether `WEB_ORIGIN` accepts several origins (§8.3).
11. That `HLCENTRAL_URL` / `HLCENTRAL_KEY` are the names the K6/K7 code will
    read (§9.4).

Settled from the source since the first draft: one instance needs no Redis;
calls are LiveKit only (`MEETINGS_PROVIDER` is obsolete); a booking without
LiveKit succeeds but can't be joined; the cookie is `SameSite=None` with
`COOKIE_SECURE=true`; the internal workspace has bots, API keys and scheduled
calls.

---

## 14. Final checklist

- [ ] Connect source in private `zev-hl/connect`; Render can see it
- [ ] Neon project `connect`, N. Virginia, scale-to-zero **off**, restore window at max
- [ ] `DATABASE_URL` is the **pooled** string (`-pooler`)
- [ ] R2 bucket `hl-connect`: private, CORS for Connect's origin, token scoped to it
- [ ] SMTP set; `mail:test` delivered
- [ ] `DATA_ENCRYPTION_KEY` generated, **in two places outside Render**, set before the first message
- [ ] Render service `hlcentral-connect`: **Virginia**, Standard, branch `main`,
      `pnpm run render:build`, start command as §4.2, `/health`, ignored paths
- [ ] `NODE_ENV`, `SERVE_WEB`, `COOKIE_SECURE`, `LOG_LEVEL`, `NODE_OPTIONS` set; `PORT`/`HOST` **not** set
- [ ] `WEB_ORIGIN` = `APP_URL` = `PUBLIC_APP_URL` = the public address
- [ ] First deploy green; tables in Neon; no encryption warning
- [ ] Deploy log shows `SMTP ready`, `seeded owner`, `Server listening`; `/health` → `{"ok":true}`; `/api/v1/auth/me` → `{"user":null}`
- [ ] Owner signed in, invite to self received, 2FA on, all `SEED_OWNER_*` deleted
- [ ] Render `connect` project's production environment **Protected**
- [ ] `EMBED_EXCEPTIONS` includes HL Central's address (Connect commit deployed)
- [ ] Bots and scheduled calls available (`/api/v1/bots/convenes` not 403)
- [ ] "HL Central" read/write key minted and vaulted
- [ ] `CONNECT_URL`, `CONNECT_API_KEY`, `CONNECT_INBOUND_KEY` on `hlcentral-api` (production only)
- [ ] `HLCENTRAL_URL`, `HLCENTRAL_KEY` on Connect
- [ ] §9.3 checks pass (notice, Discuss, inbound curl; Call if LiveKit is up)
- [ ] Everyone invited with their **HL Central** email address
- [ ] LiveKit set up and tested **before** HL Central's Call button is announced
- [ ] One instance only; autoscaling off; deploys timed for quiet hours
- [ ] Custom domain decided (D9) and scheduled
- [ ] `render.yaml` (HL Central) gets `CONNECT_*` as `sync: false` in a follow-up
- [ ] Connect's own `render.yaml` updated to match what was created
