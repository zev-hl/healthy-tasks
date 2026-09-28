# HLAI-71 — Exclusives (Amazon Seller Alerts) — Implementation Plan

> Working plan for integrating the **Exclusives** module (Amazon Seller Alerts)
> into HL Central. Source of truth for intent: `CLAUDE_CODE_BRIEF.md`. Source of
> truth for visual design: the standalone reference HTML
> (`Exclusives Notifications (standalone).html`). This plan **reconciles the brief
> with THIS repo's real conventions** — where they conflict, the repo wins and the
> deviation is called out in §3. **Nothing is implemented yet.** We ship in small
> chunks (§5); Chunk 1 is only the nav entry + tab scaffolding.

---

## 1. Goal (what we're actually adding)

An in-house, **admin-only**, **read-only** Amazon SP-API monitor that polls a set
of listings (350 ASINs → up to 400, across US + Canada), snapshots them on a
schedule, diffs consecutive snapshots into **12 alert types**, and surfaces the
results in-app under a new **"E-commerce exclusives"** nav section with two
screens: **Alert Groups** and **Alert Log**.

Explicitly **out of scope** (per brief §2/§13): AWS SQS/EventBridge, push
subscriptions, multi-tenant, any write to Amazon, RDT/PII, SMS/email/Slack push.
Phase 1 is polling + in-app display only.

---

## 2. How this maps onto HL Central's architecture

The brief was written provider-agnostic ("Laravel/Django/Rails/…"). This repo is
a **TypeScript npm-workspaces monorepo** (`packages/shared`, `backend`,
`frontend`). The feature is a standard **vertical slice**, following the existing
layering exactly (see `CLAUDE.md` / `docs/architecture.md`):

| Brief concept | HL Central home | Notes |
|---|---|---|
| DB schema (§5) | `backend/prisma/schema.prisma` + a phase migration | Prisma models, not raw SQL. Migrations named `…_phase16_exclusives…` following the existing phase ordering. |
| Seeders (§12) | `backend/prisma/seed.ts` (or a dedicated seed module) | Idempotent `upsert`, matches existing seed pattern. |
| SP-API client (§6) | `backend/src/services/exclusives/` (new folder) | Business logic layer; talks out to Amazon instead of Prisma. |
| Change detection (§7) | same folder, pure function over two snapshots | Unit-testable, no I/O — mirrors how services isolate logic. |
| Scheduled worker (§8) | **extend** `backend/src/services/scheduler.service.ts` | Do NOT add a new job runner — the repo already has a two-clock scheduler gated by `SCHEDULER_ENABLED`. Add an Exclusives pass. |
| Backend routes (§9) | `routes/exclusives.routes.ts` → `validation/schemas.ts` (Zod) → `controllers/*.controller.ts` → `services/*` → `*.mapper.ts` | The canonical slice. Mounted in `app.ts` under `/api/exclusives`. |
| DTOs / enums | `packages/shared/src/index.ts` | The contract. Add DTOs + enums here, then `npm run build:shared`. |
| Auth (§9 "admin auth") | `requireAuth` (`middleware/auth.ts`) | Authenticated users only. **Role gating deferred** (see §3.3) — no `requireAdmin` for now. No new user table. |
| Errors | `HttpError.*` + central `errorHandler` | e.g. `HttpError.badRequest`, `.forbidden`. |
| Config/secrets (§3/§6.1) | `backend/src/config/env.ts` | Add `SP_API_*` vars (validated at boot). Never to frontend. |
| Frontend screens (§10) | `frontend/src/pages/*` + lazy routes in `router.tsx` | Vite/React SPA, `react-router-dom` data router, `React.lazy`. |
| Sidebar entry (§10.5) | `frontend/src/components/Layout.tsx` `Sidebar` | New `side-group` block, matching existing groups. |

---

## 3. Conflicts with the brief — resolved in favour of repo conventions

The brief says: *"If anything conflicts with the existing repo's conventions,
stop and ask — do not silently deviate."* These are the conflicts; the plan's
recommendation is listed. **These need your sign-off (see §8).**

1. **Primary keys: brief mandates UUID; repo uses integer autoincrement.**
   **✅ DECIDED — integer autoincrement PKs** (match repo). Existing tables use
   `SERIAL`/`Int @id @default(autoincrement())` with integer FKs (see any
   migration, e.g. `TaskDependency`); consistency with every existing join,
   mapper, and the frontend's `id: number` DTOs wins over the brief's UUID
   preference. (The brief's real constraint — "don't name the Listing PK
   `asin_id`" — we still honour: it's `id` on a `Listing` model.)

2. **Column naming: brief shows `snake_case`; repo uses Prisma `camelCase`
   fields.** Existing models use camelCase (`supervisorId`, `tokenVersion`,
   `capturedAt`). **Recommendation:** camelCase Prisma fields throughout; let
   Prisma handle the DB column mapping as the rest of the schema does.

3. **"Single admin, single seller account."** ✅ **DECIDED.** The repo is
   genuinely multi-user and role-based; we don't remove that. Single-seller stays
   a runtime/seed assumption (one `SellerAccount` row). **Role gating is
   deliberately deferred:** for now the Exclusives tabs are visible/accessible to
   **any authenticated user** (no `roles={[...]}` wrapper, no role check on the
   sidebar group). We add role restriction as a later pass once the feature works
   end-to-end. No schema-level tenancy.

4. **Refresh-token storage/encryption (§5.1, §3).** ⏸️ **OPEN — deferred to when
   we start the SP-API client (Chunk 3).** Two candidates: (a) source
   `SP_API_REFRESH_TOKEN` from env (`env.ts`) like every other secret, with
   `SellerAccount` holding only non-secret fields (`merchantToken`, `storeName`) —
   simplest, no new crypto; or (b) build a real at-rest field-encryption util and
   store `refreshTokenEncrypted`. The repo has no field-encryption utility today.
   Decide at Chunk 3; it does not block Chunks 1–2.

5. **Scheduler cadence.** Brief wants every 30 min on an always-on service. The
   repo's scheduler is a next-wake model and is **ON in staging** but the doc
   note in `CLAUDE.md` is stale. **Recommendation:** register an Exclusives pass
   in the existing scheduler; make cadence an env knob
   (`EXCLUSIVES_SWEEP_MINUTES`, default 30). On Render this rides the existing
   backend web service — confirm it's the paid always-on plan (prod is
   `standard`, staging is `starter`; both are always-on, so ✅).

6. **`getListingOffersBatch` is POST.** Allowed (brief §3 whitelists it). No
   conflict — just noting the client must permit these three POST-shaped
   read-only calls and block everything else.

