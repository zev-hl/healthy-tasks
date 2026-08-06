# HL Central — Architecture Audit (Read-Only)

**Date:** 2026-08-05  **Scope:** whole codebase (`backend/`, `frontend/`, `packages/shared`, `prisma`, tests, deploy config, docs).
**Method:** five parallel read-only auditor passes (data model, backend API, security/access-control, frontend, testing/ops), synthesized here. No files were modified.

---

## Executive summary

HL Central is a **well-built, internally consistent application**. The backend has a disciplined routes → controller → service → mapper pipeline, a single error contract, complete validation coverage on mutating endpoints, and a genuinely strong integration test suite (191 tests on a real ephemeral Postgres with real migrations and DB triggers). The access-control model is centralized and mostly enforced consistently. **No Critical (data-corrupting / actively-exploited) findings surfaced.**

The gaps cluster into four themes:

1. **Operational readiness for production** — auth has no rate limiting; prod email and S3 attachments are unconfigured *and fail silently*; there's no CI, no error tracking, and no process-level crash handlers.
2. **One real access-control hole** — reminders bypass task access checks and leak private-task metadata.
3. **The just-shipped optimistic-concurrency feature is non-atomic** — it narrows but doesn't close the lost-update window, and it isn't tested.
4. **Missing shared primitives on the frontend** — no `Modal`, `Field/Input`, or data-fetching layer, which drives duplication, accessibility gaps, and a global DOM-observer workaround.

Everything below is triage material, not a mandate to fix all of it. Suggested sequencing is at the end.

---

## Start here — highest priority (7 items)

| # | Item | Area | Why it's first | Effort |
|---|------|------|----------------|--------|
| 1 | **Reminders bypass task access control** (`reminder.service.ts:52`) | Security | Any authed user can attach a reminder to *any* task id (incl. Private), then read its name/start/priority via `/notifications` — defeats the "hidden task = 404" guarantee. | Small |
| 2 | **Optimistic concurrency is non-atomic** (`task.service.ts:229`; all `goal.service.ts` writes) | Data correctness | The feature we just shipped reads `updatedAt`, then writes many round-trips later — two concurrent saves both pass the check and last-writer-wins. | Small–Med |
| 3 | **No rate limiting on auth** (`auth.routes.ts`, `app.ts`) | Security | Unlimited login guessing and reset-email flooding; bcrypt slows but doesn't stop it. Flagged by two independent passes. | Small |
| 4 | **Prod email + S3 unconfigured and fail silently** (`env.ts:34,52-61`; `mailer.ts`) | Ops | Password reset & attachments are broken in prod, and the app boots "healthy" with dev defaults (`minioadmin`, console mailer) instead of failing fast. | Small–Med |
| 5 | **No CI** (`.github/` absent) | Ops | Nothing runs tests/lint/build before `staging`/`main`; a red suite can reach prod. The gated flow is entirely manual. | Small |
| 6 | **`mergeUsers` no longer reassigns most data** (`user.service.ts:320`) | Data | Goals/reminders/notifications/templates owned by a merged account are orphaned (its own TODO comment was never done). | Med |
| 7 | **No error tracking / crash handlers** (`server.ts:27`) | Ops | No Sentry-equivalent and no `unhandledRejection`/`uncaughtException` handlers — prod failures are invisible beyond raw logs, and a stray rejection can kill the process. | Small–Med |

---

## Findings by severity

Severity is my synthesized ranking. `(A)`=Data, `(B)`=Backend API, `(C)`=Security, `(D)`=Frontend, `(E)`=Testing/Ops — the pass that raised it.

### High

- **Reminder IDOR** — `reminder.service.ts:52-61` (C). `addReminder` checks only that the task exists, never `requireTaskAccess`. Enumerate ids → POST a reminder → read `/notifications` to harvest name/startAt/priority of any task incl. Private. **Fix:** `requireTaskAccess(actor, taskId)` in `addReminder` (and `listRemindersForTask`). *Confidence: High.*

- **Non-atomic optimistic concurrency (lost update)** — `task.service.ts:229-234` + write at `:375`; every `goal.service.ts` transition (C/A). `findUnique` → `assertNotStale` → (many awaits later) a separate transactional write. Two concurrent PATCHes both pass and both write. **Fix:** make it atomic — `updateMany({ where:{ id, updatedAt: expected }, data }); if (count!==1) throw STALE_WRITE`, or re-read inside the txn. The repo already does exactly this for reminders/scheduler/goal-review; copy that pattern.

- **No auth rate limiting** — `auth.routes.ts:16,20,25`; `app.ts` (C/E). No `express-rate-limit`/lockout on login, forgot-password, reset-password. **Fix:** per-IP + per-account throttling.

