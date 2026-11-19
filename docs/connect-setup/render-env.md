# Connect's Render environment (`hlcentral-connect`)

Render → `connect` project → `production` → `hlcentral-connect` →
*Environment*. 🔒 = secret: take it from the vault (`secrets.md`), never write
it anywhere else.

Variable names are from Connect's `apps/api/src/env.ts` and `render.yaml` as
read in another session (plan §4.3, §13). Before pasting, open Connect's
`.env.example` (or `env.ts`) in `zev-hl/connect` and **confirm each name**;
any mismatch, Connect's file wins — fix this page.

`<APP>` below = `https://hlcentral-connect.onrender.com` now; with a custom
domain later (plan §8.3), see the end of this page.

## Required

| Key | Put | Comes from |
|---|---|---|
| `NODE_ENV` | `production` | fixed |
| `SERVE_WEB` | `true` (the API serves the web app — one service) | fixed |
| `COOKIE_SECURE` | `true` (else sign-in bounces straight out) | fixed |
| `NODE_OPTIONS` | `--max-old-space-size=3072` (build heap; the web build needs ~2 GB) | fixed |
| `DATABASE_URL` 🔒 | Neon **pooled** string (`-pooler` host, `sslmode=require`). The only database variable — migrations use it too (§13 #2) | `neon.md` step 4 |
| `WEB_ORIGIN` | `<APP>`. Comma-separated list of **Connect's own** addresses (§13 #10). Not HL Central's. Wrong = every write 403 | Render service URL |
| `APP_URL` | `<APP>` | same |
| `PUBLIC_APP_URL` | `<APP>` (email links) | same |
| `DATA_ENCRYPTION_KEY` 🔒 | 32 random bytes, base64. **Set before the first message, never change** (§13 #9) | `secrets.md` |
| `SMTP_HOST` | the provider's host, e.g. `smtp.gmail.com` | mail provider (plan D7) |
| `SMTP_PORT` | `587` | §13 #4 |
| `SMTP_USER` | the sending mailbox | mail provider |
| `SMTP_PASS` 🔒 | the mailbox's App Password | mail provider, `secrets.md` |
| `SMTP_FROM` | e.g. `Connect <connect@…>` | owner's choice (D7) |
| `R2_ACCOUNT_ID` | the account id on Cloudflare's R2 overview page | Cloudflare (plan §5.1) |
| `R2_ACCESS_KEY_ID` 🔒 | token scoped to bucket `hl-connect` | Cloudflare, `secrets.md` |
| `R2_SECRET_ACCESS_KEY` 🔒 | same token | Cloudflare, `secrets.md` |
| `R2_BUCKET` | `hl-connect` | plan §5.1 |
| `SEED_OWNER_EMAIL` | the owner's **HL Central** address (D8) | owner |
| `SEED_OWNER_NAME` | the owner's name | owner |
| `SEED_OWNER_PASSWORD` 🔒 | temporary password | `secrets.md` |

**After the first deploy and the owner's first sign-in** (§13 #5): set
`SEED_ON_BOOT=false`, delete `SEED_OWNER_PASSWORD` (and, tidiest, the other two
`SEED_OWNER_*`), save, redeploy. The seed is keyed by email and never deletes
anything; turning it off just stops it running at every boot.

## Recommended

| Key | Put | Why |
|---|---|---|
| `LOG_LEVEL` | `info` | plan §4.3 |
| `SMTP_REQUIRE_TLS` | `true` (also the default: on unless `false`). Never `false` | refuses to send without TLS (§13 #4) |
| `SMTP_REPLY_TO` | an address people can reply to, if not `SMTP_FROM` | default Reply-To |
| `WORKSPACE_NAME` | e.g. `HL Central` (D11). **Display only** — emails and invite pages. Also rename the workspace in Connect's own Settings (§13 #6) | |
| `SEED_ON_BOOT` | `false` **after** the first deploy (see above). Leave unset for the first deploy | §13 #5 |

## Later (set when the step comes)

| Key | When | Notes |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` 🔒 | Calls, plan §7, before HL Central's Call button is announced | **All three or none** — the API refuses to boot on a partial set |
| `HLCENTRAL_URL` | K6/K7 (plan §9.4) | `https://hlcentral-api.onrender.com` — HL Central's **API**, not its web site |
| `HLCENTRAL_KEY` 🔒 | K6/K7 | the **same** value as HL Central's `CONNECT_INBOUND_KEY`. Connect reads neither yet (§13 #11); setting them early does nothing harmful |
| `KLIPY_API_KEY` 🔒 | if a GIF picker is wanted | optional |

## Leave unset

| Key(s) | Why |
|---|---|
| `PORT`, `HOST` | Render injects them |
| `SMTP_SECURE` | unset = STARTTLS on 587 (`true` would mean TLS from the start, port 465) — §13 #4 |
| `SEED_RESET_PASSWORD` | **Never on.** While `true` it resets the owner's password and signs them out on **every boot** (§13 #5) |
| `SEED_USERS` | extra seeding — not wanted |
| `GOOGLE_CALENDAR_API`, `GMAIL_API` | base addresses of Google's APIs for test scripts, not switches (§13 #7) |
| `PLATFORM_INTERNAL_URL`, `CONNECT_TO_PLATFORM_KEY_ID`, `CONNECT_TO_PLATFORM_SECRET`, `PLATFORM_ORIGIN`, `PLATFORM_ADMIN_*`, `PLATFORM_LINK_SWEEP`, `CONNECT_PROVISION_SECRET` | the Brecx Platform; without it everyone is in the built-in internal workspace (every feature on, no limits) |
| `APNS_*`, `FIREBASE_SERVICE_ACCOUNT`, `IOS_NOTIFICATION_FILTERING_FROM` | mobile push — no mobile app |
| `TICKET_BRECX_*`, `TICKET_LINKS`, `TICKET_SYNC_INTERVAL_MS` | the ticket app — not ours |
| `WORKTRACK_*`, `CONNECT_TO_WORKTRACK_*` | WorkTrack — HL Central replaces it |
| `SITE_ORIGIN`, `LANDING_ORIGIN`, `LANDING_PAGE_URL`, `LEADS_NOTIFY_EMAIL` | Brecx's landing page |
| `CENTRAL_SIGNIN`, `CENTRAL_SIGNIN_ALLOW`, `CENTRAL_SIGNIN_URL`, `CENTRAL_AUTH_URL`, `CENTRAL_INVITES` | Stage 5, not this plan |
| `REMINDER_SWEEP`, `SCHEDULED_CALL_SWEEP`, `MEETING_SWEEP`, `WORKSPACE_PURGE_SWEEP` | on by default in production (§13 #8) |
| `R2_INCLUDED_GB`, `R2_USD_PER_GB_MONTH`, `COOKIE_NAME`, `SESSION_TTL_DAYS`, `INVITE_TTL_DAYS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`, `MEETING_TOKEN_TTL_SECONDS`, `API_LOG` | defaults are fine |
| `MEETINGS_PROVIDER` | obsolete |

## When the custom domain comes (plan §8.3)

In one save: `WEB_ORIGIN=https://connect.<domain>,https://hlcentral-connect.onrender.com`
(both keep working, §13 #10), `APP_URL` and `PUBLIC_APP_URL` →
`https://connect.<domain>`. Add the domain to R2's CORS too. Redeploy.