---

## 4. Data model — FINALIZED (reviewed the client ERD; simplified for this repo)

The client ERD faithfully mirrors the brief's 8-table model but includes pieces
that don't fit this single-admin, single-seller, env-configured app. After
review (2026-09-15) the model is **5 tables + 4 enums**, integer PKs, camelCase
fields. Decisions that shaped it (all confirmed with the user):

- ✅ **No `SellerAccount` table.** Single-seller → `merchantToken`, `storeName`,
  and the refresh token live in env/config (resolves §3.4). Removes the table and
  `Listing.sellerAccountId`. `merchantToken` is still needed in code for Buy Box
  Won/Lost detection (compare Buy Box winner vs. own merchant id).
- ✅ **`Listing` belongs to ONE `AlertGroup` via a `groupId` FK** — not a pivot.
  Matches the design's "moving from another group" semantics and enforces the
  one-group rule structurally. (Pivot only if a listing must live in many groups.)
- ✅ **`AlertType` is a Prisma enum, not a table** (repo convention; removes a
  table, a seed, and two joins). Same treatment for **marketplace** →
  `ExclusivesMarketplace` enum; the two Amazon marketplace ids
  (`ATVPDKIKX0DER`/`A2EUQ1WTGCTBG2`) live in a code map, like the frontend flag map.
- ✅ **`AlertLog` is durable history.** The delete flow promises "past alerts stay
  in the log," so AlertLog **denormalizes** `asin`, `marketplace`, `title`,
  `groupName` at write time and its FKs are `onDelete: SetNull` — logs survive
  group/listing deletion.
- ⚠️ **Snapshot retention** (not a schema change, but decide in Chunk 6): detection
  only needs the newest 1–2 snapshots per listing; add a prune policy so
  `ListingSnapshot` (~6M rows/yr at 350 ASINs × 30 min) stays bounded.

**Consequence: no seeders in Chunk 2** — the former reference tables are enums.

### Enums (Prisma; `packages/shared` already mirrors the alert-type/mode/group set)
- `ExclusivesGroupType` = `INDIVIDUAL | GROUP`
- `ExclusivesAlertMode` = `off | daily | immediate`
- `ExclusivesMarketplace` = `USA | Canada`
- `ExclusivesAlertType` = the 12 keys (ListingSuppressed … DimensionsChanged)

### Tables (5)
- **AlertGroup** — `id` PK, `name` (unique), `groupType`, `version` (optimistic
  concurrency, per repo convention), `createdAt`, `updatedAt`.
- **Listing** — `id` PK, `groupId` FK→AlertGroup (`onDelete: Cascade`),
  `marketplace`, `asin`, `sku`, `createdAt`. `@@unique([marketplace, asin])`
  (same ASIN in US+CA = two rows).