- **Prod email stubbed + S3 fails silently** — `env.ts:34,52-61`; `mailer.ts:63`; `render.yaml` (E/C). `EMAIL_PROVIDER` defaults to `console` (reset links only logged); `STORAGE_DRIVER=s3` with dev fallbacks (`minioadmin`) so uploads error at runtime with no boot signal. **Fix:** in production, require `smtp` + real S3 creds; fail fast otherwise. (Also: console mailer logs single-use reset tokens — see Medium.)

- **No CI pipeline** — `.github/` absent (E). No automated test/lint/build gate on PRs to `staging`/`main`. **Fix:** GH Actions running `npm run lint && npm test`.

- **`mergeUsers` incomplete reassignment** — `user.service.ts:320-458` (A). Does not repoint `Goal.owner/creator/approver/resolver`, `Reminder`, `Notification`, `NotificationPreference`, `UserScreenPref`, `TaskTemplate.createdById`, `Task.reviewInitiatorId/priorAssigneeId`, `PasswordResetToken`. Merged-user goals become unmanageable (inactive owner). **Fix:** extend the merge transaction.

- **No process-level error handling / tracking** — `server.ts:27-28`; app-wide (E). No `unhandledRejection`/`uncaughtException` handlers; no Sentry-equivalent. **Fix:** add process handlers + an error-tracking integration.

- **No shared `Modal` primitive; ~8 hand-rolled modals** — `TaskDetailView.tsx:1112`, both goal modals, `MergeUsersModal`, `User*Modal`, `TaskPickerModal`, `ReviewerPickerModal`, `TemplatesPage` (D). None trap focus, restore focus on close, or set `role="dialog"`/`aria-modal`; only CommandPalette handles Escape. **Fix:** one `<Modal>` — removes ~10 copies and fixes the a11y gap at once.

- **No shared `Input/Field` primitive; ~100 raw inputs** — app-wide (D). This is *why* `suppressInputAutofill.ts` needs an app-lifetime `MutationObserver`. **Fix:** a `<TextField>` (label association + autocomplete baked in) lets that observer be deleted and fixes label gaps.

- **Inconsistent data-freshness policy** — no shared fetch layer (D). Unread badge polls 30s, dashboard 60s, but task/goal lists and the Notifications *feed* fetch once and never refresh. **Fix:** a shared `useResource`/React-Query layer to unify polling, loading/error/empty, cancellation, and the concurrency retry. *Highest-leverage frontend refactor.*

- **Drag interactions have no keyboard alternative** — `TaskKanban.tsx:103`, `TaskGantt.tsx:417` (D). Kanban status moves and Gantt reschedule are mouse-only. **Fix:** keyboard handlers or an accessible fallback control.

- **Clickable `<li>`/`<tr>` rows not keyboard-operable** — `HomePage`, `NotificationsPage:331`, `DueDatePerformancePage:453`, `TaskSearchPage:815` (D). `onClick` on non-interactive elements. **Fix:** real `<button>`/`<Link>` wrapper or `role`/`tabIndex`/`onKeyDown`.

- **Kanban optimistic-move rollback uses wrong snapshot** — `TaskKanban.tsx:54,60,73` (D). Failed move reverts to the *current prop* (`rows`), not the pre-move state; an in-flight refetch can clobber an optimistic move. **Fix:** single source of truth or capture prior `cards` for rollback.

- **Duplicated `actor()`/`parseId()` across 9 controllers** — (B). Nine near-identical actor helpers + ~7 id-parsers. **Fix:** shared `getActor(req)` / `parsePositiveIntParam(...)`.

- **`Actor` type redeclared 4+ times** — `access-control`, `attachment`, `comment`, `template` services + `GoalActor` (B). **Fix:** one canonical exported `Actor`.

### Medium

- **Access-control scope recomputed every request; unbounded downline fetch** — `access-control.service.ts:377-430` (A). For a manager, fetches *all* downline tasks (`findMany` no `take`) and materializes read-only visibility into a large `id IN (...)`. Dominant scaling risk. **Fix:** per-request memoization + EXISTS/join instead of an id list.

- **`getSupervisorChainIds` N+1** — `access-control.service.ts:32-49` (A). One `findUnique` per chain level, called in per-task loops. **Fix:** recursive CTE (as already used for the task tree).

- **Missing GIN index on `Task.tags`** — `schema.prisma:161`, used at `task-search.service.ts:171` (A). `hasSome` array filter sequential-scans. **Fix:** `@@index([tags], type: Gin)`.

- **`listAllTags` full-table unnest on every text search** — `task.service.ts:161` (A). **Fix:** cache/materialize the distinct-tag list.

- **Leading-wildcard ILIKE text search unindexed** — name/email/instanceLabel `contains` (A). Sequential scans at scale. **Fix:** `pg_trgm` GIN indexes if search latency matters.

