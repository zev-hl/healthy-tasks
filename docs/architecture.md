# HL Central — Architecture

_Running architecture document. First created in Phase 12; it captures the
application as it stands through Phase 11 and documents the Phase 12 SMART Goals
feature added on top. Keep it current as later phases land._

---

## 1. What the app is

HL Central is an internal task-management application for a warehouse/operations
team. It provides task CRUD with hierarchy and dependencies, rich-text content and
attachments, an audit trail, search/dashboards, notifications, three schedule
views (Kanban/Calendar/Gantt), reusable task templates with recurring tasks, and —
new in Phase 12 — SMART goal-setting and review.

Users have one of three roles (`Admin`, `Manager`, `Member`) and an optional
**supervisor** (a self-referential `User.supervisorId`, which must point at a
Manager or Admin). The supervisor relationship powers team views and, in Phase 12,
goal approval and visibility.

## 2. Tech stack & repository layout

- **Monorepo** (npm workspaces): `backend`, `frontend`, `packages/shared`.
- **Backend**: Node + Express + TypeScript (ESM), Prisma ORM over PostgreSQL.
  Object storage (attachments) via an S3-compatible driver (MinIO in dev; an
  in-memory fake under tests). JWT auth. Email through a BullMQ queue in Redis
  (Valkey), sent by an email worker that runs inside the API process (§14).
- **Frontend**: React + Vite + TypeScript, React Router **data router**
  (`createBrowserRouter`, so screens can use `useBlocker` for unsaved-changes
  guards), TipTap rich-text editor.
- **`packages/shared`**: the single source of truth for DTOs, enums, and small
  pure helpers shared by both sides. It has **no runtime dependencies** so it is
  safe to import from Node and the browser. The Prisma enums mirror the string
  unions declared here.

```
backend/
  prisma/schema.prisma        # data model (one file)
  prisma/migrations/          # SQL migrations, applied via `prisma migrate deploy`
  src/
    routes/                   # express routers (thin)
    controllers/              # request/response glue (thin; `satisfies Dto`)
    services/                 # business logic + Prisma access + *.mapper.ts
    middleware/               # auth, validation, error handler
    validation/schemas.ts     # all zod schemas + inferred input types
    utils/                    # HttpError, jwt, password, mailer, account-emails, async-handler…
    queue/                    # email queue: Redis connections, jobs, email worker, processor, failed-email recorder, maintenance, dashboard board (§14)
    worker.ts                 # the email worker as a process of its own, when not run inside the API (§14)
    queue-dashboard.ts        # local queue dashboard container, Bull Board (§14)
  scripts/                    # one-off commands (queue:test-email, queue:clean-failed-emails)
  test/integration.test.ts    # the whole integration suite (node:test + supertest)
  test/unit/                  # unit tests (no database)
frontend/
  src/
    pages/                    # one component per screen
    components/               # shared UI (+ components/ui for primitives)
    api/client.ts             # typed API client (`api.*`)
    styles.css                # the Phase 9 design system
packages/shared/src/index.ts  # shared DTOs/enums/helpers
docs/                         # this doc + the Phase 9/10 design handoff
```

## 3. Runtime topology (dev)

`docker compose up` starts: **frontend** (Vite :5173), **backend** (Express :4000),
**Postgres** (:5432), **MinIO** (:9000 API / :9001 console), **Redis** (Valkey,
:6379, this computer only) and the **queue dashboard** (:3005, this computer
only). The backend applies migrations on start and runs the background
scheduler (§8) and the email worker (§14). Attachments upload directly to MinIO
via pre-signed URLs; only metadata passes through the API. Emails go from the
backend to Redis and are sent by the email worker inside the backend (§14).

## 4. Cross-cutting conventions

### Vertical-slice pattern

Every feature is built the same way, which keeps the codebase predictable:

1. **Prisma model + migration** in `schema.prisma` / `prisma/migrations`.
2. **Shared DTOs/enums** in `packages/shared/src/index.ts` (string-union enums with
   a `*_LABELS` map for display).
3. **Zod schema** in `backend/src/validation/schemas.ts`, exporting the inferred
   `*Input` type.
4. **Mapper** (`*.mapper.ts`): a Prisma `include`/`select` const + a `toDto`
   function that converts a row (with joined refs) to its DTO. Dates → ISO strings.
5. **Service** (`*.service.ts`): the business logic. Throws `HttpError`, uses
   `$transaction` where multiple writes must be atomic, and **re-checks
   authorization in the service** (not only at the route) so it is the single
   source of truth.
6. **Controller**: thin; pulls the actor from `req.user`, calls the service, and
   returns `result satisfies Dto`.
7. **Router**: mounts the controller; literal paths precede `/:id`; role guards via
   `requireRole(...)`.
8. **Client method** in `frontend/src/api/client.ts` (`api.*`).
9. **Tests** in `backend/test/integration.test.ts`.

### Auth & sessions

- Stateless **JWT** (`Authorization: Bearer`). `requireAuth` verifies the token,
  confirms the user still exists/is active, and checks `token.tv === user.tokenVersion`.
  Bumping `tokenVersion` (on deactivation or password reset) instantly revokes all
  outstanding tokens.
- **Sliding session**: every authenticated response re-issues a fresh token in the
  `X-Refreshed-Token` header, so the idle window is measured from the last request.
- `requireRole(...roles)` gates a route to a set of roles; per-record authorization
  (e.g. "the goal's supervisor") lives in the service.
- **Two ways in, decided by the address** (`utils/allowed-domain.ts`). With
  `GOOGLE_ALLOWED_DOMAIN` set, a company address (`isCompanyAccount`) signs in with
  Google only — the password form refuses it — and any other address with a password
  only — the Google door refuses it. `signInMethodFor(email)` (company address *and*
  Google sign-in configured → `google`, else `password`) decides which welcome a new
  account gets and what an address change tells the person. A Google sign-in is matched
  by Google's id (`User.googleSub`) first, then by email, and links the account on the
  first sign-in.
- **Changing someone's sign-in address** (an Admin's `PATCH /api/users/:id`;
  `updateUser` + `tellAboutEmailChange` in `users.controller.ts`). Only a real change
  counts (the address is trimmed and lowercased first). In the same write: the
  person is signed out everywhere (`tokenVersion` bumped, as for a password reset:
  the old mailbox is told of the change, so a session there must not carry on), the old
  Google link is cleared (`googleSub = null`, so the new address can link its own Google
  account — a different one was otherwise refused for good), unused reset links are
  retired (one sent to the old mailbox must not open the account), and moving from a
  password onto Google replaces the password with an unusable one (so it cannot come
  back if the address is switched back). Then **both addresses are emailed**, through
  the queue (§14): `email-changed` to the new one with how to sign in now — Google, the
  same password, or, when moving off Google, a set-password link — and
  `email-change-notice` to the old one, with no links. An inactive account (or one
  deactivated in the same save) is emailed too: the new address is told the account is
  inactive until reactivated, and gets no link, since a reset is refused while inactive
  ("Forgot password" once reactivated). The reply is the saved `UserDto` plus
  `emailChange` (`EmailChangeSummary`: from, to, sign-in method, `inactive`, and the
  set-password link when one was made), which the Users page turns into its saved
  message and "Reset link" banner.

