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
  `capturedAt`. `@@index([listingId, capturedAt(Desc)])`.
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
- **Chunk 5 — Change-detection engine.** Pure function over (prev, current)
  snapshot → `AlertLog[]`, honouring `AlertSetting.mode` and the Buy Box
  algorithm (§6.4 of brief — do **not** trust `IsBuyBoxWinner`) and suppression
  rule (§6.5). Fixture-driven unit tests.
- **Chunk 6 — Scheduler pass.** Wire ingestion+detection into
  `scheduler.service.ts` on the sweep cadence; idempotent; logs per-marketplace
  call counts.
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

**Deferred:**
7. ⚠️ **Snapshot retention/prune policy** — decide in Chunk 6 (scheduler), not a
   schema change. (§4)

**Status: Chunk 1 built** ✅ (nav + tab scaffolding). Delivered:
- `packages/shared`: Exclusives enums/labels + alert-type tone map (§4); rebuilt.
- `frontend`: sidebar "E-commerce exclusives" group (2 tabs, colour dots), two
  lazy routes (`/exclusives/groups`, `/exclusives/log`, no role gate),
  `ExclusivesGroupsPage` + `ExclusivesLogPage` (full design chrome + empty
  states), `components/exclusives/AlertBadge.tsx` (reuses `.status-pill`, maps
  tones → existing `--danger/--warn/--ok/--review` tokens), scoped `exc-*` CSS.
- Verified: frontend `tsc --noEmit` clean; Vite compiles the modules; route 200.
- Design reuse held to plan §7 — no copied markup/classnames; app tokens only.

Next: Chunk 2 (Prisma migration + seeders) — reviewable DDL first per brief §15.

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
