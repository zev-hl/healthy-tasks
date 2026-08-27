# Phase 14 - Neon Cost Reduction

Status: SPEC (not started)
Branch: `phase-14-neon-cost` off `staging`

## Problem

The Neon "Rows" chart shows a steady band of UPDATEs 24/7 with zero INSERTs and
zero DELETEs across a 48h window, and the `ENDPOINT INACTIVE` series never
appears. Root cause: `runScheduler` writes `SchedulerState.lastTickAt`
unconditionally once per minute (`backend/src/services/scheduler.service.ts`),
and each pass also issues several SELECTs. Neon autosuspends on *query*
inactivity, not write inactivity, so a 60s tick pins the compute awake
permanently on both prod and staging.

Secondary contributor: the frontend polls `/api/notifications/unread-count`
every 30s per open tab (`frontend/src/notifications/NotificationContext.tsx`),
and that endpoint reads `SchedulerState` twice per call.

## Observed baseline (2026-08-27)

From the Neon operations log for the PRODUCTION endpoint `ep-sweet-cherry-avqfw69z`
(Primary), read against a period of near-zero user activity:

| Window | Duration | State |
|---|---|---|
| Jul 30 3:30pm - Aug 9 10:49pm | 10 days | awake continuously |
| Aug 9 10:49pm - Aug 10 11:20am | 12h 31m | SUSPENDED |
| Aug 10 11:20am - Aug 27 | 17 days | awake continuously |

Conclusions:

- **Autosuspend is enabled and works.** A `Start 3:02pm -> Suspend 3:08pm` pair on
  Jul 30 implies a ~5 minute timeout (the default). N1 answered. Confirm the
  timeout value directly, since two `Apply config` operations on Aug 6 may have
  changed compute settings.
- **Awake 27 of the last 28 days with essentially no users**, so the load is
  100% machine-generated: the 60s scheduler tick, doing no actual work (the Rows
  chart shows zero INSERTs, i.e. nothing materialized).
- **The 12h31m suspend on Aug 9-10** means nothing queried the database. Billing
  data (below) shows the current period starting Aug 10 and the compute restarting
  Aug 10 11:20am, so the most likely cause is a PLAN CHANGE - probably exhausting
  a free-tier compute allowance around Aug 9, then upgrading to Launch on Aug 10 -
  rather than an API crash. Either way the app could not reach its database for
  ~12.5h and no alert fired, because the watchdog only executes inside a request
  served by the API process. ACTION: confirm against Render's event log for
  `hlcentral-api` and Neon's plan-change history in that window.

## Cost baseline (2026-08-27)

Plan: **Launch**. Confirms scale-to-zero after **5 minutes** - N1 fully answered,
and the 5-minute figure the estimates below assume.

Billing period Aug 10 - Sep 1, read on Aug 27 (17 days / 408 wall-clock hours):

| Line | Usage | Charge |
|---|---|---|
| Compute | 399.04 compute-hours | $42.19 |
| Storage (root branches) | 0.02 GB-month | $0.01 |
| Storage (child branches) | 0.02 GB-month | $0.01 |
| **Total to date** | | **$42.21** |

- **399.04 / 408 = 97.8% of wall-clock awake.** Matches the ops log exactly.
- **Storage is irrelevant** at $0.02. Compute is ~99.95% of the bill. Any
  optimization that is not about compute-hours is wasted effort.
- Effective rate ~$0.106 per compute-hour. Run rate ~$2.48/day, so **~$75-77/month**.

Projected after this phase, at current (near-zero) activity: the scheduler wakes
4-6 times/day, and each wake costs its few seconds of work plus the 5-minute
autosuspend timeout, so roughly 30 min/day = **~15 compute-hours/month, about
$2/month**. That is ~$75/month -> ~$2/month, on the order of **$900/year**.