### Errors & validation

- `HttpError` (`utils/http-error.ts`) carries a status + message (+ optional
  `details`); a central error-handler middleware serializes it to
  `{ error, details? }`. Helpers: `badRequest/unauthorized/forbidden/notFound/conflict`.
- `validateBody(schema)` runs a zod schema before the controller; field errors come
  back as `400 { error, details }`.

### Change history

Task edits are captured by a single helper (`task-history.service.ts` →
`recordHistory`) called from every task-mutating path, writing append-only
`TaskHistory` rows. The set of known `field` keys lives in `TASK_HISTORY_FIELDS`
in shared. History is **never silently rewritten** — a guiding principle the app
applies elsewhere too (e.g. resolved goals, completed template occurrences).

### Testing

One integration suite (`backend/test/integration.test.ts`) runs against a real,
throwaway Postgres (`embedded-postgres`, no Docker needed) with the **actual
migrations** applied via `prisma migrate deploy`, exercised through the HTTP layer
with `supertest`. `beforeEach` truncates and reseeds an admin. The background
scheduler is never started under tests; tests import and call `runScheduler(now)`
directly for deterministic time control.

## 5. Data model overview (through Phase 11)

All models live in `backend/prisma/schema.prisma`. Highlights:

- **User** — identity, role, `supervisorId` (self-relation "Supervision"), account
  merge (`mergedIntoId`), `tokenVersion` for revocation.
- **Task** — sequential integer id; creator/assignee; priority/status;
  `statusChangedAt`; tags; start/due; **Parent/Child** self-relation
  ("TaskHierarchy"); **Dependencies** (`TaskDependency`, blocker→blocked);
  Phase 10 **review** fields (`reviewInitiatorId`, `priorAssigneeId`, `priorStatus`);
  Phase 11 **template provenance** (`templateId`, `templateNodeId`,
  `templateOccurrenceId`, `instanceLabel`) and **task-level recurrence**
  (`TaskRecurrence`, `recurrenceSourceId`/`recurrenceSeq`); HLAI-118 **special
  attributes** (`alertGroupId` → `AlertGroup`, `alertType`; see §15).
- **Attachment / Comment / CommentMention / MentionEvent** — Phase 4 rich content;
  attachments reference exactly one of task/comment; comments carry sanitized HTML
  and @mentions.
- **TaskHistory** — append-only audit entries (Phase 5).
- **UserScreenPref** — per-user, per-screen opaque JSON UI state (Phase 6).
- **Notification / Reminder / NotificationPreference** — Phase 8 inbox
  (mentioned/assigned), time-conditional reminders, and per-list opt-ins.
- **TaskTemplate / TaskTemplateNode / TaskTemplateDependency / TemplateOccurrence**
  — Phase 11 reusable definition trees, their between-node dependencies, and a
  record of each materialized instantiation (origin `manual`, `scheduled`, or
  HLAI-112's `alert`; a scheduled fire carries its people forward from the latest
  manual or scheduled one, never from one made from alerts).
- **SchedulerState** — singleton health row for the recurrence scheduler watchdog.
- **Goal** — Phase 12 (see §7).

## 6. Feature areas by phase (1–11)

- **1 Foundation** — users, auth, password reset, role/supervisor rules.
- **2 Tasks** — task CRUD.
- **3 Hierarchy & dependencies** — Parent/Child + blocker/blocked edges, with
  application-layer cycle prevention (advisory lock for concurrent edits). The
  **blocked-status rule**: a task with an incomplete predecessor may not move to
  `Review`/`Completed`; the error names the blocking task(s).
- **4 Rich content** — sanitized rich-text descriptions/comments, @mentions,
  attachments via pre-signed S3 URLs. Tables too (HLAI-112): the editor's Table
  menu inserts one with a header row and adds or deletes rows and columns; the
  server and the display keep table, thead, tbody, tr, th, td, a cell only its
  colspan/rowspan (1–99); shown as a plain bordered grid, scrolling sideways when
  wider than the box.
- **5 History & account maintenance** — the change-history trail; admin user edit;
  account merge.
- **6 Search** — the Task Search screen: text search, multi-select filters,
  multi-sort, pagination, saved per-user screen prefs, xlsx export.
- **7 Dashboard** — filtered counts (by status, overdue, completed-today,
  parent/child buckets), driven by the same filters as search.
- **8 Notifications** — Mentioned / Assigned lists, per-user reminders (with a
  polling heartbeat + optional email), and per-list preferences.
- **9 Visual design** — the Phase 9 design system in `styles.css` (warm canvas +
  teal accent, three fonts, left-rail shell, avatars, status/priority indicators,
  empty states, reduced-motion/focus accessibility). Documented under `docs/design/`.
- **10 Views & review** — Kanban / Calendar / Gantt as view toggles on the Search
  screen (no new libraries). A **Review workflow**: sending a task to Review makes
  the reviewer the temporary assignee and records prior assignee/status; **Reviewed**
  and **Recall** restore them. Reviewed may be triggered by an Admin, the current
  assignee, or a supervisor at any level up the assignee's chain. Gantt drag date
  edits **coalesce** repeated History entries within a 60-second window.
- **11 Templates & recurring tasks** — Admin/Manager-managed template trees with
  free-text role placeholders resolved to users at instantiation; two recurrence
  flavours (`Fixed` calendar cadence, `RelativeToCompletion`); computed "ghost"
  previews for Gantt/Calendar; a background scheduler that materializes due
  occurrences within a lead-time window; task duplication. Regular tasks can also
  be made recurring directly.

## 7. Phase 12 — SMART Goals

A **Goal** belongs to an employee and is **independent of the Task system** in this
phase (no linkage between goals and tasks). Either the employee or their supervisor
may draft a goal for the employee, but the supervisor must always approve it before
it becomes active.

### Data model (`Goal`)

SMART fields:

- **Specific** (`specific`) — what will be achieved (free text).
- **Measurable** — `metricType` (`Count | Percentage | Frequency | Currency |
  Other`) + `targetValue`, plus a free-text `unitLabel` (required for `Other`).
