# HLAI-71 · Chunk 8 — Wiring the screens to real data: plan

> **Status (2026-09-22): 8a and 8b done; 8c and 8d not started.** Delivered one
> sub-part at a time, verified before moving on. Each part's summary sits under
> its own heading below.
>
> Companions: [`HLAI-71.md`](./HLAI-71.md) (living plan),
> [`chunk_7_plan.md`](./chunk_7_plan.md) (the API this consumes, now built) and
> [`chunk_6_completed.md`](./chunk_6_completed.md).

---

## In plain language

Everything behind the Exclusives screens is finished and working. The 30-minute
check runs, 445 products are watched, alerts are recorded, and since Chunk 7 the
server can answer every question the screens need to ask.

The screens still show made-up rows. They were designed and styled in Chunk 1 —
the layout, the colours, the filters and the buttons are all there — but they
read a file of invented data rather than the real thing. Save does nothing.
Export is greyed out. Bulk import is a button with no code behind it.

Chunk 8 is the wiring. Nothing about the monitoring changes; this is the step
that makes the last six chunks visible and usable.

## Context

- The screens are **fully styled** — 158 `exc-*` rules in
  `frontend/src/styles.css`, sidebar tabs wired (`Layout.tsx:102-105`), routes
  registered (`router.tsx:100-103`).
- What they render is `frontend/src/lib/exclusivesMock.ts`: invented groups,
  invented alerts, a hard-coded "last run 2:30 PM · next run 3:00 PM", and a
  fake 400 ms loading delay.
- The backend is complete and tested: 317 integration tests, 122 unit tests, and
  live checks against the real seller account and the 445 listings.

## Decisions taken with the user (2026-09-22)

| # | Decision | Note |
|---|---|---|
| 1 | **Bulk import keeps its designed behaviour** | The button stays "Bulk import & replace" and makes the group exactly the uploaded list, guarded by a confirmation that spells out how many products will be removed. |
| 2 | **CSV file or paste, not .xlsx** | No new frontend dependency. A column of codes, from a `.csv` file or pasted into a box. Reading an Excel file would need SheetJS (~1 MB). |
| 3 | **The Groups list gets clickable column sorting** | Name, product count and date — the server already supports all three. |

## What already exists — do not rebuild

- `ExcPager` (total / page / pageSize + callbacks), `AlertBadge`, `Flag`,
  `LoadingRow`, `Segmented`, `DeleteGroupModal` — all in
  `frontend/src/components/exclusives/`.
- `TableEmptyRow` (`components/ui/EmptyState.tsx:45-65`) for empty states.
- `useDebouncedValue` (350 ms is the house figure), `useStaleWriteGuard` +
  `ConflictBanner`, `useUnsavedChangesWarning`, and `formatAgo` /
  `absoluteShort` / `formatTimestamp` in `lib/datetime.ts` — these replace the
  mock's own `fmtRel` / `fmtAbs`.
- `downloadXlsx` (`api/client.ts:458-480`) is **format-agnostic despite its
  name**: it blobs whatever comes back and never reads the content type. Rename
  it `downloadFile` and both CSV exports become one-liners.
- `useExclusivesStatus` is the one Exclusives piece already wired, but its
  module-level permanent cache suits a slow-moving health light, **not list
  data**. Copy its shape, not its caching.

## Conventions this chunk must follow (verified in code)

- **Data loading**: hand-rolled `useCallback` fetch + `useEffect` trigger +
  `useDebouncedValue` on the search box. There is no react-query or SWR in this
  repo. Canonical pattern: `TaskSearchPage.tsx:241-271`.
- **Errors**: `setError(err instanceof ApiError ? err.message : '…')` and one
  `<div className="alert error">` above the table. That line appears ~80 times
  across `frontend/src`; it is the house style. `ApiError`
  (`api/client.ts:97-105`) carries `status` and `details`.
- **Stale writes**: `guard(...)` + `<ConflictBanner>` + swapping Save for
  Refresh — `GoalEditorModal.tsx:39, 64-93, 102-124, 229-237`.
- **No view preferences**: the Exclusives screens have no `SCREEN_KEYS` entry, so
  skip the `hydrated` gate the task and user grids use.
- **One deliberate improvement**: the existing list screens have a last-write-
  wins race when two queries overlap (debounce is their only guard). Add a small
  request-id ref to each Exclusives fetch so a slow response cannot overwrite a
  newer one.

---

## 8a — Groups list and header

