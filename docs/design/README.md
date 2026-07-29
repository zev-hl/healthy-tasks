# Handoff: Healthy Tasks UI refresh

## Overview

A visual and structural redesign of every screen currently in `zev-hl/healthy-tasks`
(Vite + React SPA in `frontend/`, Node + Prisma API in `backend/`, shared contract in
`packages/shared`). No new features, no data-model changes: same routes, same
endpoints, same enums. What changes is information hierarchy, navigation shell,
typography, colour, and the treatment of statuses, priorities, dates and people.

Goal stated by the product owner: make the interfaces **friendly, engaging and fresh**.
The current UI is functionally complete but reads as an internal admin scaffold —
browser-default blue on cool gray, `toLocaleString()` dates, raw email addresses as
person labels, and dense tables with four layers of chrome above the first row.

## About the Design Files

`Healthy Tasks Redesign.dc.html` is a **design reference created in HTML** — a
prototype showing intended look and layout. It is **not production code to copy**.
It is a static, non-interactive mock: buttons are styled `<span>`s, all styling is
inline, and it uses a small local streaming runtime (`support.js`) purely so it renders
in a browser. Open it directly in a browser (both files must sit in the same folder).

The task is to **recreate these designs inside the existing frontend** —
React 18 + `react-router-dom` data router, plain CSS in `frontend/src/styles.css`,
no component library — using that codebase's established patterns. Extend
`styles.css` with the tokens listed below; do not port the inline styles verbatim,
and do not introduce a CSS framework for this work.

## Fidelity

**High-fidelity.** Colours, type, spacing, radii and states below are final and exact.
Recreate pixel-for-pixel where the existing markup allows. The one deliberate
looseness: the mock is drawn at a fixed 1440px content width with no responsive
breakpoints. Mobile is explicitly **out of scope** and should be designed separately.

## Frames in the file

The document is a canvas. Each frame carries a visible id badge, and a "Why" strip
beneath it explaining what changed and why.

| Id | Frame | Maps to |
| --- | --- | --- |
| 1a | Foundations (palette, type, statuses, priorities, dates, empty state) | `frontend/src/styles.css`, `packages/shared/src/index.ts` |
| 1b | My Day (first pass) | `pages/HomePage.tsx`, `components/Layout.tsx`, `components/TaskDashboard.tsx` |
| 2a | **My Day — Member.** The current spec for this screen; supersedes 1b. | same |
| 2b | **My Day — Manager / Admin.** 2a plus a team strip. | same, plus `UserDto.supervisorId` |
| 1c | Tasks (list) | `pages/TaskSearchPage.tsx`, `components/FilterPopover.tsx`, `SortHeader.tsx`, `MultiSelect.tsx`, `lib/taskSearch.ts` |
| 1d | Task detail | `components/TaskDetailView.tsx`, `Comments.tsx`, `AttachmentSection.tsx`, `TaskHistory.tsx`, `TaskReminders.tsx` |
| 1e | Notifications | `pages/NotificationsPage.tsx`, `components/NotificationBell.tsx` |
| 1f | Users (admin) | `pages/UsersPage.tsx`, `UserEditModal.tsx`, `MergeUsersModal.tsx` |
| 1g | Profile & notification preferences | `pages/ProfilePage.tsx` |
| 1h | Sign in (also covers Forgot / Reset password) | `pages/LoginPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` |

## Design Tokens