- **Three near-parallel ExcelJS export builders** — `task-export`, `due-date-report-export`, `goal-export` (B). Header-bolding + date-numFmt loop verbatim in all three. **Fix:** `newSheet()`/`applyDateFormat()` helpers.

- **XLSX download boilerplate duplicated 4×; content-type literal in 3 places** — `tasks/reports/goals` controllers (B). **Fix:** `sendWorkbook(res, wb, filename)` + one exported constant.

- **409 overloading distinguishable only by absence of a code** — `optimistic.ts:19` vs domain `HttpError.conflict` + Prisma P2002 (B). Stale-writes carry `details.code="STALE_WRITE"`; state-conflicts carry none. **Fix:** give domain conflicts a positive code (`STATE_CONFLICT`) so every 409 self-identifies.

- **`expectedUpdatedAt` validated as bare string** — `schemas.ts:164,587`; `optimistic.ts:18` (B). Malformed token → `Invalid Date` → always throws phantom `STALE_WRITE` 409 instead of a 400. **Fix:** validate as ISO datetime.

- **Scheduler/email side-effects orchestrated in controllers** — `notifications.controller.ts:30`, `users.controller.ts:98,132` (B). **Fix:** move to service methods; keep controllers thin.

- **`presign*`/`create*Attachment` near-identical task/comment pairs** — `attachment.service.ts:105,136` (B). **Fix:** parameterize over `{authorize, keyPrefix}`.

- **Reset-link/console mailer logs single-use tokens** — `mailer.ts:63`; `auth.service.ts:63` (C). In any non-smtp deploy, account-takeover tokens hit stdout/log aggregation. **Fix:** never log the raw link; require a real provider in prod.

- **Insecure fallback credentials** — `env.ts:42-45,58-59` (C). `SEED_ADMIN_PASSWORD`→`ChangeMe123!`, S3 keys→`minioadmin`. **Fix:** `required()` in production.

- **No `helmet` / security headers; no server timeouts** — `app.ts:22-34`; `server.ts` (C/E). Missing nosniff/HSTS/frame options; no `headersTimeout`/`requestTimeout` (slow-loris). **Fix:** `helmet()` + server timeouts.

- **`/health` is liveness-only** — `app.ts:37` (E). Returns ok even if Postgres is down, so Render's health check is misleading. **Fix:** a readiness variant with `SELECT 1`.

- **No structured/request logging or correlation ids** — app-wide (E). Ad-hoc `console.*`. **Fix:** `pino`/`morgan` + request ids.

- **Zero frontend tests** — (E/D). Non-trivial logic (access cues, filters, TipTap, unsaved-guards, optimistic flips) untested. **Fix:** Vitest + RTL on the highest-logic components.

- **Stale-write 409 and scheduler watchdog untested** — `integration.test.ts` (E). The newest feature has no test asserting the 409/`details.code`; `checkSchedulerHealth`/`isSchedulerDown` uncovered. **Fix:** add cases.

- **Notifications feed claims polling it doesn't do** — `NotificationsPage.tsx:501` vs `:130` (D). "Updates every 30 seconds" but the feed fetches once (only the badge polls). **Fix:** add an interval or fix the copy.

- **Duplicated page scaffolding** — toolbar, filter-chip row, pager math (verbatim `TaskSearchPage:862` ≡ `UsersPage:418`), Export button+flag, date-range popover (two different ISO⇄input conversions), hydrate/persist scaffold; Start/Due pair duplicated in `TaskForm` & `TaskDetailView`; `User*Modal` near-identical (D). **Fix:** extract shared components/hooks.

- **Fetch-on-mount without cancellation / swallowed errors** — `TaskForm:67`, `UserFormModal:25`, `TaskDetailView:124`, others (D). Some set state after unmount; some swallow errors into empty dropdowns; `ReviewerPickerModal:52` has no error state. **Fix:** unmount guards + surfaced errors.

- **Unvalidated `as` casts on selects & persisted prefs** — many (`TaskDetailView:666`, `TaskSearchPage:190` localStorage blob, etc.) (D). Stale localStorage → malformed state. **Fix:** parse/validate helpers.

- **`RichTextEditor` uncontrolled after mount** — `RichTextEditor.tsx:187` (D). External `value` changes ignored; callers work around via `key`/remount. Latent trap for a future in-place update. **Fix:** document the contract or add a sync effect.

- **`SortHeader` not keyboard-operable; no `aria-sort`** — `SortHeader.tsx:18` (D). Inherited by every sortable table. **Fix:** button semantics + `aria-sort`.

- **Stale docs** — `DEPLOY_RENDER.md:59,120` names old `healthy-tasks-*` services (now `hlcentral-*`); `docs/render-virginia-migration.md:3` marked "PROPOSED" though it's done (E). **Fix:** update.

