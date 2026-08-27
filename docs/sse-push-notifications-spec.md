# Phase 15 - SSE Push Notifications

Status: SPEC (blocked - see Entry Criteria)
Depends on: Phase 14 (`docs/neon-cost-reduction-spec.md`)

## Why this phase exists

Phase 14 gets the scheduler down to ~4-6 database wakes per day, but while any
user has a browser tab open the 30s poll keeps the Neon compute awake regardless.
Polling is the last thing standing between the app and an idle database during
business hours.

A held-open `EventSource` costs one idle HTTP connection and ZERO database
queries while nothing happens. It is the only option that takes query volume to
zero with tabs open. Secondary wins: notifications appear instantly instead of up
to 30s late, and reminder latency stops being bounded by a poll interval.

The comment at the top of `frontend/src/notifications/NotificationContext.tsx`
records that polling was the deliberate original choice and that websockets were
the named future upgrade. This is that upgrade.

## Entry criteria - do not start until all are true

**UPDATE 2026-08-27: the cost justification for this phase has evaporated for
now.** Prod currently has near-zero user activity, so there is no business-hours
polling to eliminate - the entire 97.8%-awake figure is the scheduler, which
Phase 14 addresses on its own. Measured against today's usage, SSE would save
approximately nothing.

What survives is the UX case: instant notifications instead of up-to-30s-late
ones, and reminder latency no longer bounded by a poll interval. Both are real,
neither is urgent at current usage. Revisit when criterion 1 below is true.

1. **There is meaningful concurrent user load** - enough people with tabs open
   that polling measurably keeps the compute awake after Phase 14 ships. This is
   now the gating criterion, not a formality.
2. Phase 14 is merged to `main` and has run in prod for at least 48h, and the
   prod Neon chart has been re-read with the remaining awake time attributed.
3. The auth-transport decision below is resolved by a spike.
4. Render proxy behavior for streaming responses is verified.

## The blocking design decision: auth transport

`EventSource` cannot send request headers. The app authenticates entirely with a
Bearer token from `localStorage` (`frontend/src/api/client.ts`,
`backend/src/middleware/auth.ts`). Three options, none free:

**A. Token in the query string.** REJECTED. Puts the JWT into Render access logs
and browser history. Not acceptable regardless of convenience.

**B. Cookie auth for the stream endpoint.** Requires introducing cookie auth
alongside the existing JWT, with CSRF handling, plus `SameSite` and CORS
configuration - `hlcentral` (static) and `hlcentral-api` are separate Render
services on different origins, so this is a cross-site cookie. Largest blast
radius, but keeps the native `EventSource` client with its built-in reconnection
and `Last-Event-ID` resumption.

**C. `fetch()` + `ReadableStream` instead of `EventSource`.** Headers work
normally, so the existing Bearer auth is untouched - by far the smaller auth
risk. The cost is that you hand-roll the SSE client: wire-format parsing,
reconnect with backoff, and `Last-Event-ID` resumption, all of which
`EventSource` provides for free.

**DECIDED 2026-08-27: C.** Keeping the auth model untouched is worth ~100 lines of
client code; B would put every user's login at risk to save them. The spike is no
longer about choosing - it is about prototyping the RECONNECT path, which is where
C's real cost lives (backoff, `Last-Event-ID` resumption, and not hammering the
server during an outage).

## The second blocker: the sliding session

`requireAuth` re-issues a token in the `X-Refreshed-Token` response header on
EVERY authenticated request, and the client stores it (`client.ts`). A long-lived
stream emits ONE set of response headers at connect and never again.

So under SSE a user actively watching a live-updating page would silently idle
out and be expired by the 10s expiry check in `frontend/src/auth/AuthContext.tsx`
- exactly inverting the documented intent that continuous use never expires.

**The 30s poll is currently doing double duty as the session keepalive.** Removing
it forces a sliding-session redesign. Options to evaluate:

- emit periodic `token-refresh` events over the stream carrying a fresh JWT
- keep a separate low-frequency renew ping purely for session extension
- treat an open stream as implicit activity and extend server-side

**DECIDED 2026-08-27: the renew ping, fired ON INTERACTION.**

Both environments run `JWT_EXPIRES_IN: 8h`, which makes this cheap. A renewal at
most every ~4h is a handful of requests per day, and the compute still sleeps
between them. (Note each one IS a database query: `requireAuth` does a
`user.findUnique` for the `isActive`/`tokenVersion` revocation check. That is why
the interval matters, and why a 5-minute ping - the original sketch above - would
have quietly undone Phase 14.)

Renew on INTERACTION, not on the connection. This is the part that is a product
decision rather than a technical one: a held stream persists whether or not anyone
is at the keyboard, so renewing on the connection would mean sessions never expire
while a tab is open - an unattended laptop stays logged in indefinitely. For an
app with task-level access control that is a real change in security posture.
Renewing on interaction keeps "idle" meaning exactly what it means today, at a
fraction of the request rate.