- **Time-bound** — `deadline`. In this phase the deadline alone is the review
  period; there is no separate review-cycle entity.
- **Risks / Mitigations / Notes** — free text; notes editable throughout the
  goal's life (until Resolved).
- **Results** — `resultValue` (same metric/unit as the target), entered by the
  employee while the goal is Active; `resultsFinalizedAt` stamps an early finalize.
- **Resolution** — `resolution` (`Exceeded | Met | PartiallyMet | Missed |
  InProgress`) + `supervisorComments`, set by the supervisor at review.
- **Audit** — `createdById`, workflow stamps (`submittedAt`, `approvedAt`/`approvedById`,
  `underReviewAt`, `resolvedAt`/`resolvedById`), `rejectionComments`, `createdAt`,
  `updatedAt`.

`ownerId` (Cascade) and `createdById` are required; `approvedById`/`resolvedById`
are `SetNull` so a deactivated supervisor never blocks reads.

### Lifecycle (status machine)

```
        submit                approve                 finalize / deadline passes
Draft ─────────► PendingApproval ─────────► Approved ─────────────────────────► UnderReview
  ▲                    │  reject (comments)     (Active)                              │  resolve
  └────────────────────┘                                                             ▼
                                                                                  Resolved  (terminal)
```

- **Draft** — editable by its creator or the owner (plus Admin). Fields freely
  editable; `Other` metric requires a unit label before submit.
- **PendingApproval** — submitted; awaiting the supervisor.
- **Approved (Active)** — the employee updates Results/Notes/Risks/Mitigations.
- **UnderReview** — entered automatically when the deadline passes **or** immediately
  when the employee marks Results final — **whichever comes first**. (Once it leaves
  `Approved`, the other trigger is a no-op.)
- **Resolved** — the supervisor set Resolution + Comments. **Terminal**: no further
  edits are accepted (a correction would be a deliberate one-off, not a silent
  rewrite), consistent with how history is treated elsewhere.
- **Reject** — from PendingApproval back to Draft, with **required** comments that
  stay visible on the draft so the employee can address them and resubmit.

### Authorization & visibility

Enforced in `goal.service.ts` (route guards are a coarse first gate):

- **Owner** sees and manages their own goal (draft edits, submit, results, finalize).
- **Supervisor** = the owner's **direct** supervisor (`owner.supervisorId === actor.id`).
  Only the supervisor (or an Admin) may **approve / reject / resolve**. A Manager who
  is not this owner's supervisor is rejected.
- **Admin** has full visibility and supervisor authority across all goals.
- **Team Goals** scopes to the supervisor's **entire downline** (any depth; Admin:
  all users) as of Phase 13 — see §10. A supervisor can never widen the `ownerIds`
  filter past that downline. **Approve / reject / resolve stay restricted to the
  owner's DIRECT supervisor** — broadened visibility does not broaden that authority.

### Endpoints (`/api/goals`, all require auth)

| Method & path | Purpose | Who |
| --- | --- | --- |
| `GET /mine` | the caller's own goals | any |
| `POST /team` | filtered team goals (`ownerIds`, `statuses`, deadline range) | Admin/Manager |
| `POST /` | draft a goal (`ownerId` defaults to caller; a supervisor may target a report) | any |
| `GET /:id` | one goal (owner/supervisor/admin) | scoped |
| `PATCH /:id` | edit a Draft's SMART fields | creator/owner/admin |
| `DELETE /:id` | delete a Draft | creator/owner/admin |
| `PATCH /:id/progress` | update Results/Notes/Risks/Mitigations while Active | owner/admin |
| `POST /:id/submit` | Draft → PendingApproval | creator/owner/admin |
| `POST /:id/approve` | PendingApproval → Approved | supervisor/admin |
| `POST /:id/reject` | PendingApproval → Draft (comments required) | supervisor/admin |
| `POST /:id/finalize` | Approved → UnderReview (mark results final) | owner/admin |
| `POST /:id/resolve` | UnderReview → Resolved (resolution + comments) | supervisor/admin |

### Scheduler integration

`runGoalReviewPass(now)` moves every `Approved` goal whose `deadline <= now` to
`UnderReview` (stamping `underReviewAt`). It runs on each scheduler tick alongside
the recurrence passes (§8), and is callable directly in tests. Because a
finalize-first goal is no longer `Approved`, the deadline pass never double-fires.

### Frontend

Two screens (`pages/MyGoalsPage.tsx`, `pages/TeamGoalsPage.tsx`) plus shared
components under `components/goals/` (`GoalCard`, `GoalEditorModal`,
`GoalDetailModal`, `goalUi`). Team Goals uses the Phase 6 filter conventions
(`FilterPopover` + `MultiSelect`, removable chips, date-range). All styling uses the
Phase 9 design tokens (`styles.css`, "SMART Goals" block).

**Out of scope this phase:** any Goal↔Task linkage; review-cycle entities;
notifications for goal approval/rejection/resolution; warehouse integration.

## 8. Background scheduler & watchdog

A single `setInterval` timer (started from `server.ts`, never under tests) runs
`runScheduler(now)` each minute. One pass:

1. Materializes due **template** occurrences (Fixed + RelativeToCompletion) within
   their lead-time window.
2. Materializes due **task-level** recurrences.
3. Runs the **goal review pass** (§7).
4. Stamps `SchedulerState.lastTickAt`.

Double-firing is prevented by unique claims — `(templateId, seq)` for template
occurrences and `(recurrenceSourceId, recurrenceSeq)` for task recurrences — so a
click-through and a scheduler tick racing on the same occurrence still produce
exactly one real task.

**Watchdog**: the notifications heartbeat (polled by every client) calls
`checkSchedulerHealth`; if `lastTickAt` has gone stale it emails all admins once per
outage (claim-before-send + cooldown). A `schedulerDown` flag on the heartbeat
drives a global "contact an admin" banner for every user.

## 9. Migrations & deployment notes

- Migrations are plain SQL under `prisma/migrations`, applied with
  `prisma migrate deploy` (tests and Docker startup both use this). `schema.prisma`
  and the migration SQL must independently produce the same shape; keep them in
  sync (`prisma migrate dev` should report "in sync" with no pending drift).
- After editing `packages/shared`, rebuild it (and rebuild Docker images, which
  bake it in) so runtime enum/const exports update, not just types.
- Phase 12 ships one additive migration (`..._phase12_smart_goals`: the three Goal
  enums + the `Goal` table) and reconciles a small pre-existing index drift on
  `Task` (two Phase 10 FK indexes that existed in every database but were not
  declared in `schema.prisma`) — no runtime change.
- Phase 13 ships one additive migration (`..._phase13_access_control`: the
  `Task.isPrivate` boolean, default `false`).