Replace the current `:root` block in `styles.css` with these. Names are suggestions;
values are not negotiable.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| `--canvas` | `#F7F4EF` | app background behind content |
| `--canvas-deep` | `#F2EEE7` | page/desk background, neutral chip fill |
| `--surface` | `#FFFFFF` | cards, sidebar, table body |
| `--surface-sunk` | `#FAF8F5` | table header row, group header |
| `--border` | `#E7E1D8` | 1px borders on cards, inputs, table frame |
| `--border-soft` | `#F0EBE4` | internal dividers inside a card |
| `--row-line` | `#F5F1EA` | between table rows |
| `--border-dashed` | `#DDD5CA` | dashed drop zones and "+ Filter" affordance |
| `--ink` | `#211D19` | primary text, dark buttons |
| `--ink-2` | `#3D3731` | body prose (descriptions, comments) |
| `--ink-3` | `#5C554D` | secondary text, inactive nav labels |
| `--muted` | `#7D746A` | captions |
| `--muted-2` | `#8A8177` | meta, uppercase labels |
| `--faint` | `#A49A8E` | placeholders, completed/struck text |
| `--faint-2` | `#C9C1B6` | disabled glyphs, lowest-priority bars |
| `--accent` | `#0F7B6C` | primary actions, links, active nav, In Progress |
| `--accent-deep` | `#0B5F54` | text on accent-soft, hover |
| `--accent-soft` | `#E3F2EF` | active nav background, In Progress pill, avatar |
| `--accent-tint` | `#F4FAF8` | unread notification row |
| `--accent-mid` | `#3D8579` | supporting text on accent surfaces |
| `--warn` | `#B8720A` | On Hold dot, High priority, attention bar |
| `--warn-deep` | `#8C5606` | text on warn-soft |
| `--warn-soft` | `#FDF0DC` | On Hold pill, attention tile |
| `--warn-tint` | `#FEFAF7` | row needing attention |
| `--danger` | `#B3452F` | overdue, Urgent priority, unread badge |
| `--danger-deep` | `#93361F` | text on danger-soft |
| `--danger-soft` | `#FBE6E0` | Overdue pill, overdue tile, Inactive badge |
| `--ok` | `#2F7D4F` | completed checkbox fill |
| `--ok-deep` | `#256240` | text on ok-soft |
| `--ok-soft` | `#E2F0E6` | Completed pill, Active badge |
| `--review` | `#7857C8` | Review status dot |
| `--review-deep` | `#5B3F96` | Review pill text, Admin role badge text |
| `--review-soft` | `#ECE6F8` | Review pill, Admin role badge |
| `--info-soft` | `#E9F2FB` / text `#2D557F` / dot `#3B6EA5` | session-expiry notice |

Sign-in panel only: solid `--accent` field, `#BFE0DA` body copy, `#8FC5BC` stat
labels, `#3D9488` dividers.

### Typography

