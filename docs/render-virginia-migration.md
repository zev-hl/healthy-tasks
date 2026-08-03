# Render Migration — Virginia region + HLCentral URLs

**Status:** PROPOSED (not yet executed). Review before touching prod infra.
**Two goals, one operation:**
1. Move the API services to **Virginia (us-east-1)** so they sit next to the Neon DB
   (currently Oregon — confirmed in dashboard 2026-08-02 — causing slow DB-backed
   requests via coast-to-coast query round-trips).
2. Rename all four service URLs from `healthy-tasks-*` to **HLCentral** branding.

Both require **recreating** services (Render fixes region AND service name/subdomain at
creation — neither can be changed in place). Since we're recreating anyway, the region
move and the rename fold into a single parallel-cutover operation.

---

## Final service names

| Service | Old (`*.onrender.com`) | New (`*.onrender.com`) | Region |
|---|---|---|---|
| web prod (static) | `healthy-tasks-web-prod` | **`hlcentral`** | CDN (n/a) |
| web staging (static) | `healthy-tasks-web-staging` | **`hlcentral-staging`** | CDN (n/a) |
| api prod (node) | `healthy-tasks-api-prod` | **`hlcentral-api`** | **virginia** |
| api staging (node) | `healthy-tasks-api-staging` | **`hlcentral-api-staging`** | **virginia** |

**Scope = Render service URLs only.** The repo, npm package, Neon DB, and S3 bucket keep
their `healthy-tasks` identifiers (internal, not user-visible) per the rebrand decision.
Not moving: Neon DB (already Virginia), buckets, data.

---

## Why recreate (root cause recap)

`render.yaml` declares `region: virginia`, but Render created the API services in its
default **Oregon** on 2026-07-30 and **ignores later `region:` edits** — a service's
region and its name/subdomain are both immutable after creation. So the only path to
Virginia + new URLs is new services. Static `web` services carry no region (CDN) but
still need recreation to change their subdomain.

---

## Invariants that must be preserved

- **`DATABASE_URL`** — identical on each recreated API service (else it points at a
  different DB and all data "disappears"). Same Neon branch string per env.
- **`JWT_SECRET`** — identical (else every existing session is invalidated / users logged
  out).
- All other `sync:false` secrets — re-enter the **same** values (they do NOT carry over to
  a freshly created service).

**Record every current env var value from the dashboard before deleting anything.**

### `sync:false` env vars to capture/re-enter (per API service)
`DATABASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`, `JWT_SECRET`, `S3_BUCKET`, `S3_REGION`,
`S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_FORCE_PATH_STYLE`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
`value:`-preset vars (`NODE_ENV`, `JWT_EXPIRES_IN`, `PASSWORD_RESET_EXPIRES_IN`,
`EMAIL_PROVIDER`, `EMAIL_FROM`, `STORAGE_DRIVER`) auto-create from the Blueprint.

### Cross-references that MUST be updated for the new URLs
- **`VITE_API_URL`** on each `web` service → the new API URL for that env
  (`https://hlcentral-api.onrender.com` for prod, `-staging` for staging). **Build-time**
  — changing it requires a `web` rebuild.
- **`CORS_ORIGIN`** on each API service → the new web origin (`https://hlcentral...`).
- **`FRONTEND_URL`** on each API service → new web origin (used in password-reset email
  links). `EMAIL_FROM` sender text unchanged.

---

## Plan — parallel cutover (zero downtime, rollback-safe)

Because both the region and the subdomain change, we stand up the new HLCentral stack
alongside the old `healthy-tasks` one, verify, then decommission the old. **Do staging
end-to-end first as a rehearsal, then prod.**

### A. Blueprint change (on `main`)
1. Edit `render.yaml`: rename the four `name:` fields to the new names above, keeping
   `region: virginia` on both API blocks. (Structural Blueprint edits only take effect
   from `main`, the Blueprint-tracked branch.)
   - Renaming a `name:` makes the Blueprint treat it as a **new** service (created fresh
     in the specified region) and **orphans** the old-named one (no longer Blueprint-
     managed → delete it manually at the end).
2. Merge to `main` → Render creates the four new services (APIs in Virginia).

### B. Staging bring-up + verify
3. On `hlcentral-api-staging`: set all `sync:false` env vars = same values as
   `healthy-tasks-api-staging` (identical `DATABASE_URL` + `JWT_SECRET`). Set its
   `CORS_ORIGIN`/`FRONTEND_URL` = `https://hlcentral-staging.onrender.com`.
4. On `hlcentral-staging` (web): set `VITE_API_URL=https://hlcentral-api-staging.onrender.com`;
   it builds.
5. First API deploy runs `preDeployCommand` = `prisma migrate deploy` (no-op, same DB).
   Seed only if the staging DB has no admin.
6. **Verify staging** (see below) on the new URLs — confirm Region=Virginia and a real
   login + Due Date report, and note the latency drop.

### C. Prod bring-up + verify + cutover
7. Repeat 3–5 for `hlcentral-api` + `hlcentral` (prod), identical `DATABASE_URL` +
   `JWT_SECRET` as the Oregon prod service; `CORS_ORIGIN`/`FRONTEND_URL` =
   `https://hlcentral.onrender.com`; web `VITE_API_URL=https://hlcentral-api.onrender.com`.
   Prod is Protected → temporarily lift protection to set secrets/seed, then **re-protect**.
   Do NOT re-seed (admin already exists in the shared prod DB).
8. **Verify prod** on the new URLs.
9. **Cut over:** the new web URL (`https://hlcentral.onrender.com`) is the new entry point
   — start using it / update any bookmarks or (future) custom domain to point here.
10. **Decommission:** once the new stack is confirmed, delete the four old
    `healthy-tasks-*` services. Reconcile `render.yaml` on `main` so declared services
    match reality.

---

## Verification (each env, on the NEW URLs)

- Service **Region** reads **Virginia** (API services) in the dashboard.
- `GET https://hlcentral-api[-staging].onrender.com/health` → `{"status":"ok"}`.
- **Login works** end-to-end (proves DB reachability with the preserved `DATABASE_URL`).
- **Reports → Due Date Performance** loads with the 7 buckets; compare load time — should
  be visibly faster than the Oregon setup. (Measure a DB-backed page, not `/health`,
  which does no DB query.)

## Rollback

- Old `healthy-tasks-*` services stay running untouched until step 10, so rollback =
  keep using the old URLs (and, if any client was already repointed, set `VITE_API_URL`
  back and rebuild). Delete the new services if abandoning.

## Gotchas

- **`JWT_SECRET` drift** → everyone logged out. **`DATABASE_URL` drift** → different DB.
  Keep both identical.
- **`VITE_API_URL` is build-time** — repoint + rebuild `web`.
- Deleting the old services frees the `healthy-tasks-*.onrender.com` subdomains; don't
  delete until the new stack is verified.
- Keep structural `render.yaml` edits on `main`; a `staging` branch must keep existing.
- After migration, ensure `render.yaml` matches the live service set (avoid a repeat of
  the config-vs-reality drift that caused the Oregon problem).