- **Hand-rolled env validation; `zod` unused there** — `env.ts` (E). No numeric coercion validation (`Number(PORT)`→`NaN`), no prod-mode assertion against dev defaults. **Fix:** validate the env with zod.

### Low

*(Abbreviated — full detail in the pass outputs.)*

- `Notification.actorId` is a bare `String?` with no FK / not merged (A). — `Task.tags`/dependency self-edge constraints live only in app code, not DB CHECKs (A). — Several unbounded `findMany` (`listTasks`, `listUsers`) (A). — `DateTime` columns are `timestamp` (no tz); safe only while the DB session is UTC (A). — Dependency add/remove doesn't bump `Task.updatedAt`, so the optimistic token doesn't cover relationship edits (A). — Inline `req.body as {...}` instead of inferred types; dead `SetTaskPrivateInput` export; double id-parse in `updateTaskController` (B). — Attachment download check skipped when both task refs are null (latent, fail-closed) (C). — `jwt.verify` doesn't pin `algorithms` (C). — Presigned upload doesn't bind object size → orphan blobs (C). — Anti-enumeration dummy bcrypt hash may be invalid → timing signal (C). — `/api/users/active` exposes the full roster to every member (design call) (C). — `CommandPalette` O(n²) row lookup; no vendor `manualChunks`; `userLabel` re-implemented in `TeamGoalsPage`; label/`htmlFor` gaps in `TaskForm`/`TemplatesPage` (D). — Prisma 5.x / Express 4.x are one major behind (still supported); backend Dockerfile is dev-only (Render builds natively); no forced-exit timeout on shutdown; seed default password (E).

---

## Cross-cutting themes

1. **"Fails silently in prod" is the recurring operational risk** — email, S3, and env defaults all boot healthy and break at runtime. A single **`assertProductionReady()`** at startup (require smtp + real S3 + non-default secrets when `NODE_ENV=production`) would collapse several High/Medium findings into one fix.
2. **Missing shared primitives cause a cascade** — no `Modal`/`Field`/fetch-layer explains the a11y gaps, the duplication, *and* the runtime autocomplete patch. Three primitives would retire ~15 findings.
3. **The optimistic-concurrency feature needs a second pass** — make it atomic, give 409s positive discriminators, validate the token as a date, cover relationship edits, and add tests. It's 80% there.
4. **Access-control is strong but has two edges** — the reminder hole (fix now) and the per-request unbounded scope computation (watch as orgs grow).

---

## Strengths (so this isn't all deltas)

- **Backend consistency**: uniform route→controller→service→mapper, complete `asyncHandler`+`validateBody` wiring, single `HttpError`/error-handler contract, no unvalidated body reads on mutating routes.
- **Race handling where it counts**: unique-index claim guards against scheduler double-fire, `pg_advisory_xact_lock` for relationship-cycle TOCTOU, conditional `updateMany` for time-based races, DB CHECK + trigger defense-in-depth.
- **Security fundamentals**: centralized access model with existence-hiding 404s; 256-bit single-use hashed reset tokens with session revocation (`tokenVersion`); bcrypt-12; uniform login errors; parameterized SQL; no rich-text XSS path found (server sanitizes + client re-sanitizes).
- **Test quality**: real embedded-Postgres with real migrations & triggers, driven through HTTP; broad coverage (auth, full access-control matrix, concurrency, goal lifecycle, recurrence/templates, reports with timezones).
- **Frontend fundamentals**: clean `api/client` seam, route-level code-splitting (TipTap off first paint), thorough session lifecycle, and exemplar components (CommandPalette, ReviewerPickerModal) that show the patterns just aren't factored into shared primitives yet.
- **Deploy design**: IaC render.yaml, all secrets `sync:false`, `preDeployCommand` runs migrations before boot, gated staging→main.

---

## Suggested sequencing

**Sprint 1 — security & prod-readiness (small, high-value):** reminder IDOR (#1); auth rate limiting (#3); `assertProductionReady()` covering email/S3/secrets (#4); `helmet` + server timeouts; make optimistic concurrency atomic (#2) and add its tests; add CI (#5).

**Sprint 2 — correctness & observability:** `mergeUsers` reassignment (#6); error tracking + process crash handlers (#7); readiness `/health`; structured logging; positive 409 discriminator + ISO validation of the token.

**Sprint 3 — frontend foundations (highest long-term leverage):** shared `Modal`, `Field/Input` (delete the MutationObserver), and a `useResource`/data-fetching layer; then retire the duplicated scaffolding and fix the Kanban rollback + keyboard/a11y gaps on top of them.

**Ongoing / as scale demands:** access-control scope memoization + index additions (tags GIN, trigram); frontend test coverage; doc refresh.

*Nothing here blocks current usage — the app is production-usable today. This is the backlog to weigh against incoming user requests.*