## 10. Task-Level Access Control (Phase 13)

The single, shared authority for **who can see / edit / assign / mention / review**
which task. It lives in `backend/src/services/access-control.service.ts` and is
consumed by every task surface (Search, Kanban, Gantt, Calendar, Task Detail,
Comments, the Review workflow, Goals, and the Due Date Performance Report). Nothing
is cached: every decision is recomputed live from the **current** Assignee, the
**current** org chart (`User.supervisorId`), the task's **current** comment mentions,
and the Private flag — so access follows reorganisations and edits immediately.

### Access levels for one task

- **Full (see + edit)** — Admin, the current Assignee, or **any** supervisor above
  the Assignee in the chain (`isInSupervisorChain`). Equivalently: the Assignee is
  in the actor's *downline-or-self* set.
- **Comment-only (see + comment)** — a user currently `@mentioned` in a non-private
  comment. They may add comments and edit their own, but cannot change any other
  field. Live: dropping the mention (editing it out of the only comment granting it)
  removes access with no reload.
- **Tree (see, read-only)** — visibility inherited via Parent/Child tree position
  (see *Tree inheritance* below). Read-only: no field edits, no commenting.
- **None** — everyone else. The API returns **404** (never 403) for a hidden task,
  so its existence isn't leaked.

`computeTaskAccess(actor, {id, assigneeId, isPrivate})` returns `'full' | 'comment' |
'tree' | null`. `TaskDetailDto` carries the caller's `access` level and a
`canTogglePrivate` flag; `TaskRowDto` carries `mentionOnly` and `treeOnly` flags
(distinct read-only cues + disabled drag in the multi-task views).

### Tree inheritance (Parent/Child, read-only)

Bidirectional, read-only visibility across the Parent/Child hierarchy, on top of the
per-task model above:

- **Downward** — full access to a task grants read-only visibility into all of its
  descendants (any depth).
- **Upward** — access to a task (from *any* source, including inherited) grants
  read-only visibility into its ancestors.
- **Private overrides inheritance** — a Private task is never exposed via tree
  inheritance; only {Admin, Assignee, Assignee's chain} ever see it. (A Private node
  is omitted individually but does not hide its own non-private descendants.)

Inheritance never affects who can be *assigned*, and does not apply to the separate
Dependency (Blocks/Is-Blocked-By) graph. It has no effect on **blocked-status
enforcement**: `assertStatusAllowedByPredecessors` always evaluates a predecessor's
real, current status regardless of whether the actor can see it — only the *message*
hides an unseen blocker's name.

### List scoping

`getTaskAccessScope(actor)` computes, in a few tree walks (recursive CTEs), the
actor's `fullTaskIds` (F), `mentionIds` (M, non-private), and `treeIds`
(descendants of F ∪ ancestors of F∪M∪descendants, all non-private). Multi-task
queries AND `buildTaskAccessWhere` into the WHERE: `assigneeId IN (actor + downline)`
OR (when the `includeReadOnly` toggle is on) `id IN (mentionIds ∪ treeIds)`. Admins
are unrestricted. The same scope classifies each row (`classifyRow` → mentionOnly /
treeOnly) and drives the report + relationship-picker search.

### Referencing tasks with limited visibility

- **Degraded references** — wherever a task reference appears (Parent/Child,
  Blocks/Is-Blocked-By, History entries), a reference to a task the user cannot
  currently see shows as **Id + lock + Status only** — no name (blanked
  server-side, never leaked), not hyperlinked. `TaskRef.accessible` carries this;
  it reflects **live** access, so it updates as visibility changes. This is a
  deliberate tradeoff: a Private/inaccessible task's Id and Status leak through
  cross-references, its Name/Description/Comments do not. One treatment regardless
  of *why* the task is inaccessible.
- **Linking** — you may create a Parent/Child/Dependency link to any task you can
  currently *see* (full, mention, or tree). The relationship-picker search is
  access-scoped, so it never offers an invisible task; `assertCanLinkTo` backstops
  a hand-crafted request. **Removing** a link never requires access to the other
  side (it edits your own task).

### Assignment restriction (who may be set as Assignee)

Enforced at creation and every reassignment (`assertAssigneeAllowed`):

- **Member** → self + immediate team (own supervisor + that supervisor's other
  direct reports / peers).
- **Manager** → the above + their entire downline (any depth).
- **Admin** → anyone.

Assignee is always required; a creator who names none defaults to themselves.

### Assignee locking

While a task's Status is `Completed` or `Canceled`, its Assignee is **frozen for
everyone, including Admin** (`updateTask`). Reopening (moving Status away from
terminal, no assignee change in the same PATCH) unlocks it. This guarantees the Due
Date report can trust "current Assignee" for terminal tasks (§11).

### Private tasks

`Task.isPrivate` may be toggled only by an Admin or someone in the Assignee's
supervisor chain — **never the Assignee themselves** (`canTogglePrivate`, dedicated
`PATCH /:id/private`). While private, visibility shrinks to {Admin, Assignee,
Assignee's chain}: mention-only access is suspended, and new `@mentions` are
restricted to that set both in the autocomplete
(`GET /:id/mention-candidates`) and server-side on comment write.

### Review workflow (two distinct checks)

- **Reviewer-selection pool** (`GET /:id/reviewer-candidates`, validated on entry to
  Review): Admin + anyone in the current Assignee's supervisor chain.
- **"Reviewed" button** (`exitReview`): Admin, the current Assignee (the reviewer),
  or a supervisor above them. These coexist and are deliberately different — the
  pool never includes the Assignee, but the button does.

### Scoped org hierarchy

`GET /api/users/hierarchy` returns the tree the caller may see/select — their own
subtree (self + downline); Admin sees everyone. Drives the report's Team Hierarchy
filter and the Team Goals downline filter.

## 11. Due Date Performance Report (Phase 13)

`POST /api/reports/due-date` (+ `/export`) — an access-scoped report that buckets
each task by comparing its Due Date to its actual completion, using **only** the
task's current Status + Status-Change Timestamp + Due Date (never past history).
Reuses the full Task Search filter set plus a **Team Hierarchy** filter (assignee
ids selected from the scoped tree, intersected with the access scope). Bucketing
(`bucketFor` in `due-date-report.service.ts`), each task in exactly one:

| Bucket | Rule |
| --- | --- |
| **On Time** | Completed, and the completion timestamp is **on or before** the Due Date (equality counts as On Time). |
| **Late** | Completed, and the completion timestamp is after the Due Date. |
| **Overdue** | Not Completed/Cancelled, has a Due Date that has already passed. |
| **Not Completed** | Not Completed/Cancelled, has a Due Date that has not yet passed. |
| **Cancelled** | Status is `Canceled` (decided by status alone). |
| **No Due Date** | No Due Date set (covers Completed-without-due and active-without-due). |

On Time / Late rows also carry a whole-day gap (`daysDelta`, positive = early). The
frontend (`DueDatePerformancePage`) reuses the Search table conventions, adds a
**Result** column and a bucket summary bar, a **Group by Assignee** toggle
(collapsible groups with per-assignee subtotal bars), and Excel export that mirrors
whichever mode is active (flat, or grouped with subtotal rows).

## 12. Follow-up: notifications, global settings, template editor & conversion

### 12.1 Manual mark-as-unread

Both `Notification` (Mentioned/Assigned) and `Reminder` rows carry a nullable
`readAt`. In addition to the one-way mark-**read** endpoints, there are now
mark-**unread** endpoints that set `readAt` back to `null`:
`POST /api/notifications/:id/unread` (`markNotificationUnread`) and
`POST /api/reminders/:id/unread` (`markReminderUnread`) — each scoped to the
caller's own rows (404 otherwise). The unread bell count (`getUnreadCounts`,
polled every 30s) counts `readAt: null` rows, so re-marking unread makes the row
count toward the badge again. In the UI each notification row shows a **Mark
read** or **Mark unread** control depending on its current state; the click
optimistically flips the row and refreshes the bell. The Notifications screen's
redundant **Settings** link (per-list preferences live on the profile) was
removed. Task Detail comments are ordered **newest-first** (`task.mapper.ts`
`orderBy: { createdAt: 'desc' }`).