Google Fonts, three families, loaded once in `index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Instrument+Serif&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- **Plus Jakarta Sans** — the entire interface.
- **Instrument Serif** (400) — exactly one warm line per screen: the My Day greeting
  (32–34px) and the sign-in headline (40px/1.15). Never for UI chrome.
- **IBM Plex Mono** (400/500) — task ids, timestamps, counts, emails, uppercase
  section labels. Numbers must align and must not read as prose.

Scale actually used:

| Role | Spec |
| --- | --- |
| Serif hero | 400 40px/1.15 Instrument Serif, `-0.01em` |
| Serif greeting | 400 32–34px/1.1 Instrument Serif |
| Page title | 700 22px Plus Jakarta, `-0.015em` |
| Task detail title | 700 25px/1.2 Plus Jakarta, `-0.02em` |
| Card title | 700 13.5–15px Plus Jakarta |
| Stat number | 700 20px (strip) / 700 30px (tile) Plus Jakarta, `-0.02em` |
| Body prose | 400 13.5px/1.6 Plus Jakarta, `text-wrap: pretty` |
| Row title | 600 13.5px Plus Jakarta |
| Table cell | 500 12.5px Plus Jakarta |
| Nav item | 500 13.5px (active 600) Plus Jakarta |
| Button label | 600 12.5–13px Plus Jakarta |
| Field label | 600 12px Plus Jakarta |
| Pill / chip | 600 11.5–12.5px Plus Jakarta |
| Section label | 600 11px IBM Plex Mono, uppercase, `0.12em` |
| Table header | 600 10.5px IBM Plex Mono, uppercase, `0.1em` |
| Meta / timestamp | 400 11.5–12.5px IBM Plex Mono |

Minimum body size anywhere is 11px (meta only); no interface text below 12px.

### Geometry

Radii: `4px` checkbox · `6–8px` chip/tag · `9–10px` button, nav item, input ·
`11–12px` card · `14px` outer frame · `999px` pill/avatar/toggle.
Spacing: 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 32px.
Shadow: only `0 1px 2px rgba(33,29,25,0.04)` on outer frames. No other shadows.
Borders are always 1px solid `--border`; focused inputs are 1.5px `--accent`.

## Global patterns

### App shell (replaces the current top bar in `Layout.tsx`)

Fixed 232px left rail, `--surface`, 1px right border, `padding: 20px 14px`,
`display:flex; flex-direction:column; gap:24px`.

1. Brand: 26px `--accent` rounded square (8px) with white 700 13px "H", plus
   "Healthy Tasks" at 700 15px `-0.01em`.
2. Primary nav: My Day · Notifications · All tasks. Item = `padding:8px 10px`,
   radius 9px, 500 13.5px `--ink-3`. Active = `--accent-soft` fill, `--accent-deep`
   text, weight 600. The Notifications item carries the unread count as a
   `--danger` pill (600 11px mono, white, `padding:1px 6px`) pushed right with
   `margin-left:auto` — this replaces `NotificationBell`.
3. `VIEWS` group, label 600 10.5px mono uppercase `0.12em` `--faint`, `padding:0 10px`.
   Items are 500 13px with a 7px 2px-radius colour square and a right-aligned mono
   count. Each is a saved `TaskSearchFilters` shape, not new backend work:
   - Overdue → `{ overdue: true }` (`--danger`)
   - Assigned to me → `{ assigneeIds: [me] }` (`--accent`)
   - Needs my review → `{ statuses: ['Review'], assigneeIds: [me] }` (`--review`)
   - Blocked → tasks with an incomplete `isBlockedBy` (`--warn`)
   - Created by me → creator = me (`--faint`)
4. `ADMIN` group with Users, rendered only for `role === 'Admin'` (unchanged rule).
5. User chip pinned with `margin-top:auto`: `--canvas` fill, radius 10px, 28px
   initials avatar, display name 600 12.5px over role 400 11px `--muted-2`.
   Replaces the current `email · role` link. Log out moves into Profile.

Nav is identical for every role. Only the Admin group and the team strip on My Day
are conditional.

### Person rendering — replaces raw emails everywhere

Circular initials avatar + display name. Sizes: 20px (inline chip), 22px (table
cell), 24–26px (list row), 28px (nav), 30px (users table, comment), 56px (profile).
Fill/text pairs, assigned deterministically per user id:
`--accent-soft`/`--accent-deep`, `--canvas-deep`/`--ink-3`, `--review-soft`/`--review-deep`.
Font is 600, roughly 36% of the avatar diameter. Unassigned = `--canvas-deep` circle
with `?` in `--faint` and the label "Unassigned" in `--faint`.
`TaskUserRef` has no name fields today — either extend it with `firstName`/`lastName`
or resolve display names from the users list already fetched by `listActiveUsers()`.

### Dates — replaces every `toLocaleString()`

Two lines, relative first: primary 600 12px Plus Jakarta (`--danger-deep` when
overdue, `--warn-deep` when due today, else `--ink-3`), secondary 400 10.5–11px mono
`--faint` with the absolute value in `Jul 12, 7:00 PM` form. Wording: `Overdue 17d`
(list) / `Overdue 17 days` (detail), `in 3 hours`, `Today, 2:00 PM`, `Thursday`,
`Next Monday`, `done Mon`, `22m ago`, `now`. Inline single-line contexts use just the
relative form. Never render a machine timestamp as the primary value.

### Status pills — from `TASK_STATUS_LABELS`, not invented

`display:inline-flex; align-items:center; gap:6px; padding:4px 9px` (5px 10–11px at
detail size), radius 999px, 600 11.5–12.5px, with a leading 6–7px dot.

| Status | Fill | Text | Dot |
| --- | --- | --- | --- |
| `Open` | `#EEEAE4` | `--ink-3` | `--faint` |
| `InProgress` | `--accent-soft` | `--accent-deep` | `--accent` |
| `OnHold` | `--warn-soft` | `--warn-deep` | `--warn` |
| `Review` | `--review-soft` | `--review-deep` | `--review` |
| `Completed` | `--ok-soft` | `--ok-deep` | `--ok` |
| `Canceled` | `--canvas-deep` | `--muted-2` | `--faint-2` |

**Overdue is not a status.** It is the derived `filters.overdue` condition and is
shown as a `--danger-soft` pill or as red date text — never in the status column.
"Blocked" likewise is a dependency condition (`isBlockedBy`), never a status label.

