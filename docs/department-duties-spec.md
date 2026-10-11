# Department Duties

Status: BUILT (October 2026)
Design: `docs/design/Department Duties Prototype.html` (local only — gitignored)

Departments own **Duties**, people **hold** duties, tasks and template tasks can
carry a duty, and people **log their time** against their duties each day.
Supervisors review that time. A duty is always shown as **Department › Duty**.

## Screens

| Screen | Route | Who |
| --- | --- | --- |
| Departments & Duties | `/admin/departments` | Admin |
| Organization | `/admin/organization` | Admin (everyone), Manager (self + everyone below) |
| My Time | `/time` | Everyone |
| Time Review | `/reports/time` | Admin, Manager |
| All tasks / Due Date Performance | existing | Department › Duty column, Department / Duty / mismatch filters, Excel column |
| Task detail / New task | existing | optional Duty with the assignee ⇄ duty check |
| Templates | existing | a Duty per template task; role ⇄ duty check on Instantiate |
| Notifications | existing | "Duty mismatch" rows in the Assigned list |

## Data model (migration `20261011120000_department_duties`)

- `Department` — name (unique, case/space-insensitive via `nameKey`), color, `archivedAt`.
- `Duty` — `departmentId` (required, **immutable** — trigger), name unique **within its
  department** (`@@unique([departmentId, nameKey])`), description, `archivedAt`.
- `UserDuty` — `(userId, dutyId)` PK. A person can hold duties in several departments.
- `Task.dutyId`, `TaskTemplateNode.dutyId` — nullable FK, `ON DELETE RESTRICT`.
- `TimeEntry` — `(userId, date DATE, dutyId)` unique, `minutes` 1–1440 (CHECK).
- `TimeDay` — `(userId, date)` PK, `completedAt`, `note`. `updatedAt` is the editor's
  optimistic-concurrency token.
- `NotificationType.dutyMismatch`.

`nameKey` is always recomputed from `name` by a trigger (trimmed, single-spaced,
lower-cased), so the uniqueness rule can't drift from the app's.

## Rules

### Catalog
- Archive, don't delete, once anything has used a row (a holder, a task, a template
  task, logged time). Never-used duties, and departments with no duties, can be deleted.
- Archiving a department archives its duties. Restoring a department does **not**
  restore its duties — they're restored one by one, and only under an active department.
- Archived duties disappear from pickers but stay on existing tasks, in history and in
  reports. A task or template task may *keep* an archived duty; nothing may be newly set
  to one.
- Duties can't move between departments (it would rewrite past time reports).

### Who can assign duties (decision #2)
Admins: everyone. Managers: the people below them (reports and reports' reports — the
Phase 13 subtree), never themselves. Same rule for the "Give this duty" buttons.

### Organization
- Changes are staged and saved together (`PUT /api/org`) in one transaction.
- **Managers may also move people, but only within their own team**: the new supervisor
  must be the Manager or someone below them. Only an Admin can take someone to the top
  level. (Clarified with the product owner, Oct 11 2026.)
- A supervisor must be a Manager or Admin (existing rule; the prototype's sample data
  broke it). A batch is checked as a whole, so it can't create a loop; each move carries
  the supervisor the client last saw (409 `STALE_WRITE` if it changed).
- Removing a duty that open tasks use is allowed: those tasks are flagged ⚠, not changed.

### Assignee ⇄ duty
- A task with a duty may only go to someone who holds it. The check runs whenever the
  assignee **or** the duty changes, whichever was picked first — 422 `DUTY_NOT_HELD` on the
  server, live red state + blocked Save in the UI, with three fixes (give the duty / pick a
  holder / remove the duty).
- **Existing mismatches** (decision #3): flagged ⚠ and amber; unrelated edits still save.
- **Review hand-offs are exempt** (clarified Oct 11 2026): sending to Review gives the task
  to a reviewer, and Reviewed/Recall gives it back, without the check. While a task is in
  Review the ⚠ flag is judged against the **prior assignee**, not the reviewer.
- A new task with no assignee goes to its creator, so the check runs against the creator.
- Duplicating a task keeps its duty (an existing mismatch stays flagged).

### Templates (decision #4)
- Each template node may carry a duty. On Instantiate every person filling a role must hold
  the duties that role's nodes carry; all problems are reported at once and Proceed stays
  disabled until each is fixed (`POST /api/templates/:id/duty-check` powers Re-check).
- Automatic creation (scheduled fires, ghost click-through, recurring-task copies) can't
  answer a prompt: the task is created anyway, flagged ⚠, and the template owner (or the
  recurring task's creator) gets a `dutyMismatch` notification.
- "Apply to future occurrences" re-syncs the duty like the other definition fields.

### Time
- Only duties the person currently holds (and that aren't archived) can take time. An entry
  on a duty they no longer hold can be lowered or cleared, never raised.
- A day holds at most 24h. Future days are locked; "future" is judged against UTC+14 (the
  furthest-ahead zone) because staff work in several countries and the browser's own date
  is what the person sees.
- **A Completed day is read-only until its owner reopens it** (decision #5, clarified Oct
  11 2026). Completed is a flag on the day, independent of how much was logged.
- Dates are plain `DATE`s — the person's own calendar day, never shifted through UTC.
- Supervisors (Phase 13 subtree) and Admins can read anyone's days; only the owner writes.
- Merging two accounts unions their duties and moves their time; the same day + duty adds
  up (capped at 24h); a day completed on either stays completed.

### Time Review
- Scope: my team (all levels), direct reports, team + me, one person, or (Admins) everyone.
- Day review: one row per person, one column per day — always a week.
- Roll-ups: Person › Dept › Duty, Dept › Duty › Person, Dept › Person › Duty; Week = a
  column per day, Month = a column per Sun–Sat week cut at the month's edges.
- Related tasks: tasks with a duty, assigned to people in scope, whose start–due range
  falls inside or across the period (no start / no due = open-ended), access-scoped.
- Export CSV is built in the browser from the grid on screen (hours, decimal).

### Per-user memory (`UserScreenPref`)
`departments` (expanded rows), `my-time` (view, hide weekends), `time-review` (view,
period, hide weekends, related-tasks panel). `organization` is reserved.

## Not changed / out of scope
- The Supervisor field on Add/Edit User stays (Admin-only) and saves to the same column.
- No sample departments are seeded in production; Admins create the real ones.
- Status names, the Excel exports and the app's existing vocabulary ("Instantiate") win
  over the prototype's placeholders ("Blocked", "In Review", "CSV", "Create tasks from").