Implementation note: PR 2 already tracks last-interaction time for the C2 idle
ladder (`lastActivityRef` in `NotificationContext`), and it is already shared
across tabs via the throttled `activity` broadcast. The renewal timer should reuse
that signal rather than growing its own. A dedicated `/api/auth/renew` endpoint
that does nothing but let `requireAuth` re-issue the header is the cheapest shape.

## Server-side work

### An event bus that does not exist yet

Today the database IS the notification bus: a `Notification` row is written and
clients discover it by polling. Push requires:

- an in-process emitter (`EventEmitter` or similar) with a per-user subscriber
  registry
- every mutation path that currently creates a notification publishing to it:
  comment mentions, assignment changes, reminder firing, scheduler
  materialization, goal state transitions
- careful subscriber cleanup on disconnect - a leaked registry entry is a memory
  leak that grows with every reconnect

This is a new cross-cutting layer through most of `backend/src/services/`.

### Multi-instance constraint

Held connections pin to one instance. One instance today makes this a non-issue
in steady state, EXCEPT that Render's zero-downtime deploys briefly run two, so a
mutation on the new instance cannot reach a subscriber on the old one. Acceptable
for a deploy window; not acceptable if you ever scale.

If scaling is on the roadmap, the fix is Postgres `LISTEN/NOTIFY` or Redis
pub/sub. Note the trap: `LISTEN/NOTIFY` needs a dedicated long-lived connection
outside Prisma's pool, which itself holds the Neon compute awake and partly
defeats the purpose of this phase. Redis would avoid that but adds a service.

Decision for the spec: build single-instance, document the constraint, and do not
scale `hlcentral-api` past one instance without revisiting this.

### Infrastructure spike

- Confirm Render's proxy does not buffer streaming responses.
- Confirm the idle timeout is long enough to hold a connection, and add periodic
  SSE comment frames (`: keepalive`) so intermediaries do not reap the stream.
- Decide connection limits per user and overall.

## Frontend work

**Reuses Phase 14's C3 directly.** You want one stream per BROWSER, not per tab.
The Web Locks leader holds the `EventSource` / `fetch` stream and fans events out
over `BroadcastChannel` - identical machinery to C3, different payload source.
This is why C3 is built first.

C1 (Page Visibility) still applies: drop the stream when every tab is hidden,
reconnect on re-show.

**C2 (idle backoff) becomes obsolete** and should be deleted in this phase.

Keep the polling path behind a feature flag as a fallback for the first release,
so a stream failure degrades to today's behavior rather than to a dead bell.

## Testing

The existing suite is request/response integration against real Postgres
(`backend/test/integration.test.ts`). Streaming needs a different harness:

- connect, assert on a received chunk, disconnect, assert registry cleanup
- subscriber-leak test: N connect/disconnect cycles leave the registry at zero
- auth: an unauthenticated stream request is rejected; a revoked token
  (`tokenVersion` bump) terminates an open stream
- session: a client on an open stream does not idle out
- fan-out: a mutation by user A produces an event for subscriber B and NOT for
  user C, respecting the same access gate as `listDueReminders`

Frontend: the Vitest + RTL harness from Phase 14 already exists, so stream
handling is tested there rather than only by hand:

- the leader opens exactly one stream; followers open none
- an event received by the leader is fanned out to followers over the channel
- stream drop triggers reconnect with backoff, and the feature-flag fallback
  restores polling when the stream cannot be established
- a `token-refresh` event (if that is the sliding-session option chosen) updates
  the stored token

Real cross-document behavior remains Tier 3 - extend the Phase 14 manual
checklist with: leader holds the only EventSource, kill the leader tab, confirm a
survivor re-establishes the stream. If Playwright was added by then, automate it.

## Rollout

1. Spike the auth transport decision; write the outcome back into this doc.
2. Spike Render proxy behavior.
3. Build behind a feature flag, polling retained as fallback.
4. Staging with the flag on; verify the Neon chart shows suspend WITH a tab open
   - that is the acceptance signal for this whole phase.
5. Prod with the flag off, then enable for a subset, then all.
6. Remove the polling path and C2 in a follow-up once the flag has been on in
   prod without incident.

## Open questions to resolve before build

- ~~Auth transport: B or C?~~ **DECIDED: C** (`fetch` + `ReadableStream`).
- ~~Sliding session mechanism?~~ **DECIDED: renew ping, fired on interaction**,
  reusing PR 2's existing last-interaction signal.
- Is multi-instance on the roadmap within a year? If yes, the pub/sub question
  moves from deferred to in-scope.
- Does reminder delivery still need email at all once in-app push is instant, or
  does email become opt-in for offline users only?