### Priority ramp — from `TASK_PRIORITIES`

Three bars, `align-items:flex-end`, `gap:2px`, widths 3px, heights 5/8/11px
(2.5px × 4/6.5/9px at chip size), radius 1px.

| Priority | Bars |
| --- | --- |
| `Low` | all three `--faint-2` |
| `Medium` | first two `--muted`, third `--border-soft` |
| `High` | all three `--warn` |
| `Urgent` | all three `--danger` |

Optional label alongside: 500 12.5px `--ink-3`; High/Urgent use 600 and their deep
colour. Completed rows render the ramp at `opacity:0.4`.

### Other primitives

- **Checkbox / complete toggle**: 16px square radius 4px (17px circle in My Day),
  1.5px `--faint-2` border; hover 1.5px `--danger`-tinted on overdue rows; checked =
  `--ok` fill with a white 7×3px rotated tick. Completed titles go 500 `--faint`
  with `line-through`.
- **Buttons**: primary `--accent` fill, white, 600 12.5–13px, `padding:8px 14px`,
  radius 10px. Secondary `--surface` fill, 1px `--border`, `--ink-3`. Tertiary
  `--canvas-deep` fill, no border (used for hover row actions, `padding:4–5px 9–10px`,
  radius 7–8px). Destructive uses `--danger`.
- **Input**: `--surface`, 1px `--border`, radius 10px, `padding:11px 13px`,
  400 13.5px; placeholder `--faint`; focus 1.5px `--accent`.
- **Toggle**: 30×18px (32×19px in settings) `999px` track — on `--accent`, off
  `#DDD5CA` — with a 14–15px white knob.
- **Tag chip**: `--canvas-deep`, `--ink-3`, 600 10.5–11.5px, `padding:3px 7px`,
  radius 6px. Overflow collapses to `+N` with the rest in `title`.
- **Filter chip (active filter)**: pill in the filter's own soft colour with a
  trailing `×` at `opacity:0.7`. `+ Filter` is a dashed `--border-dashed` pill.
- **Segmented control**: `--surface` + 1px `--border` + 2px padding, radius 9px;
  selected segment `--ink` fill, white text, radius 7px.