- **ListingSnapshot** — `id` PK, `listingId` FK (`Cascade`), `title`,
  `mainImageUrl`, `category`, `brand`, `bulletPoints` (Json), `description`,
  `dimensions`, `listedPrice` Decimal(10,2), `currency`, `buyboxWinnerSellerId`,
  `buyboxPrice` Decimal(10,2), `offerCount`, `isSuppressed`, `suppressionReason`,
  `capturedAt`. `@@index([listingId, capturedAt(Desc)])`. **Since 2026-09-19
  it holds each listing's latest state only — one row, updated in place every
  sweep; the AlertLog is the history (§8 #14). Enforced in code, no schema
  change.**
- **AlertSetting** — `id` PK, `groupId` FK (`Cascade`), `alertType`, `mode`
  (default `off`). `@@unique([groupId, alertType])`.
- **AlertLog** — `id` PK, `groupId` FK? (`SetNull`), `listingId` FK? (`SetNull`),
  `alertType`, `category`, `previousValue`, `newValue`, `message`, **denormalized**
  `asin` + `marketplace` + `title` + `groupName`, `createdAt`.
  `@@index([createdAt(Desc)])`, `@@index([listingId, createdAt(Desc)])`.
- *(No SellerAccount / Marketplace / AlertType / pivot tables.)*

---

## 5. Chunked delivery (each = its own PR)

Adapted from brief §14, reordered so the **nav + scaffolding lands first** (your
request), and so schema/secrets are reviewable before any Amazon code.

- **Chunk 1 — Nav + tab scaffolding (this ticket's first PR).** Sidebar
  "E-commerce exclusives" group + two `NavLink`s; two lazy routes
  (`/exclusives/groups`, `/exclusives/log`) behind `RequireAuth roles={['Admin']}`;
  placeholder pages with the correct headers/empty states; shared enums +
  color-coding constants. **No backend, no Amazon, no DB.** Purely wires the
  entry points so we can iterate screen-by-screen. *(Detail in §6.)*
- **Chunk 2 — Prisma migration (NO seeders). ✅ DONE.** Migration
  `20260915201447_phase16_exclusives`: 5 tables (AlertGroup, Listing,
  ListingSnapshot, AlertSetting, AlertLog), integer PKs, all indexes/FKs. List
  fields (`groupType`/`marketplace`/`alertType`/`mode`) are **String** columns
  validated by the shared unions — add/remove a value in code, no DB migration,
  existing rows untouched. Audit: `createdById`+`updatedById` on AlertGroup,
  `createdById` on Listing (per repo convention). Added `SP_API_*`,
  `SP_API_MERCHANT_TOKEN`, `SELLER_STORE_NAME`, `EXCLUSIVES_SWEEP_MINUTES` to
  `env.ts` + `.env.example` (optional; blank until Chunk 3). Verified: schema
  valid, backend typecheck clean, boots 200.
- **Chunk 3 — SP-API client (READ-ONLY).** Split into testable sub-parts. Hard
  rule: a single central request layer permits **only GET + an allowlist of the
  three read-only POST-shaped calls** (`getListingOffersBatch`, `feesEstimate`,
  `competitiveSummary`); any other method/endpoint **throws before sending**. No
  code path constructs a write — the app cannot mutate production listings. Real
  creds live in `.env` (gitignored). No DB writes in Chunk 3.
  - **3a — Auth + read-only guardrail. ✅ DONE.** `sp-api/{auth,client,errors}.ts`
    + `scripts/sp-api-check.ts`. Added `env_file: .env` to the backend compose
    service (local-only). Verified vs real creds: LWA token acquired; guardrail
    blocked 4/4 write attempts, allowed only the pricing POST.
  - **3b — Health probe + status light. ✅ DONE.** `sp-api/sellers.ts`
    (`getMarketplaceParticipations`) + `status.service.ts` (server-cached ~5m) +
    `GET /api/exclusives/status` (authed) + shared `ExclusivesStatusDto` +
    frontend `useExclusivesStatus` (session-cached, fetched once) + `StatusDot`
    left of the `<h1>` on both pages (green/red/grey, tooltip w/ detail +
    last-checked). Verified: real probe returned connected (US, CA, MX, BR);
    typechecks clean; status route 401 without auth.
  - **3c — Listings read (`searchListingsItems`). ✅ DONE.** `sp-api/listings.ts`
    (enumerate or fetch by SKU) + `snapshot.mapper.ts` (title, image, category,
    brand, bullets, description, dimensions, price+currency, suppression per
    §6.5) + 429 retry/backoff in the client. Verified vs production: a
    brand-owned listing (SOMBRA) mapped all fields. Finding: the Versure US
    account is mostly *reseller* listings (only 3/240 owned) — their ~350
    exclusives are the owned subset, which this code fully captures. Resold
    listings lack brand content in `attributes`; if any of the 350 are resold
    we'd add the read-only Catalog Items API (deferred until the list confirms).
    Batch-of-20 fetching is a small extension for the sweep (Chunk 6).
  - **3d — Pricing read (`getListingOffersBatch`). ✅ DONE.** `sp-api/pricing.ts`
    → `getListingOffersBatch` (whitelisted read-only POST) + `resolveBuyBox`
    (landed-price match, ignores `IsBuyBoxWinner` per §6.4). Verified vs
    production: SKU C-YSL-1602-A → 26 offers, Buy Box 89.98 held by a competitor
    (≠ our merchant token). Note: pricing-by-SKU only works for BUYABLE SKUs
    (ones we actively offer); listed-but-not-offered SKUs return "invalid SKU"
    (expected). Inter-call 0.5/sec spacing lands with the sweep loop (Chunk 6).
  - **3e — Fixtures + unit tests + hardening. ✅ DONE.** `test/fixtures/
    exclusives.ts` (trimmed real shapes) + `test/unit/` (guardrail, snapshot
    mapper incl. §6.5 edge case, Buy Box resolver) + `test:unit` script. 12/12
    pass, no DB, never hits Amazon. **Chunk 3 complete (3a–3e).**
- **Chunk 4 — Snapshot ingestion.** Fetch monitored listings + pricing and store
  `ListingSnapshot` rows. No diffing yet. Split into testable sub-parts; staying
  under the rate limit is the explicit acceptance criterion.
  - **4a — Rate-limit pacer + batcher.** Batches of 20; per-endpoint inter-call
    spacing (~200ms listings / ~2s pricing); reads `x-amzn-RateLimit-Limit` and
    adapts down. Unit-tested (timing/adaptation), no network.
  - **4b — Sweep fetcher.** Merge listings (3c) + pricing (3d) per (SKU,
    marketplace) into one snapshot draft, via paced batches (4a). Read-only, no
    DB. Test: print merged snapshots for a few real SKUs; confirm under limits.
  - **4c — Snapshot persistence. ✅ DONE.** `snapshot.repository.ts`
    (`snapshotCreateData` + `persistSnapshots` via `createMany`). Verified: a
    real merged draft wrote a `ListingSnapshot` row (Decimal/Json/FK all correct)
    and read back. Test script seeds an idempotent "Ingestion Test" group+listing.
  - **Catalog supplement (added). ✅** Conditional read-only Catalog Items call
    (`searchCatalogItems`, batched 20, paced 2/sec) — fires **only** for
    content-missing (resold) drafts, filling brand/bullets/description/dimensions/
    image. Owned listings skip it. On the real 434: brand 51%→96%, bullets
    51%→94%, at +22 calls / +10s. Price/BuyBox/suppression still from Listings.
  - **4d — Ingestion service + test seed. ✅ DONE.** `ingestion.service.ts`
    `runIngestion()` (loads monitored Listings → paced sweep → persist, remaps
    snapshots to listings by (marketplace, SKU), idempotent, returns report + per-
    marketplace call counts). Seed script seeds 50 distinct US ASINs (rate-paced).
    Verified: 50 listings → 50 snapshots via **3 listings + 3 pricing calls**,
    ~6s (pacer spacing the pricing calls). **Chunk 4 complete (4a–4d).**
- **Chunk 5 — Change-detection engine. ✅ DONE (5a–5e).** 53 unit tests pass; 5e
  verified against the DB (a real snapshot pair produced 5 correct alerts).
  - **5a ✅** `snapshot-diff.ts` — `SnapshotView` + `diffSnapshots` (cent-tolerant
    price compare, null↔value handling, `changedBulletIndices`).
  - **5b ✅** `alert-detection.ts` — `detectAlerts` → 12 alert types; Buy Box
    Won/Lost from winner+price+merchant token across snapshots (suppressed ≠
    Lost); price/offer only when both values known.
  - **5c ✅** `alert-message.ts` — `describeAlert` (short human lines incl. price
    %; "a competitor" since SP-API gives only seller id).
  - **5d ✅** `alert-gating.ts` — `gateAlerts` (daily/immediate = on; off/missing
    = off).
  - **5e ✅** `detection.service.ts` — `runDetection`: newest two snapshots →
    5a–5d → denormalized `AlertLog` rows; per-listing try/catch; idempotent in
    the cycle (fresh snapshot each pass). (First sweep = baseline; alerts from the
    second.)
- **Chunk 6 — Scheduler pass.** Wire ingestion+detection into
  `scheduler.service.ts` on the sweep cadence; idempotent; per-listing try/catch;
  batched writes; logs per-marketplace call counts. **Scaling decision (settled):**
  expected ceiling is ~600–700 ASINs over 3–4 years — tiny and I/O-bound (a sweep
  is ~2–3 min of paced work every 30 min, event loop mostly idle). So: **keep it
  in the existing single backend process, no queue, no separate worker.** The
  sweep is background (off the API request path) and the API only reads finished
  rows, so API responsiveness is never affected. Escape hatch: `SCHEDULER_ENABLED`
  already lets us split the scheduler into a separate worker process with a
  one-flag config change if load ever surprises us — deferred as YAGNI.
  - **Failure/retry policy (settled).** Bounded retry with backoff+jitter for
    *transient* errors only — 429 (built) + 5xx + network/timeout (extend the
    client) + a single 401→token-refresh retry. **No retry** for 403 / 400
    (invalid SKU handled per-item → null). No tight loops on a sustained outage:
    a few retries, then skip the batch and let the **next 30-min sweep be the
    retry**. Per-batch and per-listing `try/catch` so nothing crashes. Missing a
    cycle = no data loss / no missed or false alerts (next snapshot compares to
    the last good one, one cycle later). Outage surfaced via the red status dot +
    the existing scheduler watchdog (admin email on heartbeat stall).
  - **Delivery (agreed 2026-09-18): one increment at a time**, each verified and
    reviewed before the next. Decisions behind these are §8 #11.
  - **6a — SP-API client hardening. ✅ DONE** (verified in Docker: full backend
    typecheck, unit tests, ESLint). `sp-api/http.ts` `fetchWithRetry` — the transport for SP-API *and*
    the LWA token endpoint: 30s per-attempt timeout; up to 3 retries (2s-base
    exponential backoff + jitter, numeric `Retry-After` honoured) for
    429/500/502/503/504 and network drops/timeouts; `SpApiNetworkError` when no
    attempt got a response; non-JSON error bodies keep their real status.
    `client.ts`: one fresh-token retry on a 401 **or a 403 "Unauthorized" that
    names the access token** (how SP-API reports an expired token); every other
    400/403 is final. 21 new unit tests (`sp-api-http`, `sp-api-client`) — 74/74
    pass; strict typecheck of the touched files clean.
  - **6b — Sweep saves only complete snapshots. ✅ DONE** (verified in Docker:
    full backend typecheck, unit tests 86/86, ESLint, scripts typecheck; live
    Amazon run pending `asins.txt`). `sweepListings` never throws for an SP-API
    failure; every listing without a snapshot is reported with a reason
    (`batch-failed`, `not-returned`, `pricing-unavailable`,
    `catalog-unavailable`, `sweep-aborted`):
    - a failed listings/pricing call skips only its batch;
    - a per-SKU pricing answer that is missing / 429 / 5xx → no snapshot for
      that listing (a 4xx such as "invalid SKU" is still a real no-Buy-Box
      answer) — prevents the false Buy Box Won on recovery;
    - a failed catalog fill skips only the listings that needed it;
    - 3 failed batches in a row stop the sweep; 3 catalog failures in a row
      only stop catalog fills for that sweep (losing the Catalog API must not
      halt price/Buy Box monitoring);
    - retries now wait on the rate pacer (`pace` option threaded through
      `spApiRequest` → `fetchWithRetry`), so a retry can't exceed the limit.
    `runIngestion` returns `listingIdsWritten` (for 6c), `skipped`, `aborted`,
    and logs a skip summary. 11 new unit tests (`sweep.test.ts` against a fake
    Amazon, plus a pacer-order test).
  - ⚠️ **6c and 6e below were reworked on 2026-09-19 (§8 #14)** — see
    "Rework — one snapshot per listing" after 6g. Their text is kept as a
    record of what was first built.
  - **6c — No duplicate alerts. ✅ DONE** (verified in Docker: backend typecheck,
    86/86 unit tests, ESLint, scripts typecheck; full integration suite 238/238
    on a real Postgres with the project's migrations, incl. 6 new ones). `runDetection(listingIds,
    onLog)` compares only the listings it is given — the pass will hand it
    `IngestionReport.listingIdsWritten`. Plus a self-guard: a listing whose
    newest pair is already logged (an alert at/after its newest snapshot) is
    skipped, so re-running is harmless; a pair that produced no alerts produces
    none again. Groups with every type off are not read. Reads are 3 queries
    per pass (listings+settings, newest-2 snapshots via one `LATERAL … LIMIT 2`
    raw query, last-alert times), writes are ONE `createMany`, instead of 2
    queries per listing. Report adds `alreadyDetected`, `failed`. Dev scripts
    updated: `exclusives-detect-test` now proves the re-run is a no-op and
    deletes its `AlertLog` rows (they used to linger as orphans);
    `exclusives-change-demo` detects only its listing and restores the edited
    price if Amazon returned no fresh snapshot. Integration tests run with
    `TEST_DATABASE_URL` → a separate `healthy_tasks_test` DB on the compose
    Postgres (embedded Postgres can't run as root in the container).
  - **Live check of 6a–6c ✅ (2026-09-19, real Versure account, read-only).**
    `asins.txt` (351 ASINs; its `ASIN` header row is now filtered out by the
    seed loader) → 332 US + 102 CA = **434 listings**, 18 ASINs unlisted in both
    (same as before). Two full sweeps: **434/434 snapshots, 0 skipped, no
    aborts**, 23 listings + 23 pricing + 22 catalog calls, ~50s each. Coverage
    unchanged vs. the original run (title 100%, price 99%, Buy Box 64% — we hold
    149, brand 96%, bullets 94%, description 54%, 82 suppressed). The 13
    listings with no offer data return `400 InvalidInput "invalid SKU"` per SKU
    (1 US, 12 CA) → kept as a real "no Buy Box", confirming 6b's rule.
    Detection (all 12 types on for the local "Versure Exclusives" group):
    434 compared → **1 genuine alert** (B001SAZC2W US, sellers 4 → 6 in 2 min);
    no content flapping between sweeps; re-run → 0 new, 1 already logged.
  - **6d — Pass runner. ✅ DONE** (verified in Docker: backend typecheck, 88/88
    unit tests, ESLint, scripts typecheck; 4 new integration tests on real
    Postgres; one live pass on the real account). `pass.service.ts`
    `runExclusivesPass(onLog)`: ingestion → detection on
    `listingIdsWritten`; logs start + end with duration, per-marketplace call
    counts, snapshots, skips, alerts. Never throws (`completed` / `skipped` /
    `failed` report). Skips without calling Amazon when SP-API isn't configured
    (silently — `sp-api/config.ts` `missingSpApiConfig`), when a pass is already
    running in this process, or when another instance holds the lock:
    `pg_try_advisory_xact_lock(0x484C4558 "HLEX")` held by a long-timeout
    (20 min) transaction for the pass — transaction-scoped, so it is released
    however the pass ends. The work runs on other pooled connections, so the
    pool needs ≥ 2 connections (the local Docker database has no limit, so this
    is fine). Pruning is 6e; the on/off switch comes with the scheduler (6f), so
    the manual runner always works for testing. Manual runner:
    `scripts/exclusives-run-pass.ts`. Tests: the fake Amazon moved to
    `test/fixtures/fake-amazon.ts` (shared by unit + integration); the
    integration suite now pins fake SP-API credentials in its setup, so the real
    ones the dev container loads from `.env` can never reach a test.
    **Live pass (2026-09-19):** 434/434 snapshotted, 0 skipped, 55s,
    USA 17/17/16 + Canada 6/6/6 calls → 13 genuine alerts (7 price, 3 Buy Box
    lost, 2 won, 1 seller count). 4 of the 7 price alerts were 1–3¢ repricer
    moves — **kept by client decision** (§8 #12): every price change alerts.
  - **6e — Retention. ✅ DONE** (verified in Docker: backend typecheck, 88/88
    unit tests, ESLint, scripts typecheck; full integration suite after 6d
    242/242, and all 12 Exclusives integration tests incl. 2 new retention ones
    on real Postgres; one live pass). `snapshot.repository.ts`
    `pruneSnapshots(olderThan)`: deletes snapshots captured before the cutoff
    except each listing's newest two (kept however old — a quiet listing never
    loses its baseline). The keep-set is an index-backed per-listing top-2 (raw
    `LATERAL … LIMIT 2`); the date test goes through Prisma, because
    `capturedAt` is a naive timestamp and a raw timestamptz parameter would shift
    by the session's UTC offset. The pass prunes last, after detection, with
    `SNAPSHOT_RETENTION_DAYS = 7`; a pruning failure is logged and reported
    (`pruned` undefined) but doesn't fail the pass — nothing is lost and the
    next pass prunes again. Pass log + `exclusives-run-pass.ts` report the
    count. Steady state ≈ 434 × 48/day × 7 ≈ 146k rows. **Live pass
    (2026-09-19):** 434/434, 0 skipped, 57s, 12 genuine alerts, 0 pruned
    (all history < 1 day, as expected); snapshots 1302 → 1736.
  - **6f — Scheduler wiring. ✅ DONE** (verified in Docker: backend typecheck,
    88/88 unit tests, ESLint; Exclusives + scheduler integration tests 43/43
    incl. 5 new clock tests; live run of 3 automatic sweeps). Its own timer in
    `scheduler.service.ts` ("Exclusives sweep clock" section), started/stopped
    by `startScheduler`/`stopScheduler`, never inside `runScheduler` — the
    recurrence timer, reminders and the "scheduler down" watchdog are
    untouched. Runs only when `SCHEDULER_ENABLED` and new
    `EXCLUSIVES_SWEEP_ENABLED=true` (default off) and SP-API is configured;
    boot log says which (`exclusivesSweepMode`). `EXCLUSIVES_SWEEP_MINUTES`
    is validated at boot (whole minutes, 5–1440). Next run
    (`exclusivesDueAt`) = the later of newest snapshot + interval and this
    process's last attempt + interval — re-derived from the DB, so restarts
    and hot reloads don't sweep early, and a failing sweep (no snapshot saved)
    waits a full interval instead of looping. 1s slack absorbs a timer firing a
    hair early / app-vs-DB clock skew (seen live: an extra wake-up before the
    fix). Test seams: `runExclusivesIfDue`, `__resetExclusivesClock`; the
    integration setup pins `EXCLUSIVES_SWEEP_ENABLED=false` and
    `EXCLUSIVES_SWEEP_MINUTES=30`. **Live check (2026-09-18/19, local, 5-min
    interval via a temporary `.env` edit, since reverted):** sweeps ran by
    themselves at boot, +5 and +10 min — each 434/434, 0 skipped, ~55s
    (28, 1, 8 alerts); a restart mid-interval did not sweep early (next time
    read back from the DB); the app's `schedulerDown` flag stayed `false`
    throughout a pass.
  - **6g — Sweep-failure visibility. ✅ DONE** (verified in Docker: backend +
    frontend typecheck, 92/92 unit tests, ESLint, frontend Vitest 18/18;
    Exclusives + scheduler integration tests 49/49 incl. 6 new; full suite after
    6g **255/255**; live console run). Summary of all of Chunk 6:
    `chunk_6_completed.md`. After every scheduled pass the clock checks
    health (`sweep-health.ts` pure rule, `health.service.ts` loader): a listing
    is **stale** after missing 3 sweeps (its newest snapshot, or when it was
    added); **unhealthy** when stale listings are more than 10% of those
    monitored — catches an outage and a partial one (e.g. lost Catalog API ⇒
    every resold listing), ignores a few delisted listings. Unhealthy ⇒ email
    all active admins via the scheduler's `alertAdmins` — own 1-hour cooldown
    (separate from the recurrence alerts), stops by itself once sweeps
    recover. The email names stale/total, the last successful check and the
    latest attempt's outcome/skip reasons. Status: `ExclusivesStatusDto.lastSweepAt`
    (shared contract) → status-dot tooltip "Last Amazon check: …". Console:
    every scheduled run opens `▶ Scheduled sweep #N started at … (runs every
    N min)` and closes `■ Scheduled sweep #N ended after Ns — completed: X/Y
    listings checked, Z alert(s) | skipped: … | FAILED: …. Next sweep (the
    retry) at …`; the manual runner opens `▶ Manual sweep started`.
  - **Rework — one snapshot per listing, updated in place. ✅ DONE
    (2026-09-19, §8 #14; no migration).** The AlertLog is the history, so
    keeping every sweep's full snapshot was redundant. New flow per pass:
    **fetch** (`runIngestion` now only fetches and returns `entries`) →
    **compare** each listing's fresh data with its single saved snapshot →
    **log** alerts → **save** the fresh data over that row. `runDetection(entries)`
    does compare + log + save in **one transaction**: a change is never logged
    twice nor lost, which also closes 6c's "crash between ingest and detect"
    gap. First sight of a listing = baseline (no alerts); a listing not fetched
    this sweep keeps its saved row; re-running with the same data logs nothing.
    Fresh money values are compared in stored form (Decimal(10,2), half-up) so
    unchanged listings compare equal. Leftover extra rows are deleted as each
    listing is saved. Removed: `persistSnapshots`, `pruneSnapshots`,
    `SNAPSHOT_RETENTION_DAYS`, the pass's prune step, the newest-two `LATERAL`
    query and the already-logged guard. Unchanged: the clock's due time and
    the health rule (`capturedAt` is refreshed on every save). Local DB cleaned
    per the user: snapshots and alerts deleted; users, listings, the group and
    its settings kept. Verified: typecheck, 92/92 unit tests, ESLint, 48/48
    Exclusives + scheduler integration tests (6c rewritten: 6 tests; 6e
    replaced by 1 one-row-per-listing test), full integration suite
    **254/254**; **live:** pass 1 → 434 baselines,
    0 alerts; pass 2 → 434 compared, 0 false alerts; 434 rows, max 1 per
    listing.
  - **Hardening — pricing answers matched by SKU. ✅ DONE (2026-09-19).** The
    pricing batch reply used to be paired with our SKUs by position (answer #1
    → SKU #1), never checking which SKU an answer was for. A live trace (20 US
    SKUs) showed Amazon keeps the order today, but it isn't promised. Live
    check of the raw reply: **every answer echoes our request —
    `request.SellerSKU` — errors included**; successful ones also carry
    `payload.SKU`. `pricing.ts` → `matchAnswersToSkus` now matches by that SKU;
    only an answer naming no SKU falls back to its position (logged), a
    named answer is never displaced by a guess, an answer for a SKU not asked
    about is ignored (logged), and a SKU left unanswered is skipped this round
    as before. Out-of-order replies are logged. Verified: 100/100 unit tests
    (7 matching + 1 shuffled-sweep test that fails on the old code), 48/48
    Exclusives + scheduler integration tests, typecheck, ESLint; live pass:
    434/434, 0 pricing warnings, 1 row per listing.
  - **Optimization — rewrite only changed snapshots. ✅ DONE (2026-09-19).**
    Every sweep used to rewrite all 434 snapshot rows in full (434 separate
    UPDATEs carrying every column) although only ~15–25 changed.
    `snapshot.repository.ts` → `sameStoredState` compares **every** stored
    column in stored form (money to the cent; includes currency and suppression
    reason, which no alert watches); `runDetection` rewrites only rows whose
    data changed and moves the others' `capturedAt` ("last checked" — the
    clock and health check need it) with ONE `updateMany`, still inside the
    same transaction. Report: `snapshotsChanged` / `snapshotsUnchanged`; the
    detection log shows both plus the save time. Note: Postgres still counts
    an update per row (`n_tup_upd` +434/sweep) because every row's last-checked
    time moves — the saving is statements (≈25 vs 434) and not re-sending
    unchanged content. Verified: 106/106 unit tests (6 new, `snapshot-state`),
    50/50 Exclusives + scheduler integration tests (2 new), full integration
    suite **256/256**; **live:** 24
    rewritten, 410 unchanged, **saved in 0.3 s (was 1.6–1.8 s)**, one shared
    last-checked time.
  - No deployment step: the app runs only on the local machine (§8 #13). To
    run timed sweeps locally, set `EXCLUSIVES_SWEEP_ENABLED="true"` in `.env`
    and recreate the backend container.
- **Chunk 7 — Backend routes.** AlertGroup CRUD, AlertLog list/filter/paginate,
  ASIN lookup preview, bulk import, CSV export. Authenticated (`requireAuth`);
  role restriction deferred (§3.3).
- **Chunk 8 — Frontend screens.** Alert Groups list, Alert Log, New/Edit Group —
  built against the reference HTML (design reuse map in §7).
- **Chunk 9 — Polish.** CSV export UX, empty/error states, backoff
  observability, client-secret-rotation runbook (~180-day expiry).

---

## 6. Chunk 1 detail (the only thing we build after this plan is approved)

**Backend:** none.

**Shared (`packages/shared/src/index.ts`):**
- `ExclusivesAlertType` union (12 stable keys) + `EXCLUSIVES_ALERT_TYPE_LABELS`
  map + `EXCLUSIVES_ALERT_DOT_COLOR` map encoding brief §10.4:
  - Red: Listing Suppressed, Buy Box Lost
  - Green: Buy Box Won
  - Amber: Number of Sellers Changed, Price Changed
  - Purple: Category, Brand, Title, Main Image, Description, Bullet Points Changed
  - Grey: Dimensions Changed
- `ExclusivesGroupType`, `ExclusivesAlertMode` unions (for later chunks; cheap to
  land now so the contract exists).
- `npm run build:shared` after.

**Frontend:**
- `Layout.tsx` → new `side-group` after "Goals" (shown to **any authenticated
  user** — no role guard for now, see §3.3):
  ```
  <div className="side-group">
    <div className="side-group-label">E-commerce exclusives</div>
    <NavLink to="/exclusives/groups">Alert Groups</NavLink>
    <NavLink to="/exclusives/log">Alert Log</NavLink>
  </div>
  ```
  Reusing existing `side-group` / `side-group-label` / `navItemClass` — **no new
  CSS system.**
- `router.tsx` → two `React.lazy` pages under the authed layout (inside the
  existing `RequireAuth` shell, **no `roles={[...]}` restriction** for now):
  `/exclusives/groups` → `ExclusivesGroupsPage`,
  `/exclusives/log` → `ExclusivesLogPage`.
- Two placeholder pages under `frontend/src/pages/`, each rendering the correct
  header ("Exclusives monitoring" / "Exclusives Alert Log") + a friendly empty
  state, using the app's existing `container`/page conventions. No data wiring.

**Acceptance for Chunk 1:** any logged-in user sees the new sidebar group; both
tabs route to placeholder screens; typecheck + lint pass. Nothing else changes.
(Role restriction is a deliberate later pass.)

---

## 7. Design reuse-vs-reimplement (brief §10.5 requires this before wiring UI)

The reference HTML is a standalone design-doc export (inline styles, `IBM Plex
Mono`, `<sc-for>`/`<x-dc>` custom template tags, hashed asset refs). It is **not**
React and its markup can't be dropped in. Plan:

**Reuse (values, not markup):**
- The **nav model**: category heading `"E-commerce exclusives"` + two tabs
  `Alert Groups` (dot `#0F7B6C`) and `Alert Log` (dot `#7857C8`) — extracted from
  the HTML's `navItems` array. We map these to our sidebar.
- **Alert-type dot colors** and the soft-tint badge treatment (§10.4) — as shared
  constants.
- Layout *intent*: two stat cards on the dashboard, table column set, filter/row
  layout, relative+absolute timestamps, 25/50/100 pagination — as a spec for our
  own components.

**Re-implement with the app's own system (do NOT copy):**
- All markup → React components using existing classes (`container`, `side-*`,
  table/badge conventions already in the app). No inline styles, no `IBM Plex
  Mono`, no `<sc-for>`.
- Typography/spacing → the app's existing scale, not the HTML's pixel values.
- Icons/flags → follow the app's icon pattern; marketplace flag emoji comes from
  `Marketplace.flag_icon` (join, never an extra call — brief §11).

Per brief §10.5, the detailed screen-by-screen design mapping (Chunk 8) gets
confirmed with you **before** that UI work — this plan only commits the sidebar +
placeholder routes.

---

## 8. Decisions & open questions

**Decided:**
1. ✅ **Integer autoincrement PKs** (match repo), not UUIDs. (§3.1)
2. ✅ **No role gating for now** — tabs/routes open to any authenticated user;
   role restriction is a deliberate later pass. (§3.3)
3. ✅ **Reuse the existing scheduler** (`scheduler.service.ts`) with a new
   `EXCLUSIVES_SWEEP_MINUTES` env knob (default 30) + the existing
   `SCHEDULER_ENABLED` switch — no new job runner. Wired in Chunk 6.
4. ✅ **Doc location**: `.claude/docs/plans/HLAI-71.md`.
5. ✅ **Config via `.env` + `env.ts`** for all Amazon settings — secrets and
   tuning knobs alike. Details in §9.

6. ✅ **Schema finalized (2026-09-15)** — 5 tables + 4 enums. No SellerAccount
   (env), Listing→group via FK (no pivot), AlertType & marketplace as enums,
   AlertLog denormalized + `SetNull`. Full model in §4. Refresh token + merchant
   token + store name all in env — this **resolves the old §3.4 open question**.

**Decided (later):**
8. ✅ **Catalog Items supplement** — conditional read-only Catalog call fills
   brand/bullets/description/dimensions for resold listings; owned skip it. (§5)
9. ✅ **Scale + failure policy (2026-09-17)** — ceiling ~600–700 ASINs, so keep
   the scheduler in the single backend process (no queue, no separate worker;
   escape hatch = `SCHEDULER_ENABLED`). Bounded retry for transient errors
   (429/5xx/network + one 401→refresh); no retry for 400/403; the 30-min sweep is
   the outer retry; per-listing try/catch. (Chunk 6 details.)
11. ✅ **Chunk 6 decisions (2026-09-18):**
    - **Duplicate alerts:** detect only listings snapshotted in the current
      cycle — no migration. Known gap: a crash between ingest and detect loses
      that cycle's alerts. *(Superseded by #14: compare + log + save now commit
      together, so the gap is gone.)*
    - **Wiring:** a separate Exclusives clock inside `scheduler.service.ts`,
      sharing its start/stop and `SCHEDULER_ENABLED` — not inside `runScheduler`.
    - **Switch:** new `EXCLUSIVES_SWEEP_ENABLED`, default `false`; turn it on
      in the local `.env` to run timed sweeps (see #13).
    - **Retention:** 7 days, always keep each listing's newest 2 snapshots.
      *(Superseded by #14: one snapshot per listing, so nothing to prune.)*
    - **Token refresh:** refines #9 — also refresh once on a 403
      "Unauthorized" that names the access token (SP-API's expired-token reply).
    - **First live run:** take a fresh baseline first (no catch-up burst), delete
      the demo `PriceChanged` row, confirm the "Versure Exclusives" group's
      alert types (the change-demo script switched all 12 on).
12. ✅ **No minimum for price alerts (client, 2026-09-19).** Every listed-price
    change of 1¢ or more raises `PriceChanged`, including small repricer moves.
    Only sub-cent float noise is ignored (`moneyEq` in `snapshot-diff.ts`). Do
    not add a percentage or cents threshold without asking the client.
13. ✅ **Local machine only (user, 2026-09-19).** This app runs only on the
    user's local Docker stack. No Render, staging or production work — no
    `render.yaml` changes, no deploys — unless the user explicitly asks. Older
    Render mentions in this plan (§2, §3.5, §9) are background, not tasks.
14. ✅ **One snapshot per listing, updated in place (user, 2026-09-19).** The
    AlertLog is the history of what changed, so `ListingSnapshot` keeps only
    each listing's latest state: fetch → compare with the saved row → log
    alerts → overwrite the row. Enforced in code — **no migration** (the user:
    don't add one unless a schema change is truly required). Replaces the
    per-sweep history, the newest-two comparison and snapshot retention.

15. ✅ **ASIN discovery must page to exhaustion (2026-09-21).** Amazon's
    `searchListingsItems` returns at most 20 items per page, and one ASIN can
    carry several SKUs on the account, so a batch of 20 ASINs can overflow a
    page. The original `seed-exclusives.ts` read only the first page and
    silently dropped the rest, leaving 11 listings unmonitored and reporting
    18 ASINs as "not on the seller account" when only 8 really were. Discovery
    now lives in `services/exclusives/listing-discovery.ts`, follows
    `nextToken`, and ranks fulfilment leftovers (`FBA….missing1`) and test
    SKUs last when an ASIN resolves to several. **Chunk 7's
    `POST /listings/lookup` must reuse this module, not re-batch its own.** The
    sweep itself was never affected — it looks up by SKU, which is unique.
    Database rebuilt 2026-09-21: 445 listings (343 US + 102 CA), 8 ASINs
    genuinely not listed.

16. ✅ **Alert types are off by default (user, 2026-09-21).** Creating a group
    writes all twelve `AlertSetting` rows with `mode: 'off'`; someone then
    switches on the ones they want. The rows are written rather than left
    out so all twelve are visible and toggleable in the UI — a missing row
    counts as off too (`alert-gating.ts`), but invisibly. Applies to
    `seed-exclusives.ts` and to Chunk 7's group create/edit. Expected
    consequence: a new group keeps its snapshots current on every sweep and
    writes no alerts until a type is switched on.

17. ✅ **No email watchdog for Exclusives (user, 2026-09-21).** The Amazon
    feature does not email admins when sweeps fail — the user ruled it out of
    scope. Removed: `checkExclusivesHealth` (`scheduler.service.ts`),
    `loadSweepHealth` (`exclusives/health.service.ts`), `sweep-health.ts` and
    its unit tests, and the integration tests that asserted the emails. Kept:
    `lastSuccessfulSweepAt()`, which the status dot and the 6f sweep clock both
    need, the ▶/■ run log lines, and the app's own recurrence-scheduler
    watchdog, which predates Exclusives and is a separate feature. An outage now
    surfaces only through the `[exclusives]` log lines and a status dot whose
    "last Amazon check" time stops advancing.



**Deferred:**
7. ✅ ~~**Snapshot retention/prune policy**~~ — no longer needed: one snapshot
   per listing (#14).
10. ⚠️ **Rename `AlertLog.category` → `changedField`/`detail`** — the name clashes
    with the "Category Changed" alert type; small migration when convenient.

**Status (2026-09-17): Chunks 1–5 complete.** ✅
- **Chunk 1** — nav + both screens + editor + delete modal + status dot (mock UI).
- **Chunk 2** — Prisma migration (5 tables + list fields as validated strings),
  env vars.
- **Chunk 3** — SP-API read-only client: auth + guardrail, health probe/dot,
  listings, pricing/Buy Box, catalog supplement, 429 retry. Verified vs prod.
- **Chunk 4** — ingestion: pacer/batcher, sweep+merge, persistence, `runIngestion`.
  Real seed of 351 ASINs → 434 listings (US+CA) snapshotted, rate-safe.
- **Chunk 5** — change detection (5a diff → 5b rules/Buy Box → 5c messages →
  5d gating → 5e persistence). 53 unit tests; live demo logged a real
  `PriceChanged` alert end-to-end.
- Backend does **read → snapshot → detect → log**, strictly read-only, untested
  only via the scheduler/UI.

**Chunk 6 complete (2026-09-19):** 6a (client hardening) ✅, 6b (complete-or-
skip snapshots) ✅, 6c (no duplicate alerts) ✅, live-checked against the real
account ✅, 6d (pass runner) ✅, 6e (snapshot retention) ✅, 6f (scheduler
wiring) ✅, 6g (last-check status + run logs) ✅, then the
rework to one snapshot per listing (§8 #14) ✅. Local machine only — no
deployment step (§8 #13). Summary: `chunk_6_completed.md`.
**Chunk 7a complete (2026-09-22):** group read + summary API — `POST
/api/exclusives/groups/query`, `GET /api/exclusives/groups/:id`, `GET
/api/exclusives/summary`. New `group.service.ts`, `group.mapper.ts`,
`summary.service.ts` and `sweep-clock.ts` (the next-sweep rule, lifted out of
`scheduler.service.ts` so the API can answer it without importing the
scheduler). One index-only migration on `AlertLog(groupId, createdAt desc)`.
Exclusives tests now live in their own `backend/test/exclusives.test.ts`, and
`npm test` runs every test file one at a time. No Amazon call anywhere in 7a.
**Chunk 7b complete (2026-09-22):** alert log query — `POST
/api/exclusives/alerts/query`, newest first and paged, filtered by date range,
alert type, marketplace, group ids (the Groups -> Log link) and free text over
ASIN / title / group name. No joins: every filter column is denormalized onto
`AlertLog`, and the 7a index covers the group filter. A deleted group's alerts
still return, with `groupId: null` and the original `groupName`.
**Chunk 7c complete (2026-09-22):** ASIN lookup — `POST
/api/exclusives/listings/lookup`, four passes (normalize, database, 10-minute
cache, Amazon) returning `found` / `already-monitored` / `not-listed` /
`unavailable` per ASIN with a per-marketplace breakdown. A monitored ASIN costs
zero Amazon calls. `unavailable` is never cached and never conflated with
`not-listed`. New process-wide `sp-api/shared-pacer.ts`, now used by both the
sweep and the lookup, so the two cannot together exceed the listings rate;
`listing-discovery.ts` gained titles, an options object and `tolerateFailures`.
Caps: 500 ASINs per request, 2 concurrent lookups (429 `LOOKUP_BUSY`).
**Chunk 7d complete (2026-09-22): Chunk 7 is done.** Group writes and the two
CSV downloads — `POST /groups`, `PATCH /groups/:id`, `DELETE /groups/:id`,
`POST /alerts/export`, `POST /groups/:id/export`. All twelve settings written on
every save, off by default on create (§8 #16). Every submitted ASIN is resolved
through 7c before the transaction opens: `not-listed` -> 400 with the rows,
`unavailable` -> 409 `AMAZON_UNAVAILABLE` with nothing written, an ASIN in
another group -> 409 `LISTING_IN_ANOTHER_GROUP` unless `moveExisting`, which
updates `Listing.groupId` in place so snapshots and alerts survive. `replace`
drops only what is missing; `assertNotStale` runs first and the group row is
always touched so an ASIN-only edit still moves `updatedAt`. New `utils/csv.ts`
(RFC 4180, CRLF, BOM, `hourCycle: 'h23'`).
**Chunk 8a complete (2026-09-22):** the Alert Groups screen reads real data —
`GET /summary` for the header and run line, `POST /groups/query` for the table,
with server-side search, sorting (`SortHeader` + `cycleSort`) and paging, a real
`DELETE`, an empty state via `TableEmptyRow`, a request-id guard against
out-of-order replies, and `ExcPager` capped to a window of page buttons. The
whole Exclusives block was added to `api/client.ts`; `downloadXlsx` is now
`downloadFile` (it never inspected the content type). First frontend
render-with-providers helper: `frontend/src/test/render.tsx`.
**Chunk 8b complete (2026-09-22):** the Alert Log screen reads real data —
`POST /alerts/query` with every filter server-side (dates, alert types, group,
text), rows showing the real `message` and previous -> new values, a working
CSV Export over the on-screen filters, and an empty state. Fixes a live bug: the
Groups screen pushed `state: { gid }` but the log never read it, so the
"click a group to see its alerts" link silently showed everything; the log now
reads it and shows a clearable chip (the row click also passes the group name).
**Next:** 8c (the editor), then 8d (bulk import + exports).

---

## 9. Config strategy (✅ decided — `.env` + `env.ts`)

All Amazon/Exclusives configuration is read through the existing centralized
config (`backend/src/config/env.ts`, which already calls `dotenv.config()` and
validates required vars at boot). **No `process.env` reads scattered across
services.** Root `.env` is gitignored and untracked — confirmed — so real values
never enter git. Docker injects the same vars via compose; Render sets them per
environment (`sync: false` for secrets).

Two categories, handled differently:

**Secrets — required, no default (app crashes at boot if missing):**
- `SP_API_CLIENT_ID`
- `SP_API_CLIENT_SECRET`
- `SP_API_REFRESH_TOKEN`

**Tuning knobs — optional, safe default in code (local dev needs zero setup):**
- `EXCLUSIVES_SWEEP_MINUTES` (default `30`) — polling cadence; pattern mirrors the
  existing `SCHEDULER_ENABLED` default.

Rollout: secrets + knobs are added to `env.ts` and to `.env.example` (placeholders
only) at the chunk that first needs them (client = Chunk 3, scheduler = Chunk 6).
Nothing config-related is needed for Chunk 1.

`.env.example` additions (template, no real values):
```
# --- Exclusives / Amazon SP-API (secrets — real values only in .env & Render) ---
SP_API_CLIENT_ID=
SP_API_CLIENT_SECRET=
SP_API_REFRESH_TOKEN=

# --- Exclusives tuning (optional; safe defaults in code) ---
EXCLUSIVES_SWEEP_MINUTES=30
```

Open sub-choice within this plan: whether the **refresh token** stays a plain env
var or is additionally persisted encrypted in `SellerAccount` (§8.6) — resolved at
Chunk 3.