CAVEAT to verify: 399 compute-hours is almost exactly ONE endpoint running
continuously. If `hlcentral-api-staging` were also running its 60s scheduler, the
staging branch's endpoint should be awake too and the total would be nearer 800
hours. Check the per-endpoint compute breakdown - if staging is not contributing,
the staging API may not actually be running, which is worth knowing on its own
and would reduce S3's expected saving to roughly zero.

**Success criteria for this phase, measured against the above:** prod shows
regular `Suspend compute` operations, and any repeat of the Aug 9-10 event
produces an admin email rather than silence.

**Note on justification.** With near-zero current activity, the client-side items
(C1/C2/C3) and S2/S5 buy nothing measurable TODAY - they are future-proofing for
when usage arrives. The immediate value is S1 + S3 + S4 + S4a + S4b, and the
strongest single argument for the phase is now RELIABILITY (making silent
failures loud), not compute cost. Sequence accordingly - see Rollout.

## Non-goals

- SSE / websocket push. That is Phase 15 (`docs/sse-push-notifications-spec.md`).
- Playwright / real-browser E2E. See Testing, Tier 3 - deferred deliberately,
  covered by a manual checklist in this phase.
- Any Prisma migration. This phase adds no schema changes.

## Prerequisite (user, Neon dashboard, no code)

These gate whether the code work pays off at all. Do them first.

- N1. Confirm autosuspend is ENABLED on both branches and note the timeout.
- N2. Drop the staging branch's compute size to the minimum CU.
- N3. Confirm the current Neon plan actually includes scale-to-zero.

## Scope

### S1 - Move the scheduler heartbeat off Postgres

`backend/src/services/scheduler.service.ts`

- Add module state `let lastTickAt: Date | null = null`.
- `runScheduler` sets it instead of `prisma.schedulerState.upsert(...)`.
- `checkSchedulerHealth(now)` reads the in-memory value. If null (never ticked)
  or fresh, return with ZERO database calls. Only on staleness does it touch the
  DB, for the `lastAlertAt` cooldown claim.
- `isSchedulerDown(now)` reads the in-memory value. Zero DB calls.
- KEEP the `SchedulerState` table and the `lastAlertAt` conditional-update claim.
  That claim is authoritative state - it prevents duplicate outage emails across
  restarts and instances - and must stay in Postgres. Leave the now-unused
  `lastTickAt` column in place with a deprecation comment. No migration.

Tradeoff (accepted): an in-memory heartbeat cannot detect "the API process is
dead". Neither can the current one, since the watchdog only runs inside a request
served by that same process. The failure it does catch - timer dies, process
lives - is fully preserved. Under multi-instance, each instance watching its own
timer is more correct than a shared row.

### S2 - Collapse the duplicate SchedulerState read

`backend/src/controllers/notifications.controller.ts`

`unreadCountController` calls `checkSchedulerHealth(now)` and then
`isSchedulerDown(now)`; each currently does its own `findUnique` of the SAME row,
on every poll from every client. Collapse into one call that returns the flag.
After S1 both are memory reads anyway, but the duplication should still go.

### S3 - Make the scheduler optional per environment

- `backend/src/config/env.ts`: add `SCHEDULER_ENABLED` (boolean, default true).
- `backend/src/server.ts`: only call `startScheduler()` when enabled.
- `render.yaml`: set `SCHEDULER_ENABLED=false` on `hlcentral-api-staging`.

Staging then suspends essentially 24/7.

### S4 - In-memory next-wake scheduling (REVISED)

Replaces the fixed 60s `setInterval`. Two clocks:

**Coarse clock (correctness).** A hard ceiling on how long the scheduler may
sleep: 6 hours. Nothing can gate or invalidate it. Every pass re-derives all
state from the database, so it cannot drift.

**Fine clock (promptness only).** At the end of every pass, derive the next
genuinely time-sensitive moment and `setTimeout` to it if sooner than the
ceiling. Two properties are required and non-negotiable:

- Recomputed from scratch every pass and rebuilt at boot. NEVER incrementally
  maintained, so there is no cached value that can go stale.
- Can only ever cause work to happen EARLIER than the coarse ceiling would. If
  the computation is wrong, behavior degrades to the coarse baseline, not to
  silence.

`computeNextWakeAt(now)` takes the minimum of:

- next reminder due time: `MIN(task.startAt - leadMinutes)`. There is no stored
  `remindAt` column (`schema.prisma`, `model Reminder`).

  **AS BUILT - do NOT compute this in SQL.** This spec originally prescribed a
  `$queryRaw` using `make_interval(mins => r."leadMinutes")`, and it was wrong.
  A derived `timestamp` compared against a Prisma-bound parameter (bound as
  `timestamptz`) is reconciled through the SESSION TIMEZONE, silently shifting the
  comparison by the UTC offset. The test database runs in America/New_York, the
  predicate was off by four hours, and reminder dispatch matched nothing. Caught
  by the S4a test. Fetch the small candidate set (un-emailed reminders only) with
  an ordinary Prisma query and take the minimum in JS. The same applies to S4a's
  candidate query, now a coarse `findMany` with `distinct: ['userId']` - due-ness
  stays where it already lived, in `listDueReminders`.

- earliest `Approved` goal deadline
- earliest active-template anchor minus the lead window
- earliest task-recurrence due date

Clamp the result to `[60s, 6h]`.

State lives in a module variable, NOT a file. Render gives both API services an
ephemeral filesystem (no `disk:` block in `render.yaml`), so a file buys no
durability. Surviving a restart is undesirable anyway - recomputing from the DB
at boot is the correct behavior, and reloading a stale value would resurrect a
belief formed before whatever caused the restart. A file would also introduce a
second source of truth that can disagree with Postgres, plus partial-write and
locking concerns.

Skip `wakeScheduler()` mutation hooks for now. With the coarse ceiling as the
correctness mechanism they are a pure optimization, and can be added later if
promptness disappoints.

Expected effect: roughly 4-6 scheduler DB wakes per day, down from ~1,440.

### S4a - Move reminder dispatch server-side

`processDueReminderEmails(actor, now)` currently runs in the request path
(`notifications.controller.ts`) and is scoped to the polling actor, so a user's
reminder email only sends when THAT USER is actively polling. If they have closed
the app, no email goes out. C1/C2/C3 all reduce polling and would make this
pre-existing weakness worse.

Move dispatch into the scheduler pass, for all users. Keep the existing
`emailSentAt` conditional-claim for idempotency. The reminder MIN query above is
what keeps this prompt despite the long coarse ceiling.

### S4b - Anti-silent-failure layers

Four independent mechanisms, all cheap at 4-6 wakes/day:

1. The coarse ceiling structurally bounds worst-case lateness to 6h. No code path
   can prevent it running.
2. **Lateness measurement.** Every materialized occurrence carries its own
   anchor, so compute `lateBy = now - (anchor - leadDays)` when firing. Past a
   threshold, alert admins through the existing `alertAdminsSchedulerDown` path.
   Same for `runGoalReviewPass`: report `max(now - deadline)` among flipped rows.
3. **Overdue invariant.** At the end of every pass, one COUNT asking "is anything
   eligible and still unmaterialized?" - the same predicate the pass just used,
   so after a successful pass it MUST be zero by construction. Non-zero means the
   pass is broken, whatever the cause. Alert.
4. The existing watchdog (per S1) still catches the timer dying outright.

Layer 3 also closes a PRE-EXISTING hole: the per-template `catch` inside
`runScheduler` swallows failures into `console.error`, which on Render means logs
nobody reads. A template that throws every pass currently fails forever, silently.

**Watchdog semantics change (as built).** `SCHEDULER_STALE_MS` is gone rather than
merely decoupled. Under next-wake scheduling a long quiet gap is NORMAL - the
scheduler may legitimately sleep for hours - so "no tick recently" is no longer
evidence of anything. Health is now measured against the wake the scheduler
itself scheduled:

- never ticked   => not down (a fresh boot has not had its first pass yet)
- no armed timer => down (the timer died)
- overslept its own `nextWakeAt` by more than `SCHEDULER_OVERDUE_GRACE_MS` => down

This is strictly more precise than the old fixed-interval check, and it costs zero
database calls on the polling path.

### S5 - Memoize unread counts

`backend/src/services/notification.service.ts`

Cache `getUnreadCounts(actor)` per user for ~10s so a user with four tabs open
costs one DB read, not four. Must be invalidated by `markNotificationRead` and
`markNotificationUnread` so the bell stays responsive after a click.

### C1 - Page Visibility

`frontend/src/notifications/NotificationContext.tsx`

Skip the poll while `document.visibilityState === 'hidden'`; fire one immediate
`refresh()` on `visibilitychange` to visible. Background tabs currently still
poll - browsers throttle background `setInterval` to roughly 1/min, not zero.
Follows the existing `focus` listener pattern in the same file.

### C2 - Idle backoff ladder

Track last interaction via throttled `pointerdown` / `keydown` / `scroll`. Step
the interval 30s -> 2m -> 10m after 5 and 30 minutes idle; reset on any
interaction or focus. Covers the visible-but-abandoned tab.

Note: likely removed in Phase 15 once polling goes away. ~20 lines, accepted.

### C3 - Web Locks leader election + BroadcastChannel fan-out

One tab per browser polls; the rest receive results.

- Election via `navigator.locks.request('hl-notif-leader', { mode: 'exclusive' },
  ...)`, holding the lock by never resolving the callback's promise. The browser
  releases it automatically when the tab dies, CRASH INCLUDED, so takeover needs
  no heartbeat and has no staleness window. A waiting tab's pending request
  resolves and it becomes leader.
- Fan out poll results over `BroadcastChannel`.
- Followers report their visibility over the channel so the leader applies the
  C1/C2 rules across all tabs: when every tab is hidden, nobody polls.

Known limits (accepted): same-origin and same-browser-profile only, so two
browsers or a normal plus incognito window still poll separately, and it does
nothing across devices. Split-brain is impossible while the lock is held.

Structure the election behind an injectable interface so the logic is testable
without Web Locks. See Testing.

## Testing

### Backend

Host-only (`npm test --workspace backend`). Baseline is 200/200.

NOTE: `checkSchedulerHealth`, `isSchedulerDown` and `SchedulerState` currently
have ZERO coverage - the watchdog is untested today. Write these BEFORE changing
behavior, so the refactor is guarded:

- watchdog: never-ticked -> no alert; fresh -> no alert and no DB call; stale ->
  alert once; a second stale call inside the cooldown -> no second alert
- `computeNextWakeAt`: each source in isolation (reminder / goal / template /
  task-recurrence), the minimum across sources, empty DB -> ceiling, and both
  clamp bounds
- overdue invariant: returns 0 after a successful pass; returns non-zero and
  alerts when a template throws inside the per-template catch
- lateness: alert fires past threshold, stays silent under it
- S4a: reminder dispatch reaches a user who is NOT polling; the `emailSentAt`
  claim prevents a double-send across two passes
- S5: memoized counts return the cached value inside the window and are
  invalidated by mark-read / mark-unread

### Frontend

There are currently ZERO frontend tests and no harness - flagged in
`docs/architecture-audit.md`. This phase stands one up, because C1/C2/C3 are all
frontend and shipping them unverified would repeat the test-discipline slip this
project already course-corrected on.

**Tier 1 - harness (new, permanent asset).** Vitest + React Testing Library +
jsdom in `frontend/`. Config, a `test` script, and one smoke test. Reusable by
every later phase; Phase 15 assumes it exists.