- **Empty state**: dashed `--border-dashed` box, 34px `--canvas-deep` rounded square,
  600 14px headline, 12.5px `--muted` explanation, then an `--accent` text action.
  Copy is specific and offers the next step ("Nothing overdue. Nice." / "Clear this
  filter to see the other 47 tasks.").
- **Transitions**: 150ms ease for hover, status change, completion and new comments.
  Nothing else animates.

## Screens

### 2a / 2b — My Day (`/`) — build from these two frames, not 1b

Replaces the current placeholder card, whose copy still says notifications and search
"arrive in later phases". Content column `padding:26–30px 32–34px`, `gap:20–24px`.

1. **Greeting row.** Left: Instrument Serif 32–34px "Good morning, Dana" over mono
   12.5px `--muted-2` "Wednesday, Jul 29 · 5 tasks due today". Right: a 280px
   `Add a task…` input (12px circle outline as the glyph) and a primary `New task`
   button. Quick-add stays a plain name field — natural-language parsing was
   explicitly deferred.
2. **Tile strip**, `grid-template-columns:repeat(4,1fr); gap:12px`, each
   `padding:16px 18px`, radius 12px, `gap:2px`: 700 30px number, 600 12.5px label,
   400 11.5px sub-line. Overdue = `--danger-soft`; Due today = `--warn-soft`;
   In Progress = `--accent-soft`; Completed today = `--surface` + border. All four
   come from the existing `TaskDashboardDto`; each tile applies its quick-filter and
   navigates to Tasks.
3. **Today list** (`1fr 356px` grid, `gap:20px`), card with header "Today" +
   mono count + `View all`. Row: `padding:12px 18px`, 12px gap — checkbox, priority
   ramp, title (600 13.5px, ellipsis), then either a due treatment or, on hover,
   `Snooze / Start / Reassign` chips, then the assignee avatar. Overdue rows sit on
   `--warn-tint`; completed rows strike through and drop to `--faint`.
4. **Right column**: "Waiting on you" (avatar + one-sentence event + mono relative
   time + `See all notifications (7)`) and "Next up this week" (44px mono day label,
   title, 7px status square).

Frame **2a** is a Member (Marcus Kane); frame **2b** is a Manager/Admin (Dana Reyes).
They are the same route, the same components and the same rail — build one screen.

Member-only differences: none. The rail omits the `ADMIN` group exactly as it does
today, and the copy in the day list happens to be their own tasks.

Manager/Admin additions, all conditional on `role !== 'Member'`:

1. A `MY TEAM` rail group — "Everyone reporting to me" (count of open tasks across
   direct reports) and "Their overdue" (`--danger` square). Both are
   `filters.assigneeIds = directReports` with `overdue` set on the second.
2. A **team strip** card between the tiles and the day grid: header "My team" +
   mono `4 people · 47 open` + `Open in All tasks`, then a
   `repeat(4,1fr)` grid of `--surface-sunk` cards (radius 10px, `padding:10px 12px`)
   holding a 28px avatar, name 600 12.5px over mono `9 open`, and a right-aligned
   status pill — `2 late` on `--danger-soft` or `on time` on `--ok-soft`, 700 11px.
   Clicking a card sets `filters.assigneeIds` to that person and navigates to
   `/tasks`; the counts are the existing overdue quick-filter tallied per assignee.
   Direct reports come from `UserDto.supervisorId` — no new endpoint.
3. The right column swaps "Next up this week" for **Needs my review**: mono id,
   task name, and the requester's avatar, from `{ statuses: ['Review'] }`.

The manager's own counts stay above the team strip: a Manager who is also a doer sees
their own work first. There is no separate manager screen and no permission branching
in the layout.

### 1c — Tasks (`/tasks`)

Today the page stacks title bar, dashboard card, search row, optional Columns panel,
header row and a per-column filter row before the first task. Collapse to:

1. **Toolbar**: title + mono total, 300px search input (with a `/` hint), then
   `Columns`, `Export`, and primary `New task`.
2. **Chip row**: List/Board/Calendar segmented control (Board, Calendar and Gantt are
   planned later — render as disabled-looking segments or omit until then), 1px
   divider, one removable chip per active filter, `+ Filter`, `Clear all`; right side
   shows `Sort: Due date ↑` and the `Nest sub-tasks` toggle. Filters stay
   `FilterPopover`s, but active state is now visible and reversible in one click.
3. **Stat strip**: the four-tile version of `TaskDashboard`, `padding:11px 14px`,
   700 20px number beside a 600 12px label. Parents-only / Children / Standalone move
   out of the dashboard and into the Views rail — they are navigation, not statistics.
4. **Table**: flex rows, not `<table>`, so cells can hold avatars and stacked dates.
   Widths: 16 checkbox · 48 id · flex name · 116 status · 40 priority · 146 assignee ·
   126 due · 150 tags, `gap:14px`, `padding:11px 18px`, rows separated by
   `--row-line`. Header is `--surface-sunk` with mono uppercase labels; sorting stays
   on the header (multi-sort unchanged). Nested children indent the name cell by 22px
   and dim to 500 `--ink-3`; the parent shows a `▾` caret and a mono `2 sub` hint.
   **The whole row navigates to the task** (currently only the small `#id` link does,
   and it opens a new tab); hover swaps the right-hand cells for
   `Set status / Assign / Due date / …`.
5. **Pager**: mono `1–25 of 213` left; rows-per-page, prev/next and `Page 1 of 9` right.

### 1d — Task detail (`/tasks/:id`)

Seven equal-weight cards become a `1fr 340px` split.

- **Top bar**: breadcrumb `All tasks / #482` (mono id), then `Remind me`, `Copy link`,
  `…` and a primary `Mark complete`.
- **Header**: title 700 25px with a persistent `Edit` chip (`--canvas-deep`,
  500 11.5px) — replaces the dashed hover outline, which is currently the only hint
  that fields are editable.
- **Property chip row**: status pill with a `▾`, priority chip, assignee chip
  (avatar inside the pill), due chip (`--danger-soft` when overdue), tag chips,
  `+ Tag`. Each edits inline and **saves immediately**. This removes the staged
  "Save changes" button and collapses three coexisting save models
  (inline name/description, staged five-field save, immediate tags/links) into one.
- **Tabs**: Work · Comments (n) · History (n). Active tab has a 2px `--accent`
  underline. History moves off the main column — 18 audit rows should not sit between
  the description and the comment box.
- **Main column**: Description card (13.5px/1.6, mentions as `--accent-soft` chips);
  Sub-tasks as a real checklist with `1 of 2 done`, a 120×5px progress bar and
  `+ Add sub-task`; Attachments as 30px type badges (PDF `--danger-soft`,
  XLS `--ok-soft`) with name + mono `size · uploader · date`, plus a 150px dashed drop
  zone; latest comment and a composer that mentions the `@` affordance.
- **Right rail** (`--surface`, 1px left border, `padding:24px 22px`, `gap:22px`,
  `--border-soft` dividers): Details (80px mono-ish labels for Start, Due, Creator,
  Created, Status set); Relationships (Parent, Blocked by on `--warn-soft`, Blocks,
  `+ Link a task`); Reminders using `REMINDER_LEAD_OPTIONS` labels; Recent activity
  with `See all history`.

### 1e — Notifications (`/notifications`)

Three tables (`Task Id / Task Name / When / From / Comment`) become one feed. Keep the
name **Notifications** — there is no email inbox.

- Header: title + mono `7 unread`, `Mark all read`, `Settings`.
- Type tabs as pills with counts: All / Mentioned / Assigned / Reminders — exactly the
  three `NOTIFICATION_LISTS` plus All. Right side: `Unread only` toggle
  (`MENTIONED_FILTERS` already supports all/unread/read).
- Day group headers (`Today`, `Yesterday`) on `--surface-sunk`, mono uppercase.
- Row: `padding:14px 18px`, `gap:12px` — 7px unread dot (accent for mentions/assigns,
  `--warn` for reminders), 32px avatar (or a `REM` badge on `--warn-soft` for
  reminders), then a sentence line (`**Marcus Kane** mentioned you on **#482 …**`) over
  a detail line: the comment body for mentions, `Due Friday, Aug 1 · Medium priority ·
  blocked by #482` for assignments. Right: mono relative time and, on hover,
  `Reply / Open / Snooze / Dismiss / Mark read`.
- Unread rows sit on `--accent-tint` (reminders `--warn-tint`); read rows drop to
  `--muted`/`--faint` with no dot. Click-through still marks read then navigates.
- Footer: `Updates every 30 seconds · Notification settings`.

### 1f — Users (`/admin/users`)

**The inline-editable grid is removed.** Every cell is currently a live input at rest,
which makes the screen read as a form and puts eight fields one keystroke from a
change. The roster becomes read-only and all editing runs through the existing
`UserEditModal`; the dirty-row tracking, per-row tint and Save-all bar all go away.

- Header: title + mono `34 active · 6 inactive`, 250px search, `Merge users`,
  primary `Add user`.
- Chip row: active filter chips + `+ Filter`, and `Sorted by name` on the right.
- Columns: flex Person · 96 Role · 190 Title · 190 Supervisor · 86 Status · 104 Last
  seen. Person merges Email + First + Last (three columns totalling 520px of the
  current 1380px table) into avatar + name over mono email — which is what removes the
  horizontal scroll `styles.css` currently works around. A `You` chip marks the
  current user.
- Role badges: Admin `--review-soft`/`--review-deep`, Manager `--accent-soft`/
  `--accent-deep`, Member `--canvas-deep`/`--ink-3`, all 700 11px radius 999px.
- Status is a badge (`Active` on `--ok-soft`, `Inactive` on `--canvas-deep`); inactive
  people dim their Person cell to `opacity:0.6` rather than `opacity:0.55` on the whole
  row, and carry an `Inactive` chip on `--danger-soft`.
- Hover replaces the right-hand cells with `Edit / Reset password / Deactivate / …`,
  so the pinned 170px Actions column is no longer needed.

### 1g — Profile & notification preferences (`/profile`)

`340px 1fr` grid.

- **Left card**: 56px avatar, name 700 17px, role badge, divider, then 82px-label rows
  for Email (mono), Title, Supervisor, Job role — all real `UserDto` fields
  (`jobDescription` is currently fetched but never shown). Buttons: `Change password`,
  `Log out`.
- **Right card**: "Notifications — Choose what reaches you, and where." with two 64px
  centred mono column heads, `In app` and `Email`. One row per `NOTIFICATION_LISTS`
  entry — Mentioned, Reminders, Assigned, exactly three, no more — each with a 600 13px
  title, a 12px `--muted-2` sentence explaining the trigger, and two toggles.
  Rows separated by `--border-soft`. When In-app is off, the Email toggle stays
  visible at `opacity:0.45` so the dependency is legible. Footer: "Changes save as you
  make them. Email goes to <address>." — matching the existing optimistic save.

### 1h — Sign in (`/login`, and the same frame for Forgot / Reset)

Two panels in a 1440×700 frame.

- **Left, 620px, `--accent` fill, `padding:48px 52px`**, space-between: brand lockup
  (white square, `--accent` "H"); headline Instrument Serif 40px/1.15 — "What to do,
  when to do it, and how close you are to smashing your growth goals today."; support
  line 14px/1.6 `#BFE0DA` max 420px; a footer stat row (213 open tasks · 34 people ·
  4 programs) at 700 22px white over 500 11.5px `#8FC5BC`, split by 1px `#3D9488`.
  The headline anticipates the goals/targets work planned for a later phase.
- **Right, `--canvas-deep`-adjacent `#FAF8F5`, centred 380px column**: "Welcome back"
  700 24px `-0.02em`; 13.5px `--muted` sub-line; the session-expiry notice as an
  `--info-soft` block with a 6px dot, reworded to reassure that unsaved edits were kept
  (which `useUnsavedChangesWarning` already delivers); Email input (mono value);
  Password input with a `Show` text toggle in `--accent` (keep the existing eye-icon
  behaviour if preferred); full-width primary `Sign in`; centred `Forgot your password?`;
  11.5px `--faint` footnote.
- Forgot and Reset reuse this exact frame with the form swapped.

## Interactions & Behaviour

- **Navigation**: row click → `/tasks/:id` in the same tab; tiles and Views apply a
  `TaskSearchFilters` shape and navigate to `/tasks`; notification click marks read,
  refreshes the bell count, then opens the task (unchanged logic).
- **Hover**: rows reveal quick actions in place of their trailing cells; nav items
  and secondary buttons lighten to `--canvas-deep`; sortable headers lighten.
- **Editing**: property chips on task detail save immediately and optimistically,
  with the existing error alert on failure. Users editing is modal-only.
- **Loading**: keep the current skeleton-free approach but show the mono
  `Loading…`/count in place rather than replacing the whole table.
- **Errors**: existing `.alert` treatments restyled to the soft colour pairs above.
- **Validation**: unchanged (`TASK_NAME_MIN_LENGTH`, Start before Due,
  `RICH_TEXT_MAX_CHARS`, `ATTACHMENT_MAX_BYTES`, merge type-to-confirm).
- **Persistence**: `task-search` and `users` screen state keep saving through
  `savePreference`; add the collapsed/expanded state of any new strip to the same blob.

## State Management

No new global state. New local state is limited to: hovered row id (for quick
actions), open property-chip editor on task detail, active notification type tab,
`unreadOnly` flag, and the manager team-strip visibility (derived from `role` and
`supervisorId`, not stored). Everything else already exists in the pages listed above.

## Assets

None. No images, no icon font, no SVG illustrations. Every glyph in the mock is a CSS
box: dots, squares, bars, the tick, the caret (`▾`/`▸`), arrows (`←`/`→`/`↑`), and
`×`/`…` as text. If an icon set is introduced later, keep it monoline at 1.5px and
inherit `currentColor`; do not switch to filled icons.

## Deliberate scope limits

- **Mobile is not covered.** Design phone screens separately if field staff need them.
- **Board, Calendar and Gantt views** are placeholders in the toolbar only.
- **Natural-language quick add** was considered and deferred.
- **Growth goals** appear only as a promise in the sign-in headline; the tile strip
  will need revisiting when that phase lands.

## Files

- `Healthy Tasks Redesign.dc.html` — all ten frames plus their rationale strips.
  Turn 2 (2a, 2b) sits at the top of the canvas and is the current My Day spec;
  turn 1 (1a–1h) is below it, and its 1b frame is the earlier first pass.
- `support.js` — local runtime required to render that file. Not part of the design.
