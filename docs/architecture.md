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
  in-memory fake under tests). JWT auth.
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
    utils/                    # HttpError, jwt, password, mailer, async-handler…
  test/integration.test.ts    # the whole integration suite (node:test + supertest)
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
**Postgres** (:5432), **MinIO** (:9000 API / :9001 console). The backend applies
migrations on start and runs the background scheduler (§8). Attachments upload
directly to MinIO via pre-signed URLs; only metadata passes through the API.

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
  (`TaskRecurrence`, `recurrenceSourceId`/`recurrenceSeq`).
- **Attachment / Comment / CommentMention / MentionEvent** — Phase 4 rich content;
  attachments reference exactly one of task/comment; comments carry sanitized HTML
  and @mentions.
- **TaskHistory** — append-only audit entries (Phase 5).
- **UserScreenPref** — per-user, per-screen opaque JSON UI state (Phase 6).
- **Notification / Reminder / NotificationPreference** — Phase 8 inbox
  (mentioned/assigned), time-conditional reminders, and per-list opt-ins.
- **TaskTemplate / TaskTemplateNode / TaskTemplateDependency / TemplateOccurrence**
  — Phase 11 reusable definition trees, their between-node dependencies, and a
  record of each materialized instantiation.
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
  attachments via pre-signed S3 URLs.
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
- **Team Goals** scopes to the supervisor's own direct reports only (Admin: all
  users), and a supervisor can never widen the `ownerIds` filter past their reports.

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