### 12.2 Global materialization lead time (`AppSetting`)

The recurrence materialization lead time is a **single global, Admin-controlled
value**, no longer stored per-template or per-task. It lives on the `AppSetting`
singleton (`id = 1`, `materializeLeadDays` default 14), mirroring the
`SchedulerState` pattern. The `leadTimeDays` columns were dropped from
`TaskTemplate` and `TaskRecurrence`. Every scheduler/ghost path
(`scheduler.service`, `task-recurrence.service`, `template.service` ghosts) reads
the value once via `getMaterializeLeadDays()` and threads it into the pure
`isWithinLeadTime` / `dueFixedSeqs` functions (which now take `leadTimeDays` as an
explicit parameter rather than reading it off the recurrence config). API:
`GET /api/settings` (any authenticated user) + `PUT /api/settings` (Admin only),
surfaced on the Admin-only `/admin/settings` page.

### 12.3 Template tree editor (drag/drop + collapse)

The editor renders the node tree from each node's `parentKey` (not array order),
so **assigning a Parent immediately nests** the node under it. Sibling reordering
uses native HTML5 drag from a per-node handle; the pure helper
`moveTemplateNode(nodes, dragKey, targetKey, pos)` (in `packages/shared`) relocates
the dragged node **together with its entire subtree as one contiguous block** and
updates its `parentKey`, refusing to drop a node into its own descendants or to
move the root. Nodes can be collapsed/expanded individually plus **Collapse
all/Expand all**; collapsing is display-only (a collapsed node stays fully
draggable and moves its hidden subtree intact). Sibling order persists via each
node's `orderIndex`. Template nodes also gained a `tags` array (round-tripped
through the editor).

### 12.4 Task → Template conversion

`POST /api/tasks/:id/save-as-template` (`saveTaskAsTemplate` in `template.service`)
converts a live task — optionally its whole descendant subtree — into a new,
independent template. It is **non-destructive** (the source tasks are never
modified). Permission: **Admin/Manager AND full edit access** to the source task
(`assertTemplateManager` + `assertCanEditTask`), so a mention-only or
tree-read-only user cannot snapshot a structure they can't edit.

- **Carried over (structural only):** name, description, priority, tags, and
  dependencies whose **both** endpoints are inside the converted scope.
- **Dropped / transformed:** the assignee becomes an editable **role placeholder**
  seeded from the current assignee's name (the converting user may override the
  root's label); status, comments, history and instance labels are not carried.
- **Relative-date anchor:** the root's **Start date is Day 0** (its Due date if no
  Start; if it has neither, all template offsets are left blank). Every task's
  Start/Due becomes a whole-day offset from that anchor (`Math.round` of the ms
  delta); offsets may be negative when a descendant precedes the root anchor, so
  the node offset bound allows `[-3650, 3650]`.
- **Attachments (optional toggle):** when enabled, each source task's task-level
  attachments are **copied (not referenced)** into template-scoped storage
  (`templates/{templateId}/nodes/{nodeId}/{uuid}/{name}`) as
  `TaskTemplateNodeAttachment` defaults on the matching node. At **every**
  instantiation these defaults are copied again onto the generated real tasks
  (`tasks/{taskId}/{uuid}/{name}`), so each instance gets its own independent blob.

## 13. Department Duties

Departments own Duties, people hold Duties (`UserDuty`), tasks and template nodes
can carry a Duty, and people log minutes per Duty per day (`TimeEntry`, `TimeDay`)
for supervisors to review. New services: `department.service.ts` (catalog),
`org.service.ts` (Organization screen), `duty-check.service.ts` (the assignee ⇄
duty rule, 422 `DUTY_NOT_HELD`), `time.service.ts` (My Time + Time Review). The
rules — archive-don't-delete, the Review hand-off exemption, team-scoped Manager
edits, the Completed-day lock, automatic-creation mismatches — are specified in
`docs/department-duties-spec.md`.

## 14. Email delivery (BullMQ queue)

Every email goes through one function, `queueEmail(email, { kind, emailId? })` in
`src/queue/email-queue.ts`; nothing else calls the mailer. The callers are the
account emails (`utils/account-emails.ts`: `new-account`, `google-welcome`,
`password-reset`, and `email-changed` / `email-change-notice` when an Admin changes a
sign-in address — §4), the notification emails (`notification.service.ts`:
`mention`, `assignment`, `reminder`) and the scheduler's alerts
(`scheduler.service.ts`: `admin-alert`). Where a reply must not wait, the caller
wraps it in `sendInBackground`.

