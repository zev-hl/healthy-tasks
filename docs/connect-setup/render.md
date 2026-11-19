# Render: the `hlcentral-connect` web service

Plan §4 (with §13). **One** Web Service holds Connect's API, Socket.IO and the
web app — **no Static Site** (it would break sign-in). Created **by hand**, not
from Connect's `render.yaml` (that file says Oregon/Starter). Who: **owner**
clicks Create (or the developer with access); the developer fills the env.

## Before you start

- `zev-hl/connect` exists, holds the source, and Render can see it:
  Render → Account settings → *Git providers* → GitHub → *Configure* → GitHub's
  Render app page → *Repository access* → add `zev-hl/connect`.
- Neon `DATABASE_URL`, SMTP, R2 and `DATA_ENCRYPTION_KEY` are in the vault
  (`neon.md`, `secrets.md`).

## 1. Project and environment

1. **Render → New → Project** → name `connect`, environment `production`.
2. Environment *Settings* → **Protected** (after the setup below is finished
   if protection gets in the way; lift it only to change env, then re-protect).

## 2. New → Web Service → `zev-hl/connect`

| Field | Value |
|---|---|
| Name | `hlcentral-connect` → `https://hlcentral-connect.onrender.com`. **Permanent.** |
| Region | **Virginia (US East)**. **Permanent.** Look at it twice. |
| Branch | `main` |
| Root directory | *(blank)* |
| Runtime | Node (Node 22 from `.node-version`; pnpm from the lockfile — no `corepack` needed, §13 #3) |
| Build command | `pnpm run render:build` (installs dev deps, runs `pnpm db:migrate`, builds) |
| Start command | `node --max-old-space-size=1536 apps/api/dist/index.js` |
| Instance type | **Standard** (2 GB — fits the 1.5 GB heap; Starter's 512 MB does not) |
| Instances | **1**, autoscaling **off** (socket bus, presence and rate limits live in the process) |

**Advanced** (or Settings after creating):

| Setting | Value |
|---|---|
| Health check path | `/health` |
| Auto-deploy | On commit |
| Build filters → Ignored paths | `apps/mobile-v2/**`, `apps/desktop/**` |
| Pre-deploy command | *(blank — migrations run in the build)* |

## 3. Environment

Fill the service's *Environment* page from [`render-env.md`](render-env.md)
before the first deploy finishes (or let it fail once and redeploy). Do **not**
set `PORT` or `HOST`.

## 4. First deploy — watch the log

1. `pnpm install` → **`db:migrate`** against Neon → `pnpm build`.
   - Exit **134** (JS heap out of memory in the web build): raise
     `NODE_OPTIONS` to `--max-old-space-size=4096`.
   - Exit **137** (the build machine out of memory): use Render's larger build
     pipeline (check its current name/price in Render).
   - A failed migration fails the build; the old version (if any) keeps serving.
2. The service starts and the health check passes.

## 5. Post-deploy checks

- [ ] Service *Settings* shows **Region: Virginia** (if not: delete and recreate)
- [ ] Log shows `[mail] SMTP ready at …`, `seeded owner <email>`, `Server listening at http://0.0.0.0:10000`
- [ ] Log shows **no** "data encryption key not set" warning
- [ ] `curl -s https://hlcentral-connect.onrender.com/health` → `{"ok":true}`
- [ ] `curl -s https://hlcentral-connect.onrender.com/api/v1/auth/me` → `{"user":null}`
- [ ] Neon → `connect` → *Tables* shows Connect's tables
- [ ] The address opens Connect's sign-in page
- [ ] Service *Shell*: `pnpm --filter @brecx/api mail:test` → the mail arrives (not in spam)

Then the first sign-in steps in `first-deploy-checklist.md` (owner, invite,
2FA, seed cleanup).

## Troubleshooting (Connect's `docs/deploy-render.md`)

| Symptom | Cause |
|---|---|
| Signed in, then straight out | `COOKIE_SECURE` not `true` |
| Reads work, every write 403 | `WEB_ORIGIN` doesn't list the address in the browser |
| Dead links in invitation emails | `PUBLIC_APP_URL` |
| `drizzle-kit: not found` | dev deps not installed — build command changed |
| Migrate step fails | `DATABASE_URL` unset/unreachable |
| `--frozen-lockfile` error | commit an up-to-date `pnpm-lock.yaml` in `zev-hl/connect` |
| Slow after idle | Free instance, or Neon scale-to-zero left on |

## Deploys

Every deploy drops all WebSockets (clients reconnect, "Reconnecting…").
Deploy when the team is quiet. Render *Rollback* does **not** undo migrations
— note the time before a deploy with migrations (the Neon restore point).

## Afterwards

Update `render.yaml` in `zev-hl/connect` to match what was created (name,
`region: virginia`, plan Standard). Don't apply it as a Blueprint.