> **Built and verified, 2026-09-22.** In simple terms:
>
> - The Alert Groups screen now shows the **real groups from the database**,
>   not the sample rows. The sample data is still there for the other two
>   screens until 8b and 8c.
> - The two numbers at the top are real: alerts in the last 24 hours and
>   products being watched, with the group and single-product counts beneath.
> - The line under the title now says when Amazon was last checked and when the
>   next check is due, taken from the real schedule. If automatic checks are
>   switched off it says so, rather than showing a next time that will never
>   arrive.
> - Searching, sorting and paging are all done by the server, so the screen
>   never holds more than one page however many groups there are.
> - **Columns can be sorted by clicking them** — name, product count and
>   updated date. Click again to reverse.
> - The product preview shows the first three codes and how many more there
>   are, and a product sold in both countries appears once.
> - **Delete now actually deletes.** It calls the server and reloads, instead of
>   just hiding the row until the page was refreshed.
> - There is now an **empty state**, worded differently depending on whether a
>   search is active. Before, an empty result showed nothing at all.
> - Typing in the search box waits a moment before asking the server, so one
>   word is one request rather than six.
> - If two requests overlap, only the newest answer is allowed to land — a slow
>   reply can no longer overwrite a newer one.
> - The fake loading delay is gone; the spinner now reflects a real request.
> - The pager no longer draws a button for every page. With 400 pages it shows
>   the first, the last and a few around where you are.
>
> **Files:** new `frontend/src/test/render.tsx` (the first render-with-providers
> helper), `ExclusivesGroupsPage.test.tsx`, `ExcPager.test.ts`; changed
> `ExclusivesGroupsPage.tsx`, `ExcPager.tsx` (page window), `DeleteGroupModal.tsx`
> (retyped to the real DTO), `api/client.ts` (the whole Exclusives block, and
> `downloadXlsx` renamed `downloadFile` since it was never xlsx-specific),
> `packages/shared/src/index.ts` (request shapes).
>
> **Tests:** 13 new frontend tests, all passing (31 in total). Typecheck, ESLint,
> Prettier and a production build all clean.


**Goal:** the Groups screen shows the real groups and the real header numbers.

**What gets built**
- An Exclusives block in `api/client.ts` beside `getExclusivesStatus` (`:156`):
  `queryExclusivesGroups`, `getExclusivesGroup`, `getExclusivesSummary`,
  `queryExclusivesAlerts`, `lookupExclusivesAsins`, `createExclusivesGroup`,
  `updateExclusivesGroup`, `deleteExclusivesGroup`, and the two export wrappers.
- Header numbers from `GET /summary`: alerts in the last 24 hours, products
  monitored, group and individual counts, and a real run line built from
  `lastSweepAt` / `nextSweepAt` (replacing the hard-coded `RUN_HEADER`).
- The table from `POST /groups/query` with `{ text, sort, page, pageSize }`.
  Search, sorting and paging all move server-side.
- **Sorting**: clickable headers for name, product count and updated date, with
  an ascending/descending indicator. Any change resets to page 1.
- **An empty state** via `TableEmptyRow`, worded differently when a search is
  active. The page has none today — an empty result renders nothing at all.
- Delete calls `DELETE /groups/:id` and refetches, replacing the client-side
  `removed` set. `DeleteGroupModal` is retyped from `MockGroup` to
  `ExclusivesGroupRowDto` (it only reads `name` and a count).
- The fake 400 ms timer goes; `LoadingRow` now reflects a real request.

**Depends on:** nothing.

## 8b — Alert log

> **Built and verified, 2026-09-22.** In simple terms:
>
> - The Alert Log screen now shows the **real alerts from the database**
>   instead of invented ones.
> - Each row shows the actual message — "List price changed from $33.95 to
>   $33.90" — and, next to the alert type, the before and after values.
> - **All four filters now ask the server**: the date range, the alert types,
>   the search box, and the group. Nothing is filtered in the browser any more,
>   so it stays fast however many alerts build up.
> - **The group link from the Groups screen now works.** Clicking a group was
>   always meant to open the log filtered to it; the log never read that, so it
>   silently showed everything. It now opens filtered, with a chip naming the
>   group and a click to show all again.
> - **The Export button works.** It downloads a CSV of everything matching the
>   filters on screen — not just the page you are looking at — and is greyed out
>   when there is nothing to download.
> - The date pickers are in your own local time; they are converted to a
>   precise moment before being sent, so a range means what it looks like.
> - There is an **empty state** that says whether the log is genuinely empty or
>   just filtered down to nothing.
> - The header count is real, and the invented "runs at :00 and :30" line is
>   gone — the real schedule is shown on the Groups screen.
> - An alert whose group was deleted still shows the group's name, exactly as
>   the delete dialog promises.
> - Same care as 8a: the search waits a moment before asking, and an overtaken
>   reply can never overwrite a newer one.
>
> **Files:** new `ExclusivesLogPage.test.tsx`; changed `ExclusivesLogPage.tsx`
> and `ExclusivesGroupsPage.tsx` (the row click now also passes the group name,
> so the log can show it in the chip).
>
> **Tests:** 11 new frontend tests, all passing (42 in total). Typecheck, ESLint,
> Prettier and a production build all clean.


**Goal:** the Alert Log screen shows the real alerts, with its filters working
against the server.

**What gets built**
- Rows from `POST /alerts/query`. The screen's existing state maps one-to-one
  onto the request: `text`, `alertTypes`, `from`, `to`, `page`, `pageSize`.