**HTML and text (HLAI-135).** Every email is HTML with a text version, both made by
`renderEmail` (`utils/email-content.ts`) from one list of blocks — paragraphs (a line
break stays one) and a button (`label`, `url`, optional `lead`): in the HTML a
table-cell button with the plain link under it, in the text the `lead` and the link on
the next line. The HTML is the shared look, written as mail apps can show it (tables,
inline styles, Arial): the logo (32 x 30, empty alt text) with "HL Central" written
beside it, as in the app's menu, at the top of a white card (a picture that can't show
leaves the name), the message, "Sent by HL Central." under
it, and a hidden inbox preview line (the first paragraph unless given). The logo
travels **inside** each email: the HTML shows `cid:hl-logo@hlcentral`, and
`smtpMessage` attaches `backend/assets/email-logo.png` (the app's logo at 64 x 60,
8 KB) inline under that id, so it shows from a local copy, if the site is down, and in
mail apps that block pictures from the internet; the queue carries only text, the file
is added at send time. All typed text
is escaped; a link must be `http(s)` or `renderEmail` throws. The account emails build
their blocks in `account-emails.ts`; the mention, assignment, reminder, Admin alert and
queue test emails in `utils/notification-emails.ts`, which needs no database (the
callers look up names and build links). Both versions are queued and kept (dashboard,
`FailedEmail`, the console mailer prints the text); `EMAIL_SEND_TEXT` (`"true"` when
unset) decides only whether the text part is sent — `smtpMessage` in `mailer.ts` drops
it when `"false"`, except for an email with no HTML (one queued before this). It lives
in `email-config.ts`, as the standalone worker reads only that. `npm run email:preview
--workspace backend` writes every email (sample data, nothing sent) as HTML files, each
also with images off, plus an `index.html`.

`EMAIL_DELIVERY` decides what `queueEmail` does:

- **`queue`** (the docker-compose default): the email is added to the `email`
  queue in Redis, with the job id = `emailId`, and the **email worker** sends it
  (see below for where it runs). If Redis cannot take it, the API sends it
  directly and logs a warning, so an email is never lost to a Redis outage.
- **`direct`** (the app's own default: tests, a backend run outside Docker, and
  Render until its Key Value is in place): the API's mailer sends it at once. The send
  starts synchronously, so the console mailer's outbox is filled when the call
  returns; the tests rely on that. Production logs a NOT PRODUCTION READY warning
  in this mode.

**Where the email worker runs.** `queue/email-worker.ts` (`startEmailWorker()`)
is the worker: it sends, records failures and runs the weekly cleanup. By
default it runs **inside the API process** (`EMAIL_WORKER_IN_API`, unset or
`true`), started from `server.ts` when delivery is `queue`. With
`EMAIL_WORKER_IN_API=false` the API only adds emails, and the same worker runs
as a process of its own (`src/worker.ts`, e.g. a Render background worker).
Inside the API was chosen because Render has no free background worker and both
APIs are on always-on plans, so the worker never sleeps; the cost is that sending
shares the API's CPU and pauses while it restarts. If email volume ever slows the
API, move it out by setting the switch and adding the service; no code changes.

**Retries.** A failed send is retried after `EMAIL_RETRY_DELAY_SECONDS` (120),
`EMAIL_MAX_RETRIES` (10) times after the first try: 11 tries over about 20
minutes. Every error is retried the same way. The policy is stamped on each job
when it is queued, so changing the settings affects new emails only. Sent jobs
stay in Redis for a day, failed ones for 14 days (retryable by hand).

**Duplicates.** `emailId` is a fresh UUID unless the caller passes one. Reminders
pass `reminder-<reminder id>`: on top of the `emailSentAt` claim, the queue then
ignores a second job for the same reminder while the first is kept.

**`FailedEmail` table.** Written only by the worker
(`queue/failed-email.recorder.ts`, which never throws, so a database hiccup
cannot change whether an email is retried):

- sent on the first try: nothing is written (a normal day never touches the
  database);
- failed with tries left: a `retrying` row with `nextRetryAt`;
- failed with none left, including a failed retry pressed on the dashboard:
  `failed`, with `failedAt`; never retried automatically;
- sent after failing: the row is deleted.

Tokens in sign-in links are stored as `token=[redacted]`; `lastError` is capped at
500 characters. CHECK constraints in the migration keep `status` to
`retrying`/`failed`, `attempts` at least 1, and `failedAt` set exactly when the
status is `failed`.

**Weekly cleanup.** On start the worker registers a BullMQ job scheduler on the
`maintenance` queue (`queue/maintenance.ts`): every Sunday 04:00
`BUSINESS_TIMEZONE`, it deletes the `failed` rows, and only those. To run it now,
`npm run queue:clean-failed-emails` adds a one-off job. Do not use Promote on the
scheduled job: that runs the week's slot early, so the schedule skips a week.

**Dashboard.** Bull Board shows both queues, with Retry for failed emails. One
setup (`queue/dashboard-board.ts`, `createQueueBoard`) is served in two places:

- locally, by its own container (`src/queue-dashboard.ts`) at
  `http://localhost:3005/bullmq`, with no sign-in and published to this computer
  only;
- by the API itself at `/bullmq`, behind the browser's sign-in box (HTTP Basic,
  `middleware/basic-auth.ts`, compared in constant time). `server.ts` mounts it
  only when `EMAIL_DELIVERY` is `queue` and `QUEUE_DASHBOARD_USER` and
  `QUEUE_DASHBOARD_PASSWORD` are set, the password 16 characters or more
  (`queueDashboardMode`); otherwise the path is a 404. On Render the API is the
  only way in, so staging and production each switch it on with their own pair.
  `createApp` takes it as an option, so the tests never open a Redis connection
  for it.

