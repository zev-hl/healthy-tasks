# Redesign decisions (on top of `redesign-brief.md`)

`docs/redesign-brief.md` is the design: Direction D1 "Harbor". This file records
how it maps onto the real HL Central, as decided with the user. Where the two
disagree, this file wins.

The redesign branch is **frontend-only**: it shares the Staging API and
database, so no schema, migration or API-contract changes go on it. Anything
that would need one is listed under **Backend jobs** below and shown in the
UI as a disabled "coming soon" placeholder.

## Data mapping

| Brief                      | HL Central                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4 statuses                 | All 6 kept. Open = grey, In Progress = blue, On Hold = amber, Review = blue info, Completed = green, Canceled = grey.                                          |
| High / Normal / Low        | All 4 kept. Urgent = bold red, High = red, Medium = neutral, Low = muted.                                                                                      |
| Department › Team › Person | Department › Duty › Person. Task rows show `#12 · Finance › Reporting`.                                                                                        |
| Per-task timer             | Browser timer (survives page changes and closing the tab, not other devices). Stop adds the minutes to My Time under the task's duty through the existing API. |
| Checklist, Watchers        | Disabled placeholders. Sub-tasks shown in their real card.                                                                                                     |
| Overloaded flag            | Left out for now. My team shows overdue only.                                                                                                                  |
| Period toggle              | Sun–Sat weeks, month to date, in the viewer's own time zone.                                                                                                   |
| "My team"                  | Everyone in my department(s), meaning the departments of the duties I hold. Admins see everyone.                                                               |
| Saved views                | Per user on the server, inside the existing `task-search` screen setting.                                                                                      |

## Scope

- **Task views:** List, Kanban, Calendar and Gantt are all kept and restyled. List gets the full brief treatment.
- **Task page:** keeps the real features (sub-tasks, dependencies, files, reminders, recurrence, history, alert group/type, review) in the new layout.
- **Other screens:** every screen gets a full Harbor redesign, not just a restyle. Each is proposed with a screenshot for approval.
- **Icons:** `lucide-react`.
- **Phones:** layouts are checked and fixed at phone width.
- **All apps launcher:** only _other_ apps; for now that is Exclusive Alerts. Exclusives (Alert Groups, Alert Log, Alert Task Setup) leaves the sidebar and opens from the launcher as its own app.
- **Progress:** screenshots after each step.

## Navigation (decided page by page)

**Sidebar** (labelled, navy, as in the brief). Items are shown by role.

| Item      | Who             | Contents                                                                                                      |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| Dashboard | everyone        | Replaces My Day at `/`. Two views, **My dashboard** and **My team** (Admins/Managers). Contents listed below. |
| Tasks     | everyone        | List · Kanban · Calendar · Gantt. Templates live here. More below.                                            |
| Time      | everyone        | Tabs **My time** · **Review** (Review for Admins/Managers).                                                   |
| Goals     | everyone        | Tabs **My goals** · **Team goals** (Team for Admins/Managers).                                                |
| People    | Admins/Managers | Tabs **Users** (Admins) · **Organization** (Admins/Managers).                                                 |
| Settings  | Admins          | App settings, **Departments & duties**, and the **Queue dashboard** button (moved off Profile).               |

**Dashboard** contents:

- **Notifications:** a section on the dashboard.
- **Due-date performance:**
  - My dashboard shows my own on-time rate.
  - My team shows the rate per person and per department.
- **My team:** replaces the old "Everyone reporting to me" and "Their overdue" sidebar links.

**Tasks** contents:

- **Templates:** a Templates button or tab on Tasks, plus "Save as template" on the task page.
- **"My team" tab:** a built-in tab for Admins/Managers.

**Removed from the sidebar:**

- **Quick views:** Overdue, Assigned to me, Needs my review, Blocked and Created by me are dropped. Custom saved views on Tasks replace them.
- **Notifications page:** removed. The bell is in every page header (a popover of recent notifications), plus the Dashboard section. There is no full Notifications page.
- **Due Date Performance page:** removed. Its numbers live on the Dashboard.

**Account card** (sidebar bottom): opens **Profile** directly.

**All apps launcher:** only other apps. Ticket (the company's other app) is the style reference for the launcher and the left navigation; it does not get a tile.

- **Exclusive Alerts:** opens as its own app in the same shell, with its own sidebar (Alert Log, Alert Groups, Alert Task Setup) and its own name on the logo tile. The launcher goes back to HL Central.

Old addresses (`/notifications`, `/reports/due-date`, `/reports/time`, `/goals/team`, `/admin/...`) redirect to their new homes, so links in emails and bookmarks keep working.

## Backend jobs (not on this branch)

Each of these needs a change merged into `staging` first, like the CORS change.
Until then, the UI shows the feature as a disabled placeholder or uses the
stated fallback.

1. **Task checklist:** steps on a task, with ticked state and order. Needs a new table, API and history events.
2. **Watchers:** watch or unwatch a task, a watcher list on the task, and probably notifications.
3. **Server-side timer:** a running timer per user that follows them across devices, plus time logged **per task** with session counts. Today `TimeEntry` is per day per duty, so a task page can't show "2h 40m · 2 sessions".
   - Fallback: the browser timer logs to the duty, and the task page shows only what that browser timed.
4. **Saved views, own slot:** add a `task-views` screen key to `SCREEN_KEYS`.
   - Today they share `task-search`, which the old Staging site rewrites whole, so changing Tasks filters there wipes views saved on the redesign.
   - **Shareable** views would also need a new table.
5. **Batch update:** one endpoint to change status, assignee, due date or priority on many tasks at once.
   - Fallback: one update per task. That isn't atomic, so a partial failure is reported per task.
6. **Dashboard numbers for My team:** counts per person and department (open, overdue, done in period) and overdue by department.
   - Fallback: computed in the browser from task queries, which is slower with many tasks. (To verify once built.)
7. **Department-wide visibility:** "My team" means my departments, but access control may hide some colleagues' tasks from a supervisor who isn't above them. If so, decide whether the dashboard should see them. (To verify.)
8. **Cross-task activity feed:** "My activity" and the team activity feed for a period. History is stored per task; there may be no endpoint that lists it across tasks. (To verify.)
9. **Overloaded rule:** if it comes back, the rule and any settings for it.
10. **"Related" links:** the brief's Linked tasks card has a third type, Related (no blocking). Only
    Parent, Blocked by and Blocks exist today, so the card's type dropdown offers those three.

## How the older screens were brought in

- **Header band:** Time, Goals, People, Settings, Profile, Templates and Exclusive Alerts use the header band (`PageHeader`), with their sibling pages as tabs inside it.
- **Style layer:** a shared layer in `harbor.css` restyles the older pieces they still use: view switches, buttons, tables, notices and cards.
- **Dropdowns and dates:** `NativeEnhancer` opens the Harbor menu and calendar for every remaining browser dropdown and date field, so none of the browser's own popups appear. The page code is unchanged.
- **Removed pages:** the Notifications and Due Date Performance pages now redirect to the Dashboard. The Queue dashboard card moved from Profile to Settings.
