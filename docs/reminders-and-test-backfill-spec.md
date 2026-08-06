# Spec — Reminders overhaul + test backfill

**Status:** Designed & approved, NOT yet implemented. Build this in a fresh session.
**Origin:** design conversation 2026-08-05. Baseline: `main` == `staging` == `103b2ea`; backend integration suite **192/192 green** (no regressions from this session's shipped work).
**Related:** `docs/architecture-audit.md` (the read-only audit; the reminder IDOR below is one of its top-7 items). This work closes that item.

---

## Background (current reminder behavior)

Reminders are **personal** (`Reminder` = `userId + taskId + leadMinutes`, plus `readAt`/`snoozedUntil`/`emailSentAt`). A reminder is "due" when `now ≥ startAt − leadMinutes` (`isReminderDue`, returns false if `startAt` is null). The reminder **row is persistent**; only due-ness is computed live. The notification feed and reminder emails derive from the reminders table (`listDueReminders` → `notification.service.ts`). The bell/unread already works via `readAt`.

Gaps this spec fixes:
1. **IDOR** — `addReminder` (`reminder.service.ts:52`) checks only that the task *exists*, not that the actor can see it. Any authed user can `POST /api/tasks/:id/reminders` (route is `requireAuth`-only) on any id, then harvest task name/start/priority via `/notifications` and reminder emails (`listDueReminders` / `notification.service.ts:173,308` have no access re-check). The task page 404s, but the *notification payload itself* leaks the metadata.
2. Reminders can be set on tasks with **no start date** (they silently never fire).
3. Reminders can be set for **past start dates** (fire immediately — pointless).
4. Reminders **fire for Completed and Canceled tasks** (no status check; inconsistent with `TERMINAL_TASK_STATUSES` handling elsewhere).

---

## The design

### A. Access control at the API — the single surface gate
- **A1 · check-on-set:** `addReminder` must call `requireTaskAccess(actor, taskId)` (→ 404 if no access, mirroring the rest of the app). Closes the IDOR/enumeration hole.
- **A2 · suppress-on-surface:** a reminder surfaces to a user — **due OR canceled-notice** — only if that user **currently** has access to its task. Apply this filter in `listDueReminders` (feed + email path). This is the ONE chokepoint governing all reminder surfacing; a user who has since lost access sees nothing (same as a due reminder they'd never see).

### B. "Add reminder" blocked conditions
Backend `addReminder` returns **400** and the frontend **disables Add** + shows a label (overdue-rust color) on the same line as the **REMINDERS** section title, when:
| Condition | Label |
|---|---|
| Task has **no start date** | "Requires Start Date" |
| Task's **start date is in the past** (`startAt < now`) | "Start date has passed" |
| Task is **Canceled** | "Task canceled" |

Interpretation for past-start: block only when the **start date itself** is `< now`. Do NOT block a *future* start with a lead that's already elapsed (e.g. "1 week before" on a task starting tomorrow) — that still fires a useful "coming up" heads-up.

### C. Removal + notify flow
Triggered by **either** of two edits saved on a task via `updateTask`:
- the **start date is cleared** (`startAt` non-null → null), **or**
- the **status changes to `Canceled`** (from any non-Canceled status).

Behavior (identical for both triggers; only the reason string differs):
- **Actor's own** reminders on the task → **hard-deleted** (they consented via the confirm dialog).
- **Other users'** reminders on the task → **soft-canceled**: set `canceledAt` + `canceledReason` (`'start-date-removed'` | `'task-canceled'`).
- **Surfacing the cancel notice** goes through the A2 access gate: users who still have access see *"Canceled — start date removed"* / *"Canceled — task canceled"* in their Reminders list; users who lost access see nothing (their soft-canceled row just never surfaces).
- **Dismiss (Remove)** on a cancel notice → **hard delete** (reuse existing `removeReminder`). Dismissal is the ONLY cleanup (no auto-delete-on-read).
- **Soft-cancel is terminal:** a canceled reminder never fires and never resurrects, even if a start date is re-added or a Canceled task is reopened. To get a reminder back, create a new one.

**Confirm dialog (frontend):** when the actor's **Save changes** would clear the start date OR set status to Canceled **and** the task has reminders (`reminderCount > 0`), show a modal *before* saving:
> "Start Date cleared — Reminders will be removed. Continue Save or Cancel?"  (or "Canceling this task will remove its reminders. …")

with **Save** (proceed) / **Cancel** (abort) buttons.

### D. Terminal statuses
- **Completed** → reminders **fire normally** (no suppression, no removal).
- **Canceled** → the removal flow in C, plus the add-block in B.

### The final surface gate (all must hold for a due reminder to surface)
`has startAt` · `now ≥ startAt − lead` · `not snoozed` · `not soft-canceled` · **`actor currently has access`**.
(No status condition in the gate: Completed fires; Canceled tasks have no reminders left and can't add new ones.)

---

## Data / API changes
- **Schema migration:** add `canceledAt DateTime?` and `canceledReason String?` to `Reminder`. **Migration SQL must be pure ASCII** (WIN1252 test-DB gotcha — no `→`/arrows/box-drawing in comments).
- **`TaskDetailDto`:** add `reminderCount: number` (count of reminders on the task, any user) so the frontend knows when to show the confirm dialog. Add to the detail mapper/query.
- **Reminder notification DTO:** distinguish a **due** reminder from a **canceled** notice (e.g. a `kind: 'due' | 'canceled'` or a `canceledReason` field) so the notification feed renders them differently. Both are access-filtered.
- **Notification feed** (`notification.service.ts`): the reminders portion now yields due reminders (existing) **and** canceled-reminder notices, both through the A2 access filter.

## Frontend changes
- `TaskReminders.tsx`: accept the task's `startAt` + `status`; disable **Add reminder** and show the B-label when applicable. (It currently receives only `taskId`.)
- `TaskDetailView.tsx`: pass `startAt`/`status` into `TaskReminders`; in the Save flow, detect the C triggers (start cleared or → Canceled) with `reminderCount > 0` → show the confirm dialog before calling save.
- Notifications page: render canceled-reminder notices with a Remove/dismiss action.

---

## Explicitly DEFERRED (not in this work — noted so scope stays tight)
- **Audio chime** on the first appearance of any new notification (incl. reminders and re-awakened snoozed reminders). Feasible on the current derived model: client-side diff of a polled notification **id-set** (not just the count), baseline-seed silently on load, unlock an `AudioContext` on the first user gesture (browser autoplay policy), gated by a user preference. Separate frontend item — does **not** require the stored-events refactor.
- **"Reminder firings → stored `Notification` events" refactor** (would unify cancel notices, exactly-once delivery, and history the way mentions/assignments already are). Bigger architectural pass; not needed here. Soft-cancel is the consistent minimal choice, and the bell already works via `readAt`.

---

## Testing (build test-alongside — the whole point of this pass)

Suite conventions: `node:test` + `supertest`, real embedded-Postgres (host-only via `npm test --workspace backend`), helpers `seedUser` / `login` / `makeTask`, `TRUNCATE … RESTART IDENTITY` per test.

### In this pass
**Reminders (test-alongside):**
- A1 IDOR: a no-access user `POST …/reminders` → 404 (not 201).
- A2 suppress-on-surface: a reminder set while accessible does NOT surface after access is lost.
- B add-blocks: no start date / past start date / Canceled task → 400.
- C removal+notify: clearing the start date AND status→Canceled each: actor's reminders deleted, another user's soft-canceled + surfaces as a cancel notice (with access) / suppressed (without), dismiss → gone.
- D: a Completed task's reminder still fires; a Canceled task's does not (removed).

**Stale-write backfill (already-shipped prod code):**
- Task update + goal writes: stale `expectedUpdatedAt` → **409 with `details.code === 'STALE_WRITE'`**; correct token → 200.
- NOTE: the audit's real bug (the check is non-atomic — `findUnique` then a separate write) can't be caught by the sequential test runner; these tests pin the *sequential* guard only. Making it atomic (`updateMany({ where:{ id, updatedAt }})`) is a separate audit item.

### Deferred to separate follow-up passes (agreed)
- **Tier 1 backend:** sanitizer list support (`ul/ol/li` kept, `<script>` stripped, task-list round-trip); goals export (200 + non-empty workbook; team Admin/Manager-gated); template node rich-text sanitized on save.
- **Tier 2 backend:** scheduler watchdog (`checkSchedulerHealth` / `isSchedulerDown`).
- **Tier 3 frontend:** NO harness exists → stand up **Vitest + React Testing Library**, then cover the logic-heavy pieces only (`useStaleWriteGuard`, the conflict Save→Refresh/Review flow, the reminder-dialog trigger, the "Has start date" pill logic, `suppressInputAutofill`, calendar intra-day ordering). NOT blanket UI coverage.

---

## Build sequence (for the new session)
1. Stale-write backfill tests (validate the approach on shipped code) → run.
2. Reminder schema migration (ASCII-only SQL).
3. Reminder service: A1 + B add-checks; A2 + surface gate; C removal flow.
4. `updateTask`: wire the two C triggers.
5. `reminderCount` on `TaskDetailDto` + mapper; canceled/due distinction on the reminder notif DTO.
6. Notification feed: surface canceled notices + apply the A2 access filter.
7. Reminder integration tests (alongside 2–6).
8. Frontend: `TaskReminders` affordances; `TaskDetailView` confirm dialog + wiring; notification rendering of cancel notices.
9. Full suite green + `tsc --noEmit` (backend + frontend) + in-app verification.
10. Commit on `staging` → verify on staging → promote to `main` (ff-only) per the gated deploy flow.

## Process note (carry into the next session)
Tests slipped this session — features shipped to prod verified only by typecheck/build/manual/browser, not by suite tests. **Correcting course: build test-alongside from here.** The existing suite is strong and host-only; run it (`npm test --workspace backend`) as a baseline before and after.