**Tier 2 - what jsdom covers properly.** All of the following are real tests, not
placeholders:

- C1: mock `document.visibilityState` and dispatch `visibilitychange`; assert no
  fetch while hidden, and exactly one immediate refresh on becoming visible
- C2: fake timers plus synthetic `pointerdown` / `keydown` / `scroll`; assert the
  30s -> 2m -> 10m progression, and that any interaction or `focus` resets to 30s
- C3 election logic, against a FAKE lock manager and FAKE channel injected
  through the interface: exactly one leader among N participants; on lock release
  a waiter is promoted; a follower never fetches; the leader's result reaches
  followers over the channel; followers' visibility reports are aggregated so the
  leader idles only when every tab is hidden
- `NotificationContext` integration with a mocked api client: unread counts
  render, `refresh()` after mark-read re-fetches, poll failures are swallowed
  without breaking the provider

**Tier 3 - what jsdom CANNOT cover.** jsdom has no Web Locks implementation, so a
jsdom test of C3 exercises the fake, not the browser. Real lock release on tab
death and real cross-document `BroadcastChannel` delivery need Playwright with
multiple pages. Playwright is deliberately NOT added in this phase (new
dependency, new runner, and there is no CI to host it). Covered instead by a
manual checklist, to be run in Docker and recorded in the PR:

1. Open two tabs. Network panel shows exactly ONE polling tab.
2. Close the leader tab gracefully. A survivor takes over within seconds.
3. Kill the leader tab via Task Manager (simulating a crash, no `pagehide`).
   A survivor still takes over - this is the property Web Locks buys and the one
   a heartbeat implementation would get wrong.
4. Background every tab. Polling stops entirely.
5. Foreground one tab. Exactly one immediate refresh, then polling resumes.

If you would rather have Tier 3 automated, adding Playwright is roughly a day and
should be its own decision.

### Also required per repo convention

`tsc` clean on both packages, frontend build clean, and a Docker walkthrough.

## Rollout

Land in TWO PRs. Nearly all the value - both the ~$900/year and the reliability
fix - is in the first one, and it carries no frontend risk. See the note at the
end of Observed baseline for why the client-side work buys nothing measurable
until usage arrives.

- **PR 1 (value):** S1, S3, S4, S4a, S4b + their backend tests.
- **PR 2 (future-proofing):** S2, S5, C1, C2, C3 + the Vitest harness.

1. Do N1-N3 in the Neon dashboard first (N1 is already answered: 5-minute
   scale-to-zero on the Launch plan).
2. Branch off `staging`; land as a PR against `staging`.
3. Push to staging (auto-deploys). Confirm `ENDPOINT INACTIVE` finally appears on
   the staging branch's Neon chart - that is the acceptance signal for S3.
4. Watch for a day, checking for late-fire and overdue-invariant alerts.
5. Promote by ff-only merge to `main` per the established flow.
6. Re-read the prod Neon chart after 48h. THAT reading is the input to the
   Phase 15 go/no-go decision.

## Risks

- S4 is the only item that can fail non-obviously. Mitigated by the four layers
  in S4b; worst case is work up to 6h late against a lead window measured in
  days, accompanied by an admin email.
- S4a changes who triggers reminder emails. If the claim logic is wrong the
  failure mode is a double-send - visible and harmless - not a silent miss.
- C3's election LOGIC is unit-tested (Tier 2), but real browser lock semantics
  are not (Tier 3 - jsdom has no Web Locks). Mitigated by the manual checklist,
  and by the fact that a total C3 failure degrades to today's behavior: every tab
  polls, nothing breaks.
- Standing up the Vitest harness is new surface for this phase. Kept small on
  purpose: config plus the tests listed above, no broader backfill.
- Expectation to set: while any tab is open, the frontend poll keeps Neon awake
  regardless. This phase pays off at night, on weekends, and on staging. Closing
  the business-hours gap is Phase 15.