- **The broken deep link is fixed.** The Groups page pushes `state: { gid }`
  (`ExclusivesGroupsPage.tsx:146`) but the log page never reads it, so clicking a
  group silently shows the unfiltered log today. Read it with `useLocation`,
  send it as `groupIds`, and show a clearable chip naming the group.
- Each row shows the real `message` and, where present, previous → new values,
  replacing the invented `ALERT_DETAILS` text.
- The hard-coded "runs at :00 and :30" sub-line goes — the real cadence comes
  from the summary.
- **The Export button is enabled** → `POST /alerts/export` with the same filters
  plus the browser's time zone.

**Depends on:** 8a (the API wrappers).

## 8c — The editor: load, save, delete, single add

**Goal:** creating and editing a group actually works.

**What gets built**
- Loading an existing group from `GET /groups/:id` (numeric ids; the mock used
  strings like `'g1'`). `deriveSettings` — the fudge that invented per-type modes
  from a count — is deleted in favour of the twelve real settings.
- **Adding one product**: `POST /listings/lookup` for that code and marketplace.
  On success the row appears with its real title. On failure, a short message
  saying which of three things happened — not on the seller account, already in
  another group, or Amazon did not answer. Only the third is worth retrying.
- **A small toast component** under `components/exclusives/`. There is no toast
  anywhere in the app today; the nearest thing is the unexported `flashSaved`
  timer in `TaskDetailView.tsx:103-113`, which this follows. The agreed screen
  flow calls for a toast specifically.
- **Save**: `POST /groups` or `PATCH /groups/:id` with name, type, listings,
  `listingsMode: 'merge'`, settings and `expectedUpdatedAt`. `ApiError.details`
  is read to flag which rows failed (`details.listings`) and which are held by
  another group (`details.clashes`), with a "move it here" retry that re-sends
  `moveExisting: true`.
- **Stale writes**: `useStaleWriteGuard` + `ConflictBanner`, Save swapping to
  Refresh, exactly as `GoalEditorModal` does.
- Real dirty tracking behind the crumb-bar meta text (hard-coded today) and
  `useUnsavedChangesWarning` on leaving with unsaved changes.

**Depends on:** 8a.

## 8d — Bulk import and both downloads

**Goal:** the two remaining placeholder buttons work, and the mock file is gone.

**What gets built**
- **The bulk import modal** behind the existing button. It accepts a `.csv` file
  or a pasted column of codes, reads it in the browser — the file never leaves
  the machine — and sends only the codes, in batches of about 100 so the
  progress bar shows real progress rather than an animation.
- **The four result lists** agreed on 2026-09-22 (see the "Adding ASINs" section
  of `chunk_7_plan.md`): ready to add, already in another group, not on the
  seller account, and couldn't be checked. Proceed stays disabled while any
  remain unchecked, offering "retry just these" and "add without replacing".
- A confirm step stating **how many products will be removed**, then Save with
  `listingsMode: 'replace'`.
- **"Export list"** → `POST /groups/:id/export`.
- `frontend/src/lib/exclusivesMock.ts` is deleted, and `Flag.tsx` — which
  imports `Marketplace` from it — is repointed at `ExclusivesMarketplace` from
  the shared package.

**Depends on:** 8c.

---

## Risks to keep in view

1. **`ExcPager` renders every page number** (`ExcPager.tsx:23, :53`). Harmless at
   seven mock rows; with server-side paging over thousands of alerts it renders
   hundreds of buttons. Cap it to a window around the current page in 8a.
2. **Per-row save errors are new ground.** No screen in this repo maps a
   backend `details` payload onto individual rows — `fieldErrors` is consumed
   nowhere. Keep it simple: a message on the row plus the usual banner.
3. **Replace is the destructive path.** Its real guard rail is in the backend (a
   replace is refused outright when Amazon did not answer), but the modal must
   never present "couldn't be checked" as "not on the account".
4. **No render-with-providers test helper exists.** The first wired-screen test
   has to write one.

## Verification for each sub-part

- `npm run build:shared`, frontend typecheck, `npm run test --workspace
  frontend`, ESLint and Prettier on changed files — all inside Docker per
  `CLAUDE.md`.
- New vitest tests per sub-part, following
  `notifications/NotificationContext.test.tsx`: mock `../api/client`, fake
  timers, `advance(350)` past the debounce, assert exactly one request.
- **Live, against the real 445 listings:** open the Groups screen and check the
  header numbers match `GET /summary`; sort and page the table; click a group and
  confirm the log opens filtered to it; download both CSVs and open them; add one
  ASIN and watch a single Amazon request go out; run a bulk import from a small
  CSV; create a test group, move an ASIN into it, then delete it and confirm the
  445 listings are intact and the alerts survived.
- Update `HLAI-71.md` as each sub-part lands, and write `chunk_8_completed.md` at
  the end, in the style of `chunk_6_completed.md`.