Admins reach it from the profile page: `components/QueueDashboardCard.tsx` shows
a "Queues Dashboard" card, with a link opening the dashboard in a new tab, to Admins
only and only when the build has `VITE_QUEUE_DASHBOARD_URL` (docker-compose: the
local container; Render: each API's `/bullmq`). Hiding the card does not lock the
dashboard: it checks its shared password, not the HL Central role, so each
environment's password is given to Admins alone.

Both show sign-in links as `token=[redacted]` (a display formatter on the email
queue); the job keeps the real link, so Retry sends a working email, while
Bull Board's Duplicate and Update Data would copy the hidden one.

**Connections** (`queue/redis.ts`). The connection the API adds emails on fails
fast instead of holding commands while Redis is down, so a request never waits
on it; the email worker's own connection (inside the API or not) and the
dashboard's wait and reconnect. Their error listeners use `quietErrorLog`,
which prints each distinct message at most once a minute. Redis must run with
`maxmemory-policy noeviction`, or a full Redis would silently drop queued emails.

**Shutdown.** On SIGTERM the email worker stops taking jobs and finishes the
sends under way, then the process closes Prisma, the queue, the dashboard's
queues (when served) and the SMTP pool,
within 25 s (Render waits 30 s for a web service; docker-compose 30 s). The
signal must reach node: Render starts the API with `node backend/dist/server.js`
and docker-compose runs tsx directly behind `init`, because npm and a plain
shell both exit on SIGTERM without passing it on. A process killed mid-send can
send one email twice (rare; accepted).

**Known limits.** Set-password and reset links last 60 minutes and the retries
finish in about 20, so a retried link still works; a long outage of the email
worker (the API, by default) could deliver a link that has expired. Retried emails, tokens included, wait in Redis,
which is reachable only from inside Render (and only from this computer locally).

## 15. Task special attributes (HLAI-118)

Optional, fixed-list attributes on a task that link it to the Amazon alert it is
about: **Alert Group** (an Exclusives `AlertGroup`) and **Alert Type** (one of the
12 `EXCLUSIVES_ALERT_TYPES`). Unlike free-text tags they hold known values, so
tasks can be filtered by them reliably.

- **Storage.** `Task.alertGroupId` (FK, `ON DELETE SET NULL`: deleting a group
  empties its tasks' value, with no History entry on those tasks) and
  `Task.alertType` (text, checked by `z.enum` on write like the Exclusives list
  fields; `toAlertType` reads a value the app no longer knows as not set). Both
  indexed. Migration `20261016120000_task_alert_attributes`, additive.
- **One list of attributes.** `TASK_ATTRIBUTE_KEYS` / `TASK_ATTRIBUTE_LABELS`
  (shared) and the frontend helpers in `lib/taskAttributes.ts` (labelled values for
  a task; the filter's ticks ⇄ request) drive the page, the column and the filter.
  A future attribute is a Task field + validation + mapper + filter + an entry in
  that list and its `switch`es.
- **API.** `TaskDto` / `TaskRowDto` carry `alertGroup: { id, name, isActive } | null`
  and `alertType | null`. `PATCH /api/tasks/:id` takes `alertGroupId` / `alertType`
  (null clears; an unknown or inactive group is a 400). Changes go to History (the group's name,
  the type's label). Duplicate and task-level recurrence copy both. Filters:
  `alertGroupIds` + `includeNoAlertGroup`, `alertTypes` + `includeNoAlertType` —
  per attribute, one of the values OR "(not set)", ANDed with every other filter
  (the Due Date report shares them). The xlsx export has a column each.
- **Inactive groups.** A group an Admin switches off stays on the tasks that have
  it, until someone picks another: the task page shows the Alert Groups page's red
  mark before its name, and the list column still shows it. It can no longer be
  picked: the pencil's dropdown leaves it out (its own value reads "(inactive)",
  through `SearchSelect`'s `valueLabel`), and the server refuses it. The group
  options endpoint still lists every group, with `isActive`, for the filters.
- **Task page.** `TaskAttributesBar` sits under the property row: everyone who
  can see the task sees the values; editors get a pencil opening
  `TaskAttributesModal`, with one `SearchSelect` per attribute (a dropdown with a
  search box at the top, opening in place so the dialog never clips it). The
  picks are held until **Save**, which sends only what changed in one request (no
  staleness token, like Tags) and closes; Cancel, Escape or a click outside
  (`useBackdropDismiss`) close it without saving. With picks not saved, Escape
  or a click outside first ask with a browser `confirm()`: OK closes it, Cancel
  keeps it open with the picks.
- **Task list.** The `attributes` column (`TaskAttributesCell`): up to two
  small capsules (an Alert Type in its Exclusives tone) and a button opening a
  window that lists every attribute. It reads "+", or the number not shown ("+1",
  "+2") once more than two are set, and "−" while the window is open. The "Attributes" filter picks an attribute, then a
  searchable `MultiSelect` of "(not set)" and its values; one chip per filtered
  attribute.
- **Not covered:** the Kanban, Calendar and Gantt views, templates, and setting
  the attributes while creating a task.

## 16. Alert Tasks (HLAI-112)

The goal: every Exclusives alert becomes a task for the right person without
anyone creating it by hand. Each of the 12 alert types is linked to a template,
with a person for each of the template's role placeholders — the same for every
alert group. **Immediate** alerts make a task each as soon as they are found;
**Daily** alerts make one task per group and type a day (8:30 AM New York time by
default; set on Render), listing the day's alerts and linking to them in the
Alert Log.

- **Screen.** `ExclusivesAlertTasksPage` at `/exclusives/alert-tasks` ("Alert
  Task Setup" under *E-commerce exclusives*), Admins only. One row per alert type in
  `EXCLUSIVES_ALERT_TYPES` order: the type's badge, a template `SearchSelect`
  ("— None —" = no task; one template may serve several types), and the Role
  Assignment cell — one line per role of the chosen template (fetched once with
  `GET /api/templates/:id`) with a person dropdown of active people, worked like
  the template's Create tasks window: ⚠ for someone missing a duty that role's
  tasks carry (`useDutyCatalog`), "✓ Holds every duty needed", and a saved person
  who is no longer active flagged. A new template keeps the people for roles of
  the same name; only the chosen template's roles are saved.
- **Save / Cancel** at the top right, both off until something changed. Save
  sends all 12 settings at once with `expectedUpdatedAt`, and stays off while a
  ⚠ remains or a template's roles are loading; Cancel puts back what was last
  saved. If another Admin saved first, Save turns into Refresh with the shared
  `ConflictBanner`, as in the group editor. Leaving with changes asks first
  (`useUnsavedChangesWarning`). Loading, load-error (with "Try again") and
  no-templates (a link to Templates) states.
- **Contract.** `ExclusivesAlertTaskSettingDto` (alertType, templateId,
  roleAssignments), `ExclusivesAlertTaskSetupDto`, `SaveExclusivesAlertTaskSetupRequest`
  in `packages/shared`.
- **Storage.** `AlertTaskSetting`, one row per alert type once it has been saved
  with something in it: `templateId` (deleting the template empties it, so that
  type makes no tasks until another is picked), `roleAssignments` as JSON
  `[{ role, assigneeId }]` (people only, by role), and `savedById`, the Admin who
  last changed the row — the creator of the tasks it will make. A Save rewrites
  only the rows that changed.
- **Endpoints** (Admins only, `services/exclusives/alert-task-setup.service.ts`).
  `GET /api/exclusives/alert-tasks` returns all 12 rows in order (an unsaved type
  is empty) and the setup's version, its newest row's `updatedAt` (null before
  the first Save). `PUT` takes `{ settings, expectedUpdatedAt }`; a Save from an
  older version is refused (409 `STALE_WRITE`), under an advisory lock so two
  Saves cannot both pass. Behind the screen's own checks it refuses a template
  that no longer exists, a role the template does not have, people with no
  template, someone no longer active (400), and someone missing a duty their
  role's tasks carry (422 `DUTY_NOT_HELD`, each problem with its `alertType`).
- **Label rule** (`packages/shared`, not used yet). Tasks made from alerts will be
  labelled `<group part>_<type code>_<YYJJJHHMM>`: `alertGroupLabelPart` (the
  first 4 letters and digits of the group name, then the first after each "-",
  en/em dashes counting as "-"), `EXCLUSIVES_ALERT_TYPE_CODES` (LS, BL, BW, …),
  `julianStamp` (2-digit year, day of the year 001–366, 24-hour time, on the
  business time zone's clock), put together by `alertTaskInstanceLabel`;
  `withClashCounter` adds `_2`, `_3`, … to a label already taken. "Wasif - US",
  Buy Box Won, 19 Oct 2026 08:30 New York → `WasiU_BW_262920830`.
- **Task maker** (`generateOccurrence`).
  Optional `alertGroupId` / `alertType` put the HLAI-118 attributes on every task
  of the tree; `rootDescriptionExtra` is added after the top task's own
  description (sanitized and size-checked with it). With origin `alert`, every
  task gets a History line, field `alert`, shown as "Made automatically from a Buy
  Box Lost alert (Wasif - US)". A group that no longer exists makes nothing.
  `alertLogIds` links the alerts to the top task and marks them handled in the
  same transaction (409 if one already was). Manual creation (`POST
  /api/templates/:id/instantiate`) passes none of these and is unchanged.
- **Immediate tasks** (`services/exclusives/alert-tasks.service.ts`,
  `makeImmediateAlertTasks`). Run at the end of every Exclusives pass, still
  under the pass lock, and never failing it. Each alert waiting for its task
  (`AlertLog.taskHandledAt` empty) of a type its group has on "Immediate" and
  that has a template on Alert Task Setup gets its own tree: labelled
  `alertTaskInstanceLabel` + `withClashCounter` (against existing occurrence
  labels), tagged, its roles filled from the setup (someone no longer active
  leaves their role unassigned; a missing duty does not stop it), created by the
  row's `savedById`, anchored at the moment it is made. An alert with no task due
  — no template for its type, alerts switched off since, its group deleted — is
  marked handled with no task, so a template picked later never reaches back to
  it. Alerts on "Daily" are left waiting. A task that fails is logged and left
  waiting, so the next pass tries again. `AlertLog.taskId` keeps the top task
  (emptied if it is deleted).
- **Go-live.** The migration that added `taskId` / `taskHandledAt` marked every
  alert already in the log as handled, so only alerts found after it ran (on
  each server) make tasks.
- **The Daily run's time** (`services/exclusives/daily-window.ts`), on the
  business clock: `EXCLUSIVES_DAILY_TASKS_AT`, 24-hour `HH:MM` read at start-up
  (`env.alertTasks.dailyAt`; a wrong value stops the server), `08:30` when unset.
  Each Daily task covers the day before it, from the same time the day before to
  a minute before it (`lastDailyRunAt` / `nextDailyRunAt`, `dailyWindowStart`),
  so every alert falls in exactly one day. Built from clock times on business
  dates, so on a DST day that day is 23 or 25 hours and no alert is missed or
  doubled. The server logs it at start-up ("Daily alert tasks: 8:30 AM New York
  time, covering the day before (8:30 AM to 8:29 AM)").
- **Daily tasks** (`makeDailyAlertTasks`, `alert-tasks.service.ts`). Run in every
  scheduler pass (`runScheduler`), and the scheduler wakes at the next Daily run
  while any alert type is on Daily with a template (`dailyAlertTasksInUse`). An
  alert belongs to the day whose run first follows it. Every day that has ended
  gets one task tree per group and type for its waiting Daily alerts — several
  days at once if a missed run left them behind — labelled with that day's run,
  anchored there, and all its alerts linked to the top task in the same
  transaction. Changing the time: alerts that already made a task stay handled;
  the waiting ones go into the next run's day, so none makes two tasks (that
  first day is shorter or longer). The top task's
  description is the template's own text, then a table (`dailyTable`): a
  header row — No., ASIN, Group, Alert Type, Date & time (business clock),
  Details — and a row per alert, oldest first. Details is the alert's own
  message for the first two rows and, from the third, "See log for details…", a
  link to the Alert Log on that day, type and group with the row's ASIN in the
  search box. At most 100 rows and no more than fit in `RICH_TEXT_MAX_CHARS`
  beside the template's text, then "…and N more: see the Alert Log link", then
  the whole day's link ("View these alerts in the Alert Log"). Daily alerts with no
  template, or whose group was deleted, are marked handled with no task;
  Immediate ones are left to `makeImmediateAlertTasks`.
- **The Alert Log link** (`alertLogHref` / `readAlertLogLink` / `isAlertLogHref`
  in `packages/shared`): `/exclusives/log?from=…&to=…&type=…&group=…[&q=…]`,
  the day's start and end as instants and, for a table row, its ASIN as the
  search. The only link rich text may hold:
  `sanitizeRichText` keeps an `<a href>` to the Alert Log (nothing else on it) and
  turns any other link into plain text; `RichText` lets only that href through
  DOMPurify and opens it in the app (Ctrl/⌘-click still opens a new tab); the
  editor's StarterKit link keeps it while editing (`isAllowedUri`), with automatic
  links from typing or pasting off. The Alert Log reads the filters and the
  search from the address as it opens (the viewer sees the dates on their own
  clock).
- **Duties the setup needs stay put.** The Organization screen won't take a duty
  away from someone whose Alert Task Setup role needs it (the role's template
  tasks carry it). `getOrg` sends each person's `alertTaskPicks` (alert type, role,
  the duties it needs — `alertTaskPicksByPerson`), so unticking such a duty shows
  a warning under it (Alert Task Setup would show ⚠ on them; set that role to
  "Leave unassigned" there first) and keeps Save off. `saveOrgChanges` refuses it too (422
  `ALERT_TASK_DUTY_NEEDED`, naming the person, role, alert type and duty, and
  saying an Admin must first set that role to "Leave unassigned" there). Other
  removals go through as before, the person's existing tasks flagged ⚠; adding a
  duty is never blocked.
- **By hand**: `npm run alert-tasks:run --workspace backend`
  (`scripts/alert-tasks-run.ts`) makes the Immediate tasks waiting (retries
  included), then the Daily ones of every window that has ended — the same work a
  check and the scheduler's Daily pass do, for where those are off (staging; locally
  with the sweep off). Safe to run any time.
- **Known gap.** Saving a template offers "Update future instances?"
  (`applyTemplateToOccurrences`), which counts every open task tree made from it,
  alert-made ones included, and sets each task's description back to the
  template's. On a Daily alert task that drops the list of alerts and the Alert
  Log link. "Leave them" is safe. Not changed yet: leaving `alert` occurrences out
  of that update is the suggested fix, awaiting a decision.
