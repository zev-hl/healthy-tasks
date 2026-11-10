# HL Central redesign brief: Direction D1 "Harbor"

This file is the complete hand-off for building the HL Central redesign in the real app (React + Vite SPA). It records **decisions**. Where something was only discussed loosely it says so. Anything undecided is in **Open questions** (section 10). The working HTML prototypes are listed in section 2, and their CSS and shared JavaScript are copied in full at the end (Appendix A–E), so this file stands on its own.

The prototypes use **made-up names, teams and numbers** (Warehouse, Fleet, Nursing, Intake, Billing, HR; people like Maria Lopez, Zev H.; "today" = Wednesday Nov 5). Treat all of it as placeholder. Build against the real data in the app, and where the design needs data that does not exist, flag it rather than faking it (see section 10).

---

## 1. Summary

HL Central gets a **light, calm, highly readable** interface where the important things announce themselves. The CEO's complaint about the current app was *"I don't see anything here"*: there is no visual hierarchy and nothing stands out. The new look is **Google-like, polished, finished-looking, readable and noticeable**. It uses white cards on a cool blue-gray page, near-black text, one strong blue accent for actions and selection, and a deep navy sidebar. **Color carries meaning and nothing else**: red only for overdue or late, amber only for overloaded or blocked, green for done. Everything else stays neutral, so a red or amber mark is always the thing to look at. Numbers are clickable and filter what is below them. Controls are visible (not hidden behind hover), and dropdowns, the date picker and the apps launcher feel modern and rounded, never like the browser's default square popups.

Agreed adjectives: **readable, noticeable, polished, Google-like, finished, modern (not old-fashioned), calm, uses space wisely.**

Who it's for:
- **Supervisor / CEO:** a window into everyone who reports to them, drilling down Department > Team > Person. Red flags (overdue tasks, overloaded people) surface on their own.
- **Workers:** the same dashboard, but scoped to themselves, and fast to update their own tasks.

---

## 2. References

### Apps and products
| Reference | Take | Don't take |
|---|---|---|
| **Ticket** (the company's other app) | Same *family*: left navigation with icons, a nine-dot "All apps" grid. The CEO likes that it looks polished and Google-like. | Don't copy it outright. HL Central keeps **its own identity** (own accent, card style, labelled sidebar). |
| **Google** (overall polish; Google Apps launcher) | The "Google-like" readability and finish. The **All apps launcher behaves like Google's apps menu**: a popover grid of colored app tiles from a nine-dot button. | No Google branding or colors. |
| **Linear / Google Tasks** (task detail chips) | Named by the designer when modernizing the task header, and accepted by the user ("more modernized"): the task's key facts as one row of rounded, editable chips. | Their visual identity. |

### Design directions that were explored (for context)
- **A Signal (navy), B Fresh (emerald), C Midnight (dark):** rejected as too busy, and dark is out.
- **D "Clear":** neutral surfaces + one blue accent. Chosen as the base.
- D was themed three ways: **D1 Harbor (chosen)**, D2 Sage (teal on warm off-white, not chosen), D3 Plum (indigo on lavender-gray, not chosen).

### Prototype files (folder `2 - Direction D Clear + 3 color themes Harbor, Sage, Plum`)
**Current, authoritative.** Each opens straight from disk in a browser.
| File | What it shows |
|---|---|
| `D1-Dashboard.html` | Dashboard, two views (**My dashboard** / **My team**), Period toggle, clickable stat tiles, side panel (time tracker, quick add, due in next 7 days, activity; overdue by team), sidebar. |
| `D1-Tasks.html` | Task list: **My tasks / All tasks** tabs + **+ Add view**, slim filter-chip toolbar with Sort, full-width table with **inline quick edits** in every row, batch update bar, undo toast. |
| `D1-Task.html` | Single task page: compact header (title + property chips + big **time block**), review hand-off banner, description, checklist, linked tasks, files, activity/comments, **one Save bar**. Also used for **New task** (`#new`). |
| `d1-ui.js` | Shared: custom dropdown menus replacing every native `<select>` popup, the **calendar date picker**, and the **shared task timer** (+ sidebar running-timer pill). Appendix D. |
| `d1-apps.js` | Shared: Google-style **All apps launcher** popover. Appendix E. |
| `Main-redesign-brief.md` | An earlier, shorter brief. **Superseded by this file.** |

**Outdated, don't build from these.** They need a `support.js` runtime that isn't in the folder and show `{{…}}` placeholders when opened: `D-*.dc.html` (base D, original blue), `D1-Supervisor.dc.html`, `D1-Tasks.dc.html`, `D2-*.dc.html`, `D3-*.dc.html`. Useful only to see where the design started.

Deep links the prototypes support (mirror these as routes or query params):
- `D1-Dashboard.html#me` · `#team`
- `D1-Tasks.html#scope=mine|all&status=<filter>&owner=<initials>&team=<team>&dept=<dept>&pri=<High|Normal|Low>&q=<search>&task=<id>` (older `#view=overdue|mine|unassigned|done` also accepted)
- `D1-Task.html#id=<id>` · `#title=<title>` · `#new`

---

## 3. Design tokens

### 3.1 Colors (light theme only)
Core (CSS custom properties used in every prototype):
| Token | Hex | Role |
|---|---|---|
| `--bg` | `#EDF1F7` | Page background (cool blue-gray). Also search-field fill and row hover in some lists. |
| `--surface` | `#FFFFFF` | Cards, header bands, tables, menus. |
| `--text` | `#0F1B2D` | Primary text (near-black navy). |
| `--text-2` | `#3F4F66` | Secondary text, unselected tab text, neutral values. |
| `--muted` | `#5A6B82` | Labels, hints, timestamps, placeholders. (≥4.5:1 on white and on `--bg`.) |
| `--line` | `#D7DEE8` | Card borders, input borders, header bottom borders. |
| `--row` | `#D3DAE5` | Dividers **between rows** inside a card or table. Deliberately slightly darker than card borders (user asked for "slightly darker lines between rows"). |
| `--track` | `#E6EBF2` | Neutral fills: progress tracks, segmented-control background, grey pills, count badges. |
| `--accent` | `#1F5FBF` | Primary: buttons, links, active selection, focus ring, checkboxes. |
| `--accent-dk` | `#174A96` | Primary hover, link text, active tab text, batch bar background. |
| `--accent-deeper` | `#12397A` | Selects inside the batch bar. |
| `--accent-soft` | `#DCE8F8` | Soft accent fill: "In progress" pill, selected states, focus halo (3px). |

Sidebar:
| Token | Hex | Role |
|---|---|---|
| `--side` | `#14264A` | Sidebar background (deep navy). Also "HL" text on the white logo tile. |
| `--side-text` | `#C9D4E8` | Sidebar item text / icons. |
| `--side-muted` | `#B9C6DE` | Account role text. |
| active item | `rgba(255,255,255,.16)` bg, `#FFFFFF` text, inset 3px left bar `#7FB0FF` | Current page. Hover: `rgba(255,255,255,.12)`. |

Meaning colors. **Reserved: never use them decoratively.**
| Meaning | Text | Fill | Border / bar |
|---|---|---|---|
| **Overdue / late / danger** (red) | `#B42318` | `#FCE8E6` | `#E5B4B4` (card border when someone has overdue work) |
| **Overloaded / blocked / warning** (amber) | `#7A4D00` | `#FFF0CC` | bars `#B86E00`, border `#EAD2A2` |
| **Done / success** (green) | `#1B6B2E` | `#E3F3E6` | (approved panel border `#BFE0C6`, text `#24502F`) |
| **Info / in progress** (blue) | `#174A96` | `#DCE8F8` | |
| Notification dot | `#D92D20` with 2px white ring | | |
| **Running timer** | `#B42318` text, dot `#D92D20` (sidebar pill dot `#FF7A6E`) | `#FFF5F4` | `#F3B4AE`; Stop button solid `#B42318` (hover `#9A1D14`) |

Status (pills and selects):
| Status | Fill | Text | Dot (in menus) |
|---|---|---|---|
| To do | `#E6EBF2` | `#3F4F66` | `#8A9AB0` |
| In progress | `#DCE8F8` | `#174A96` | `#1F5FBF` |
| Blocked | `#FFF0CC` | `#7A4D00` | `#B86E00` |
| Done | `#E3F3E6` | `#1B6B2E` | `#1B6B2E` |

Priority: **High** = text `#B42318` (dot `#B42318`). **Normal** = `#3F4F66` (dot `#8A9AB0`). **Low** = `#5A6B82` (dot `#C9D0DA`).

Other surfaces seen in the prototypes:
- Table header `#F4F7FB`.
- Row hover `#F6F8FB` / `#F8FAFC`.
- Selected row `#E9F1FC`.
- A non-default filter or active tile `#F5F9FE` with an accent border.
- Changed-row flash `#FFF6D6` (fades out).
- Time block at rest `#F4F7FB`.
- Review request panel `#F5F9FE`, border `#B7CDEE`.
- Toast `#0F1B2D` (success toast `#1B6B2E`).
- Hover border `#B9C4D4`. Dashed borders (unassigned avatar, add-step input, drop zone) `#B9C4D4`.
- Muted past days in the calendar `#9AA7B8`.

Avatar fills (initials in `#0F1B2D`, 700 weight): `#D4E3F7`, `#FFE0C7`, `#D8F0DF`, `#E8E2F8`, `#FFF0CC`, `#D7DEE8`. The signed-in user's avatar is `#FFE0C7` with text `#7A3A00`. Unassigned is a dashed circle `1.5px dashed #B9C4D4` with a "?".

File-type tiles (32px, 8px radius): PDF `#FCE8E6`/`#B42318` · XLS `#E3F3E6`/`#1B6B2E` · DOC `#DCE8F8`/`#174A96` · IMG `#E8E2F8`/`#5B2E8C` · other `#E6EBF2`/`#3F4F66`.

Apps launcher tile colors (bg / icon): blue `#D4E3F7`/`#174A96` · green `#D8F0DF`/`#1B6B2E` · purple `#E8E2F8`/`#5B2E8C` · peach `#FFE0C7`/`#7A3A00` · yellow `#FFF0CC`/`#7A4D00` · grey `#E6EBF2`/`#3F4F66`.

All text meets **4.5:1** contrast (large text 3:1). Red and amber also differ in lightness, so they stay distinguishable for color-blind viewers.

### 3.2 Dark mode
**None.** The user said "not black background". Light only.

### 3.3 Typography
- **Family:** Inter (Google Fonts), weights **400 / 500 / 600 / 700**, falling back to `system-ui, sans-serif`. `-webkit-font-smoothing: antialiased`. One family everywhere.
- **Numbers:** `font-variant-numeric: tabular-nums` for times, due dates, counts in tables and the timer.

| Use | Size / weight | Notes |
|---|---|---|
| Task title (task page) | 26px / 600, letter-spacing −0.015em | Inline-editable field. 22px on phones. |
| Page title (h1) | 20px / 600, −0.01em | "Dashboard", "Tasks". |
| Period heading (dashboard) | 18px / 600 | "Wednesday, Nov 5", "Week of Nov 3 – 9". |
| Section heading (h2) | 16px / 600 | "Needs your attention", "My tasks". |
| Card title (h3) | 15px / 600 (dashboard), 14px / 600 (task-page cards) | |
| Body / table text | 14px / 400–500 | Line-height 1.5 (comments), 1.55 (description). |
| Secondary text | 13px | Meta lines, hints, chips text. |
| Small | 12px | Timestamps, card hints, pills. |
| Field label | 11px / 600, UPPERCASE, letter-spacing .04em, `--muted` | Above filter selects; table headers use 12px uppercase. |
| Stat tile value | 28px / 700, −0.02em, line-height 1.15 | |
| People-card numbers | 22px / 700, −0.02em | |
| Timer value (task page) | 30px / 700, −0.02em, tabular | The biggest number in the task header. |
| Timer clock (dashboard) | 28px / 700, tabular | |
| Sidebar items | 14px / 500 (active 600) | Brand "HL Central" 15px / 600. |

### 3.4 Spacing, radii, shadows, motion
**Spacing:** 4px base. Common steps are 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 32.
- **Page and header padding:** content is 32px on the sides (16px on phones), 16–24px top, 40px bottom. Headers are 14px 32px, the task header 22px 32px 20px.
- **Cards:** content 18px on the sides. The card head is 14px 18px 10px.
- **Gaps:** 12–16px between cards, 20–24px between columns and sections.
- **Rhythm:** tight inside a group, generous between groups, with more space above a heading than below it.

**Radii:** cards **12px**; inputs and selects **10px**; buttons **8px** (header buttons 10px, timer button 12px); chips, pills, tabs' count badges, segmented items **999px / 8px** (segmented items are 8px inside a 10px track); dropdown menus **12px**; apps launcher **16px**; time block **16px**; logo tile **10px**; menu rows **8px**.

**Shadows** (always offset plus soft blur, never hard or neon):
- Card hover `0 4px 14px rgba(15,27,45,.06)` (plus border `#B9C4D4`).
- Segmented active item `0 1px 2px rgba(15,27,45,.12)`.
- Dropdown menu `0 16px 40px rgba(15,27,45,.18), 0 2px 6px rgba(15,27,45,.06)`.
- Apps launcher `0 18px 48px rgba(15,27,45,.20), 0 2px 6px rgba(15,27,45,.06)`.
- Batch bar `0 10px 24px rgba(23,74,150,.25)`. Save bar `0 12px 30px rgba(23,74,150,.3)`.
- Toast `0 12px 32px rgba(15,27,45,.28)`.
- Start timer `0 6px 14px rgba(31,95,191,.25)`. Stop `0 6px 14px rgba(180,35,24,.25)`.
- **Focus:** a 2px `#1F5FBF` outline with a 2px offset, or a 3px `#DCE8F8` halo on fields.

**Motion:**
- **Hover and state changes:** 0.12–0.15s ease.
- **Panels:** dropdowns fade and move up 4px over 120ms; the apps launcher scales from 0.97 over 140ms.
- **Changed rows:** a 1.4–1.6s yellow flash that fades.
- **Live timer dot:** a 1.6s opacity pulse, used only for a timer that really is running.
- **Reduced motion:** all of the above respect `prefers-reduced-motion` (turned off).

---

## 4. Layout and navigation

**App shell:**
- **Left sidebar:**
  - **Size:** 232px wide, deep navy `#14264A`, padding 16px 12px. It's **sticky and exactly the window height (100vh)**, so its bottom items never need scrolling.
  - **Top:** a white 36px "HL" logo tile (10px radius) with "HL Central".
  - **Items, each with icon + label:** Dashboard · Tasks · Time · Reports · People. No grouping. Items are 40px tall, 12px horizontal padding, 8px radius, with a 20px icon and a 12px gap.
  - **Bottom (pushed down by a spacer):**
    - the **running-timer pill** (only while a timer runs, see §6.4);
    - the **All apps** button (nine-dot icon), which opens the launcher;
    - the **account card**: 32px avatar, "Zev H." 14px/600, role "Supervisor" 12px, with a thin line above it (`rgba(255,255,255,.12)`).
- **Page header (white band, bottom border `--line`):** page title + one-line subtitle on the left, a **segmented view switch** next to it, then search, the primary **New task** button, and (on the Dashboard) a notifications bell with a red dot.
- **Content:** max width **1760px**.
  - **Two columns** from **1360px** viewport width: main work on the left, a **360px** side panel on the right (**400px** from 1700px). Below that the side panel stacks under the main content.
  - The goal throughout is **no wasted empty space on the right**.

**Small screens:**
- **Below 820px:** the sidebar becomes a **top bar with icons only** (labels, spacer and account text hidden), and page padding drops to 16px.
- **Task-page chips** wrap onto more lines, and the time block moves under the title below 980px.
- **Tables** keep a minimum width (700–860px) and scroll sideways.
- **Not tested:** phone width was **not tested** in a browser (see Open questions).

---

## 5. Components

### Buttons
- **Primary:** `#1F5FBF` fill, white 14px/600 text, 40px tall, 16px padding, 10px radius; hover `#174A96`. Used for New task, Approve, Post comment, Save in forms.
- **Secondary:** white, 1px `--line` border, `--text-2` 13px/600, 36px tall, 12px padding, 8px radius; hover fill `--bg`.
- **Success-outline** (Mark done, Done on a row): green text `#1B6B2E`; on hover it fills green with white text.
- **Ghost / link:** no border, accent text (sometimes underlined): "Clear", "Show all open", "Undo".
- **Icon button:** 36–40px square.
- **Disabled:** 55% opacity, default cursor (for example, Reset on the dashboard when nothing is filtered).
- **Focus:** 2px accent outline.

### Inputs
- **Size and shape:** 40px tall (38 in filter bars), 10px radius, 1px `--line` border, 14px text.
- **Focus:** border `#1F5FBF` plus a 3px `#DCE8F8` halo.
- **Text:** placeholder `--muted`.
- **Search:** filled `--bg`, turns white on focus, with a 16px magnifier icon.
- **Textareas:** same style, vertical resize only.
- **Checkboxes:** 18px with `accent-color #1F5FBF`. Each is wrapped in a 52×52 hit area in tables.
- **Toggle switch** (prototype only, later replaced by a chip): 38×22 track `#C9D0DA`, accent when on.

### Dropdowns / selects (decided: **never show the browser's native popup**)
- **Menu:** every select opens a custom menu, white with a 12px radius, 6px padding and the dropdown shadow.
  - **Rows:** 36px tall, 8px radius, 14px text.
  - **Highlight and choice:** hover or keyboard highlight is `--bg`. The current choice is bold accent text with a ✓ on the right.
  - **Placement:** it opens 6px below the control and flips above if there's no room. Minimum width is the control's width or 200px.
- **Leading visuals:** a colored dot for status and priority options; a 24px initials avatar for people (dashed "?" for Unassigned).
- **Search:** lists with **more than 8 items** get a search box at the top ("Search…", 34px, filled `--bg`).
- **Keyboard:** Enter/Space/↓/↑/F4 opens; ↑/↓, Home/End move; typing jumps to a match; Enter picks; Esc closes and returns focus; Tab closes.
- **Underneath:** the native `<select>` still holds the value and fires `change`. In React, build a Select/Menu component with this behavior (a headless library is fine, but match the look).
- **Sizing:** chip-style selects are sized to the value they show, not to their longest option, so the ▾ sits next to the value.

### Date picker (decided: **every due-date field opens a calendar**, not a list)
- **Popover:** 292px wide.
- **Header:** ‹ Month name ›, with arrows disabled at the ends of the allowed range (the prototype allows Oct–Dec).
- **Grid:** weekday row S M T W T F S (11px/600 muted), then round 36px day buttons. **Today** gets a 1.5px accent ring, bold and accent-colored. The **selected day** is filled `#1F5FBF` with white text. **Past days** are `#9AA7B8`; weekends are muted.
- **Quick picks:** under the grid, after a top divider, 30px pills: **Today · Tomorrow · Friday · Next week**.
- **Overdue note:** if the task is late, a line shows "Currently Oct 27, 9 days overdue".
- **Keyboard:** arrows move by day or week, PageUp/PageDown by month, Enter picks, Esc closes.

### Tables / lists
- **Header:** `#F4F7FB` background, 12px uppercase 600 muted text, 42px tall. Header cells are buttons that **sort** (an arrow ↑/↓ on the active column, which is accent-colored).
- **Rows:** separated by `--row` lines, hover `#F8FAFC`, selected `#E9F1FC`, and a yellow flash after a change.
- **Inline quick edits:** see Tasks (§6.2).

### Cards
- **Look:** white, 1px `--line`, 12px radius. On hover the border goes to `#B9C4D4` with the soft shadow.
- **Head:** 28px rounded-square icon tile (8px radius, meaning color) + 15px/600 title + right-aligned big count or small hint.
- **Rows inside** are separated by `--row`. The first row has no top border, so there's no doubled line under the head.
- **No nested cards.** **No thick colored left edges** on cards, callouts or alerts: this is a hard rule from the design review. Use a tinted surface plus a 1px border instead.

### Badges and pills
- **Status pill:** 12px/600, 3px 9px padding, fully rounded, colors as in §3.1.
- **Count badge** (tabs): 11px/700, 1px 6–7px padding, `--track` fill, red tint when the count is a red flag.
- **Flag pills on people cards** keep the numbers, for example "3 overdue · 9 open vs 6" or "4 overdue, oldest 9 days".
- **Task-page flags** (Done, Private, "New, not saved yet"): 26px tall pills.

### Tabs and segmented controls
- **Segmented** (Dashboard view switch, Period toggle, launcher): `--track` track with 3px padding and 10px radius. Items are 34px tall with 8px radius. The active item is white, 600 weight, with a light shadow.
- **Underline tabs** (Tasks views): 44px tall, 14px text. Active: accent text, 600, 2px accent underline, count badge in `--accent-soft`.

### Modals
- **No modals are designed.** Everything that could have been a modal is inline: quick add, saving a view, the review hand-off, the More menu. Don't add modals unless something truly needs to interrupt.

### Toasts
- **Look and place:** bottom-center, dark `#0F1B2D` (or green for success), white 14px text, 12px radius.
- **Content:** an **Undo** button whenever the action can be undone, and a dismiss ×.
- **Timing:** auto-hides after about 4.5–7s.
- **Copy:** says exactly what happened, for example: "“Restock bay 4 pallets”: status set to Blocked · it no longer matches this view".

### Empty states
- **Words, never a blank area.** For example: "Nothing overdue in this view." (green check, success color), "You are all caught up.", "No one is over their team's median.", "No tasks match these filters." plus a **Clear search and filters** button, and "Nothing linked yet.".

### Avatars and icons
- **Avatars:** initials circles (24 / 26 / 28 / 30 / 32 / 36px) in the fills from §3.1, with stacked watchers overlapping by −6px with a 2px white ring.
- **Icons:** inline SVG line icons in a **Feather / Lucide style**: 24 viewBox, `stroke="currentColor"`, round caps and joins, stroke 1.8 (navigation) to 2–2.6 (small UI).
- **Icon set:** the prototypes hand-author the paths. Using **lucide-react** in the build would match (see Open questions).
- **No emoji or Unicode glyphs as icons**, except the ✓ / ↑ / ↓ / × characters used in a few text labels.

---

## 6. Screens (priority order)

### 6.1 Dashboard (`D1-Dashboard.html`): the CEO's first impression
**Title:** "Dashboard". **Header switch:** **My dashboard | My team**, each with a red count badge of what needs attention. The app remembers the last view and it can be deep-linked.

**Period toggle**
- **Where:** a small segmented **Today · This week · This month** on the line just above the stat tiles, with the range as the heading ("Wednesday, Nov 5" / "Week of Nov 3 – 9" / "November so far") and a hint ("Click a number to filter your tasks").
- **Changes with the period:** due, done, time logged and activity.
- **Doesn't change:** current-state numbers (open, overdue, in progress, blocked, overloaded).
- **Remembered:** the choice is kept when switching views.

**My dashboard** (always the signed-in person, so **no "Showing: Me" bar and no person filter**)
- **Stat tiles:**
  - **Row:** auto-fit, minimum 124px, 12px gap, all on one row at 1440px.
  - **Tiles, task counts only:** Open · Overdue (red when above 0) · Due today/this week/this month · In progress · Blocked (amber) · To review · Done (period). **Time is not a tile.**
  - **Tile style:** 14px 16px padding, 12px radius, 12px/600 label, 28px/700 value, 12px hint.
  - **Clicking:** a tile **filters My tasks**; clicking it again clears. The active tile gets an accent border, a `#F5F9FE` fill, a 2px soft ring, and the hint "Showing · click to clear". "To review" scrolls to and flashes the review card.
- **Main column:**
  - **Overdue, mine:** each row has a one-click **Done**.
  - **Waiting on your review:** Approve / Send back, each with Undo.
  - **My tasks:** a list with an **inline status dropdown** per row, a link "Open full list" (to Tasks › My tasks), and a "Showing Overdue · 2 of 9 · Show all open" note when filtered.
  - **Width:** the two cards sit side by side when wide (minimum 420px each) and stack otherwise.
- **Side panel:**
  - **Time tracker:** the shared timer, §6.4.
  - **Quick add:** title + a due date (calendar) + Add, which goes straight into My tasks.
  - **Due in the next 7 days:** open tasks after today, grouped by day ("Thu, Nov 6"). It was renamed from "Coming up" because that name was unclear.
  - **My activity:** a compact feed for the period.

**My team** (everyone who reports to the signed-in supervisor)
- **Filter bar:** Department > Team > Person (picking a team sets its department), "Showing Nursing team · 2 people" and **Reset**.
- **Stat tiles:** People · Open tasks · Overdue tasks · Overloaded · On track · Done (period). Overdue, Overloaded and On track filter the people cards.
- **Needs your attention:**
  - **Overdue tasks** grouped by owner, with a count pill and "oldest 9d late". A row opens Tasks filtered to that person's overdue tasks.
  - **Overloaded people:** open tasks against the team median, shown as an amber bar with a black median tick. **Overloaded = open ≥ 1.5 × team median** (not confirmed, see §10). A **Reassign tasks** link opens Tasks with the current scope.
- **People and load cards:** grid with a 228px minimum. Each card shows open / overdue / done (period), a red or amber border, and a flag pill that keeps the numbers. Clicking a card scopes the page to that person (accent ring), and clicking again clears.
- **Side panel:**
  - **Overdue by team:** bars, worst first; click a team to filter.
  - **Activity feed:** for the period, with "Today 11:42" / "Tue 16:20" / "Nov 1" time labels.

**Changed from the current app:** a real visual hierarchy, red flags that surface on their own, everything clickable, and the right side used.

### 6.2 Task list (`D1-Tasks.html`)
- **Header:** "Tasks" + subtitle ("Everyone who reports to you · 16 overdue"), search ("Search by title, #number or person"), **New task**.
- **View tabs** (underline style, directly under the header in the same white band):
  - **Built in:** **My tasks** and **All tasks**, each with an open count. Views are about *whose* tasks and which filters, **never statuses**.
  - **Your own:** saved views appear next, then **+ Add view**, which saves the current filters and sort under a name (inline name field + Save / Cancel).
  - **Changing a view:** a selected saved view shows a small × to delete it. When the filters differ from the selected view, the toolbar offers **Save as view** (built-in) or **Update "<name>"** (saved).
- **One slim toolbar row** above the table:
  - **Left:** the task count, then **filter chips**: pill-shaped, 32px, label + value + ▾, each sized to its value: **Status** (Open (default), Overdue, Due today, Due this week, To do, In progress, Blocked, Done, Any) · **Dept** · **Team** · **Owner** (hidden in My tasks) · **Priority**. A non-default chip gets an accent border and `#F5F9FE` fill. A **Clear** link appears when anything is non-default.
  - **Right end:** a **Sort** chip (Due date / Priority / Status / Owner / Team / Task name) plus a direction button ("↑ Soonest / ↓ Latest", "Highest / Lowest", "To do first / Done first", "A–Z / Z–A").
  - **Column headers** also sort.
- **Table**, full width with **no side panel** (decided: the stats panel and the "peek" panel were removed):
  - **Columns:** checkbox · **Task** (title link to the task page, with "#4412 · Warehouse" underneath) · **Owner** (avatar + name) · **Due** · **Status** · **Priority**.
  - **Quick changes happen in the row itself.** Owner, Due (calendar), Status (colored pill) and Priority are inline dropdowns that look like plain text or pills with a faint ▾ that strengthens on hover.
  - **After a change:** an **undo toast**, and if the task no longer fits the view the toast says so.
- **Batch update:** tick rows (header checkbox = all shown, with an indeterminate state) and a **sticky accent-dark bar** appears: "3 selected" · Status… · Assign to… · Due date… (calendar) · Priority… · Clear selection. Changes show a toast with Undo, and the changed rows flash.
- **Deep links:** dashboard rows open the right filtered list; `task=<id>` scrolls to and highlights a row.

### 6.3 Task detail page (`D1-Task.html`)
- **Sticky top bar:**
  - **Left:** "‹ Tasks / #4412" breadcrumb and a **‹ 2 of 28 ›** stepper through open tasks.
  - **Right:** a small red running clock (only while this task's timer runs), **Mark done** (or **Reopen**) and a **⋯** menu (Copy link, Duplicate task, Make private / Make visible to team, Delete task in red).
- **Task header** (a compact white band, decided after two rounds: *no boxed fact columns*, which looked old-fashioned):
  - **Left: title and meta.** Flags only when relevant (Done, Private, New). The **title** is a large inline-editable field. A meta line reads "#4412 · 2 of 4 steps done · Duty: <linked duty link> · created by Zev H. on Oct 24". The middle part is a plain-language status hint: "Not started", "2 of 4 steps done", "Waiting on a linked task" or "Waiting on your review".
  - **Left: one wrapping row of rounded 36px property chips.** Each chip *is* the editable value and opens the custom menu or calendar:
    - **Status:** a colored pill with a dot.
    - **Assignee:** avatar + name.
    - **Due date:** calendar icon. When late, the whole chip turns red-tinted with "Oct 31 · 5 days overdue".
    - **Priority:** a colored dot + "High priority".
    - **Team:** "Team Warehouse · Operations".
    - **Toggles:** after a thin divider, **Watching** (stacked watcher avatars) and **Visible to team / Private** (lock icon; accent-soft fill when private).
    - **Edited state:** an edited chip gets an accent ring and a small accent dot. At 1440px the chips fit on two lines.
  - **Right: the time block** (fixed **340px** wide so nothing shifts), the one big number in the header. Stopped and running states are in §6.4.
- **Review hand-off** (when someone sent this task to the viewer for review): directly under the header, a **lightly tinted accent panel** (`#F5F9FE`, 1px `#B7CDEE`), with no thick colored edge.
  - **Content:** the sender's avatar and "Dev Kaur marked this done and sent it to you for review at 11:42. Approve it, or send it back to In progress with a note." with **Send back** and **Approve**.
  - **Approve:** the panel turns green.
  - **Send back:** the panel turns neutral, status goes back to In progress, and the cursor goes to the comment box.
  - **Undo:** both can be undone.
- **Body:** the work on the left and the conversation on the right, about 1.4 : 1, side by side from 1180px and stacked below. The old separate Details card was removed.
  - **Work column:**
    - **Description:** textarea.
    - **Checklist:** "2 of 4 done", progress bar, tick off, remove (× on hover), "+ Add a step, press Enter".
    - **Linked tasks:** Blocked by / Blocks / Related, each with the other task's status pill and ×. Link with two dropdowns: type + task, the task list searchable.
    - **Files:** typed file tiles, "240 KB · added by Maria Lopez · Oct 28", remove, and a dashed drop zone "Drop files here or browse".
  - **Activity card:**
    - **Comment box at the top:** "Write a comment… use @ to mention someone", Ctrl+Enter or **Post comment**. Comments **post right away**.
    - **Timeline:** comments (avatar, name, time) and events (small dot, "Maria Lopez changed status to In progress").
- **One Save for record fields** (kept from the original design):
  - **What it covers:** title, description, status, assignee, due date, priority, team and privacy go into a draft.
  - **The bar:** a **sticky accent-dark bar** at the bottom: yellow dot · "3 unsaved changes" · "status, due date, assignee" · "Ctrl + S" · **Discard** · **Save changes** (white button).
  - **Saving:** adds events to the activity and confirms "Saved … Everyone on Warehouse sees the update."
  - **Leaving:** leaving with unsaved changes asks first.
  - **Saved immediately instead:** checklist ticks, links, files and comments.
- **New task:** the same page at `#new`. The title field is empty and focused, and the bar reads "New task · Not created yet · Cancel · **Create task**". It refuses to create without a title ("Give the task a title first.").

### 6.4 Time tracking (shared across pages)
- **One timer for the whole app, one task at a time.**
  - **It keeps running** when you leave the task page, change pages or close the tab, until you press Stop. The user asked for this explicitly: the timer you start on a task must be visible on the Dashboard and must not stop when you leave the task.
  - **Switching tasks:** starting a timer on another task **stops and logs the first one**, with a toast: "Stopped the timer on “X” and logged 0h 12m. Now timing this task."
- **Where it shows:**
  - **Task page, stopped:** "Time logged" label, total in 30px tabular figures ("2h 40m"), "2 sessions", and a prominent accent **▶ Start timer** (44px, 12px radius).
  - **Task page, another task is being timed:** the hint reads "Timer is on <task link>" and the button reads **Switch here**.
  - **Task page, running:** the block turns red-tinted (`#FFF5F4` / `#F3B4AE`) with a pulsing dot, "Timer running", a large ticking **0:12:04** in red, "Plus 2h 40m already logged" and a solid red **■ Stop & log**. A small red clock also appears in the sticky top bar.
  - **Sidebar of every page:** a **running-timer pill** above All apps: red tint, pulsing dot, ticking time, and the task title. Clicking it opens the task. It's hidden on that task's own page.
  - **Dashboard → Time tracker card:** shows the same timer, "On <task link>", with a red **Stop and log**. When stopped, pick a task and **Start**. There's a progress bar against an 8h day, and the card head shows "3h 10m of 8h today", or the period total for week or month.
- **Logged time** is kept, so the task's "Time logged" and the Dashboard's "today" total add up.
- **Prototype storage:** the prototype keeps the timer in `localStorage` (`d1-timer`, `d1-timelog`). In the real app this should be **server-side, per user** (see §10). Prototype code is in Appendix D (`D1Timer`).

### 6.5 All apps launcher (`d1-apps.js`)
- **What it is:** **not a separate page** and no dimmed dashboard behind it. It's a **Google-style popover** that opens beside the sidebar's All apps button, bottom-aligned with it and growing upward into free space.
- **Look:** about 368px wide with a 16px radius.
- **Content:**
  - **Header:** "HL Central apps" + ×.
  - **"Find an app" search:** filters live; Enter opens the first match.
  - **3-column grid of app tiles:** a 48px rounded-square colored icon (14px radius) + label. The current app gets a double ring (white + accent).
  - **"Recent" list:** a colored dot, a title and a kind ("Task · Nursing", "Tasks · filtered", "Dashboard"), each linking to the right place.
- **Apps in the prototype:** Dashboard, Tasks, Time, Reports, People, Tickets, Schedule, Documents, Reviews, Settings. **Use the company's real list.** Apps not built yet do nothing.
- **Closing and keyboard:** closes on Esc, ×, or an outside click. Arrow keys move through the grid and focus returns to the button. On phones it drops below the top bar.

### 6.6 Other screens: not designed in this direction
Login, notifications (only the bell with a red dot exists), goals / Insights, Exclusives, admin (Departments & Duties, Organization), reports, People, My Time / Time review, Templates and Inbox were **not designed in D1**. A board, calendar or Gantt view of tasks was **not discussed**. Earlier, outside this direction, a review listed controls those screens must have. That list is in §10 as loose requirements.

---

## 7. Keep as-is
- **The real app's data, business rules and screens.** The redesign changes look and layout, not what the system does.
- **The family resemblance to Ticket:** left navigation and a nine-dot apps grid. Keep it, with HL Central's own identity.
- **One Save for task record fields**, with comments posting immediately.
- **The review hand-off rule** (a task sent for review is approved or sent back by the reviewer). The prototype only shows it, so keep the real app's logic.
- **Existing features listed in §10**, which the earlier review said must keep a visible control: dependencies, file upload, private tasks, sub-tasks, duty links, review, goals editing, department / duty admin, change supervisor, alert groups.

## 8. Remove or don't do
- **No dark theme** or black backgrounds. Directions A/B/C, D2 Sage and D3 Plum are not used.
- **Color:** no decorative color. Red, amber and green only carry meaning.
- **Dashboard:**
  - no **"Showing: Me · Zev H. / Supervisor" bar** on My dashboard;
  - no separate filter bar just for Period;
  - no **Time tile** in the task-count stat row.
- **Tasks:**
  - no status-named view tabs (status is a filter dropdown);
  - no right-hand stats panel and no "peek" quick-view panel (edit in the row instead);
  - no "Filter" button that hides filters, and no tall labelled filter bar with a separate sort row;
  - no saved views from before. The user's test view "1, 2, 3" was deleted, and saved views now live next to My tasks / All tasks.
- **Task page:**
  - no separate right-hand **Details card**;
  - no **boxed fact columns** in the header (too old-fashioned);
  - no duplicate "Overdue by N days" tag above the title (the red due chip says it).
- **Dropdowns:** no native browser select popups, and no date lists in place of a calendar.
- **All apps:** no separate apps page with a dimmed dashboard behind it.
- **"Coming up":** don't use this label. It's "Due in the next 7 days".
- **Design-review bans:** no thick colored left/right edges on cards, callouts or list items; no gradient text; no decorative glass or blur; no hard offset shadows; no emoji as icons; no modals for things that don't need to interrupt.

## 9. Priorities
**For the demo (the CEO is the audience):** the CEO should open HL Central and immediately *see* what needs attention.
1. **App shell:** sidebar (labelled, full-height), header pattern, design tokens, Inter.
2. **Shared components:** buttons, chips, pills, the custom Select/Menu, the calendar, toasts with undo, empty states.
3. **Dashboard:** My team first (red flags, drill-down, clickable tiles), then My dashboard, the Period toggle and the side panels.
4. **Tasks list:** view tabs + Add view, the chip toolbar + sort, inline row edits, batch bar.
5. **Task page:** header chips, time block, one Save, review hand-off, checklist, links, files, activity.
6. **Shared timer** (task page, sidebar pill, dashboard tracker).
7. **All apps launcher.**
8. **Then the screens in §6.6**, using this system.

## 10. Open questions
1. **"Overloaded" rule:** open tasks ≥ 1.5 × the team median. This was an assumption to confirm. Does the real data have team medians?
2. **Period definitions:** the prototype uses a Mon–Sun week and month-to-date. Confirm the real rule and the time zone.
3. **Data the design needs that may not exist:** a review queue ("Waiting on your review"), time sessions per task, watchers, linked duty, a private flag, departments above teams, and who reports to whom. Flag each that's missing instead of faking it.
4. **Statuses:** the prototype uses To do / In progress / Blocked / Done. If the real app has more (for example "In review"), map them to the color system: neutral for not started, blue for active, amber for blocked, green for done.
5. **Timer:**
   - The prototype keeps it in the browser. The real app should store it server-side so it follows the user across devices.
   - One timer at a time and "starting another stops and logs the first" were the designer's choice (the user asked only that it persist and show on the Dashboard). Confirm both.
   - Also confirm what happens on logout, and whether time logged under a minute rounds up to 1m (it does in the prototype).
6. **Hover vs visible controls:** an earlier spec said to keep Ticket's hover-only actions (for example the edit pencil). D1 makes controls visible: faint chevrons that strengthen on hover, with a × on hover only for checklist steps. Decide per control.
7. **Icon library:** the prototypes use hand-drawn Feather/Lucide-style paths. Using `lucide-react` is the suggested match, but it wasn't decided.
8. **Saved views:** where they're stored (per user on the server?), and whether they can be shared.
9. **Phones:** the rules exist (top bar with icons only, wrapping chips, stacked columns) but were never tested at phone width.
10. **Screens not designed in D1**, loosely required from an earlier review (only the controls were listed, not layouts):
    - **Task detail:** reviewer Approve / Send back (done in D1), Add dependency (done), Upload a file (done), a real Private toggle (done), sub-task titles that open the sub-task (sub-tasks not in D1).
    - **My Day / quick add:** a Duty chip next to Due and Priority (HL Central requires a duty on a task; D1's Quick add has no duty field yet), and a row menu on the task table.
    - **All tasks:** Group by control (not in D1).
    - **New task:** attach files.
    - **My Time:** a running-timer strip with Stop and log, and "Fix and resubmit" on a returned day.
    - **Time review:** each day's duties link to the entries.
    - **Insights / goals:** goal titles open the goal, and a row menu.
    - **Departments and Duties:** New department, Archive, Remove / Restore on holder rows.
    - **Organization:** a row menu with Change supervisor; names open the profile.
    - **Exclusives:** New alert group, a chevron per group, a Type selector on the setup card, a row menu on alerts.
    - **Also not designed:** login, notifications, reports, People.
11. **Board / calendar / Gantt views** of tasks: never discussed.
12. **Tasks list "Timing" badge** on the row of the task being timed: proposed, not built.

---

## Builder checklist
- [ ] Inter 400/500/600/700 loaded; tokens from §3.1 defined once (CSS variables or theme); light only
- [ ] Red, amber and green used only for late / overloaded-blocked / done; everything else neutral
- [ ] Sidebar: 232px navy, labelled items, sticky full height, All apps at the bottom, account card; becomes an icon top bar below 820px
- [ ] Page header pattern with segmented view switch; content max 1760px; side panel from 1360px
- [ ] Custom Select/Menu replaces every native select (dots, avatars, search over 8 items, ✓ on current, full keyboard)
- [ ] Calendar date picker on every due-date field (today ring, selected fill, quick picks, overdue note)
- [ ] Toasts with Undo; worded empty states; visible focus rings; reduced motion respected
- [ ] Dashboard: My dashboard / My team switch; Period toggle above the tiles; clickable tiles that filter; no "Showing me" bar; no Time tile; side panels
- [ ] My team: Department > Team > Person filters, overdue by owner, overloaded vs median, people cards, overdue by team
- [ ] Tasks: My tasks / All tasks tabs + Add view (save / update / delete); slim chip toolbar + Sort; full-width table with inline Owner / Due / Status / Priority edits; batch bar
- [ ] Task page: compact header with title, meta line and property chips; 340px time block; review panel; work | activity body; one Save bar with Ctrl+S and leave warning; New task mode
- [ ] Shared timer: survives page changes, one at a time, sidebar pill everywhere, dashboard tracker in sync, logged time adds up
- [ ] All apps: Google-style popover with search, 3-column grid, current-app ring, Recent, keyboard
- [ ] Deep links: dashboard rows open the filtered Tasks list; task links open the task page
- [ ] Real data only; anything missing from §10 flagged, not faked
- [ ] Checked at 1440px and 1920px wide; phone layout checked

---

# Appendices: prototype code (copied verbatim)

These are the working prototypes' styles and shared scripts, so the exact values travel with this brief. The page scripts themselves (data and render logic) are described in §6 rather than copied. The files are named in §2.

## Appendix A: `D1-Dashboard.html` styles

```css
/* ===== Harbor (D1) tokens ===== */
:root{
  --bg:#EDF1F7; --surface:#FFFFFF; --text:#0F1B2D; --text-2:#3F4F66; --muted:#5A6B82;
  --line:#D7DEE8; --row:#D3DAE5; --track:#E6EBF2;
  --accent:#1F5FBF; --accent-dk:#174A96; --accent-soft:#DCE8F8;
  --side:#14264A; --side-text:#C9D4E8; --side-muted:#B9C6DE;
  --red:#B42318; --red-soft:#FCE8E6; --red-line:#E5B4B4;
  --amber:#7A4D00; --amber-soft:#FFF0CC; --amber-line:#EAD2A2; --amber-bar:#B86E00;
  --green:#1B6B2E; --green-soft:#E3F3E6;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent-dk)}
button,select,input{font:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.shell{display:flex;flex-wrap:wrap;min-height:100vh}

/* ===== Sidebar: labelled, pinned to window height ===== */
.side{flex:0 0 232px;position:sticky;top:0;align-self:flex-start;height:100vh;background:var(--side);display:flex;flex-direction:column;gap:2px;padding:16px 12px;overflow-y:auto;z-index:2}
.side a{color:var(--side-text);text-decoration:none}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 18px;color:#FFFFFF !important}
.logo{width:36px;height:36px;flex:none;border-radius:10px;background:#FFFFFF;color:var(--side);display:grid;place-items:center;font-weight:700;font-size:13px}
.brand-name{font-size:15px;font-weight:600;letter-spacing:-.01em}
.nav-item{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;font-size:14px;font-weight:500;transition:background .15s ease,color .15s ease}
.nav-item svg{flex:none}
.nav-item:hover{background:rgba(255,255,255,.12);color:#FFFFFF}
.nav-item[aria-current="page"]{background:rgba(255,255,255,.16);color:#FFFFFF;font-weight:600;box-shadow:inset 3px 0 0 #7FB0FF}
.spacer{flex:1}
.account{display:flex;align-items:center;gap:10px;padding:14px 8px 8px;margin-top:8px;border-top:1px solid rgba(255,255,255,.12);color:#FFFFFF !important}
.account:hover{background:rgba(255,255,255,.06)}
.account .who{display:flex;flex-direction:column;min-width:0}
.account .who b{font-size:14px;font-weight:600}
.account .who span{font-size:12px;color:var(--side-muted)}

/* ===== Main ===== */
main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:14px 32px;background:var(--surface);border-bottom:1px solid var(--line)}
.title{display:flex;flex-direction:column;gap:2px;margin-right:4px}
.title h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.title span{font-size:13px;color:var(--muted)}
.seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--track)}
.seg button{height:34px;padding:0 14px;border:0;border-radius:8px;background:transparent;font-size:13px;font-weight:500;color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:background .12s ease}
.seg button:hover{color:var(--text)}
.seg button[aria-pressed="true"]{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(15,27,45,.12)}
.seg .count{font-size:11px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--red-soft);color:var(--red)}
.grow{flex:1 1 0}
.search{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);flex:1 1 220px;max-width:360px}
.search input{flex:1;min-width:0;border:0;background:transparent;font-size:14px;color:var(--text);outline:none}
.search input::placeholder{color:var(--muted)}
.btn-primary{height:40px;padding:0 16px;border-radius:10px;background:var(--accent);color:#FFFFFF;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;text-decoration:none;transition:background .12s ease}
.btn-primary:hover{background:var(--accent-dk);color:#FFFFFF}
.icon-btn{position:relative;width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;color:var(--text-2)}
.icon-btn .dot{position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:50%;background:#D92D20;border:2px solid #FFFFFF}

/* Filter bar */
.filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:14px 32px;background:var(--surface);border-bottom:1px solid var(--line)}
.field{display:flex;flex-direction:column;gap:4px;flex:1 1 160px;max-width:220px}
.field.sm{flex-basis:140px;max-width:180px}
.label{font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.select{position:relative;display:block}
.select select{appearance:none;-webkit-appearance:none;width:100%;height:40px;padding:0 32px 0 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);font-size:14px;font-weight:500;color:var(--text);cursor:pointer}
.select svg{position:absolute;right:12px;top:14px;pointer-events:none}
.scope{flex:1 1 220px;display:flex;align-items:center;justify-content:flex-end;gap:12px;min-height:40px}
.scope span{font-size:13px;color:var(--text-2)}
.scope strong{color:var(--text);font-weight:600}
.chip{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent-dk);font-size:13px;font-weight:600}
.chip.plain{padding:0 12px;background:var(--track);color:var(--text-2);font-weight:500}

/* Content */
.content{padding:20px 32px 40px;display:flex;flex-direction:column;gap:20px;max-width:1760px;width:100%}
.filters[hidden]{display:none}

/* Period line above the tiles */
.periodline{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.periodline h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em}
.periodline .small{font-size:13px}

/* Two columns on wide screens: main work + a side panel */
.cols{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start}
@media (min-width:1360px){.cols{grid-template-columns:minmax(0,1fr) 360px}}
@media (min-width:1700px){.cols{grid-template-columns:minmax(0,1fr) 400px}}
.col{display:flex;flex-direction:column;gap:24px;min-width:0}

/* Side panel pieces */
.timer{display:flex;align-items:center;gap:12px;padding:16px 18px 10px}
.clock{font-size:28px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.1}
.live{width:10px;height:10px;flex:none;border-radius:50%;background:#D92D20;box-shadow:0 0 0 4px #FCE8E6;animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.live{animation:none}}
.prog{display:block;height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.prog i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.pad{padding:0 18px 16px;display:flex;flex-direction:column;gap:8px}
.qa{display:flex;flex-direction:column;gap:8px;padding:14px 18px 16px}
.qa input{height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);font-size:14px;color:var(--text);outline:none}
.qa input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.qa input::placeholder{color:var(--muted)}
.qa-row{display:flex;gap:8px}
.qa-row .select{flex:1}
.day{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:12px 18px 2px}
.mini{display:flex;align-items:center;gap:10px;padding:8px 18px;font-size:14px;text-decoration:none;color:inherit}
.mini:hover{background:var(--bg)}
.mini .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini .time{width:auto;min-width:40px}
.teamrow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 18px;border:0;background:transparent;font-size:14px;color:var(--text);cursor:pointer;text-align:left}
.teamrow:hover{background:var(--bg)}
.teamrow[aria-pressed="true"]{background:#F5F9FE;box-shadow:inset 3px 0 0 var(--accent)}
.teamrow .nm{width:92px;flex:none;font-weight:500}
.teamrow .bar{flex:1}
.teamrow .bar i{background:var(--red)}
.teamrow .v{width:28px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.sec{display:flex;flex-direction:column;gap:12px}
.sec-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.sec-head h2{margin:0;font-size:16px;font-weight:600}
.sec-head span{font-size:13px;color:var(--muted)}
.sec-head a{margin-left:auto;font-size:13px;font-weight:600;text-decoration:none}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease}
.card:hover{border-color:#B9C4D4;box-shadow:0 4px 14px rgba(15,27,45,.06)}
.card-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.card-head h3{margin:0;font-size:15px;font-weight:600;flex:1}
.card-note{padding:8px 18px 4px;font-size:12px;color:var(--muted)}
.ic{width:28px;height:28px;flex:none;border-radius:8px;display:grid;place-items:center}
.ic.red{background:var(--red-soft);color:var(--red)} .ic.amber{background:var(--amber-soft);color:var(--amber)} .ic.blue{background:var(--accent-soft);color:var(--accent-dk)}
.big{font-size:22px;font-weight:700;letter-spacing:-.02em}
.row{display:flex;align-items:center;gap:12px;padding:12px 18px;text-decoration:none;color:inherit;transition:background .12s ease}
.row + .row{border-top:1px solid var(--row)}
a.row:hover,.row.hov:hover{background:var(--bg)}
.stack{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.name{font-size:14px;font-weight:600}
.name span{font-weight:400;color:var(--muted)}
.sub{font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub.late{color:var(--red);font-weight:500}
.right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none}
.small{font-size:12px;color:var(--muted)}
.av{flex:none;border-radius:50%;display:grid;place-items:center;font-weight:700;color:var(--text)}
.pill{flex:none;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px}
.pill.red{background:var(--red-soft);color:var(--red)} .pill.amber{background:var(--amber-soft);color:var(--amber)}
.pill.green{background:var(--green-soft);color:var(--green)} .pill.blue{background:var(--accent-soft);color:var(--accent-dk)} .pill.grey{background:var(--track);color:var(--text-2)}
.bar{position:relative;display:block;height:8px;border-radius:4px;background:var(--track)}
.bar i{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--amber-bar)}
.bar b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text)}
.empty{padding:22px 18px;font-size:14px;color:var(--green);display:flex;align-items:center;gap:8px}
.empty.neutral{color:var(--muted)}
.card-foot{padding:12px 18px;border-top:1px solid var(--row);display:flex;gap:8px}
.btn{height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none;transition:background .12s ease,color .12s ease,border-color .12s ease}
.btn:hover{background:var(--bg)}
.btn.link{color:var(--accent-dk)}
.btn.ok{color:var(--green)} .btn.ok:hover{background:var(--green);border-color:var(--green);color:#FFFFFF}
.btn.solid{background:var(--accent);border-color:var(--accent);color:#FFFFFF} .btn.solid:hover{background:var(--accent-dk)}
.btn.ghost{border-color:transparent;background:transparent;text-decoration:underline;color:var(--text-2)}

/* Stat tiles: click to filter */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:12px}
.tile{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:inherit;text-align:left;cursor:pointer;text-decoration:none;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.tile:hover{border-color:#B9C4D4;box-shadow:0 4px 14px rgba(15,27,45,.06)}
.tile .k{font-size:12px;font-weight:600;color:var(--text-2);display:flex;align-items:center;gap:6px}
.tile .v{font-size:28px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:var(--text)}
.tile .h{font-size:12px;color:var(--muted)}
.tile.red .v{color:var(--red)} .tile.amber .v{color:var(--amber)} .tile.green .v{color:var(--green)} .tile.blue .v{color:var(--accent-dk)}
.tile.red{border-color:var(--red-line)} .tile.amber{border-color:var(--amber-line)}
.tile[aria-pressed="true"]{border-color:var(--accent);background:#F5F9FE;box-shadow:0 0 0 2px var(--accent-soft)}
.tile[aria-pressed="true"] .h{color:var(--accent-dk);font-weight:600}
.filter-note{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
.filter-note strong{color:var(--text)}
.flash{animation:flash 1.2s ease}
@keyframes flash{0%,40%{box-shadow:0 0 0 3px var(--accent-soft);border-color:var(--accent)}100%{box-shadow:none}}
@media (prefers-reduced-motion:reduce){.flash{animation:none}}

/* People grid */
.people{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(228px,100%),1fr));gap:12px}
.pcard{display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:inherit;cursor:pointer;text-align:left;transition:border-color .15s ease,box-shadow .15s ease}
.pcard:hover{box-shadow:0 4px 14px rgba(15,27,45,.06)}
.pcard.late{border-color:var(--red-line)} .pcard.over{border-color:var(--amber-line)}
.pcard[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.pcard .top-line{display:flex;align-items:center;gap:10px}
.stats{display:flex;align-items:baseline;gap:16px}
.stat{display:flex;flex-direction:column}
.stat span{font-size:11px;color:var(--muted);font-weight:500}

/* Status select on My tasks */
.status{position:relative;flex:none}
.status select{appearance:none;-webkit-appearance:none;height:36px;min-width:128px;padding:0 28px 0 12px;border-radius:8px;border:0;font-size:13px;font-weight:600;cursor:pointer}
.status svg{position:absolute;right:10px;top:12px;pointer-events:none}
.st-todo{background:var(--track);color:var(--text-2)} .st-doing{background:var(--accent-soft);color:var(--accent-dk)}
.st-blocked{background:var(--amber-soft);color:var(--amber)} .st-done{background:var(--green-soft);color:var(--green)}
.dotmark{width:10px;height:10px;flex:none;border-radius:50%}
.due{flex:none;width:130px;text-align:right;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--muted)}
.due.late{color:var(--red)} .due.today{color:var(--text)}
.time{font-size:12px;color:var(--muted);width:72px;flex:none;font-variant-numeric:tabular-nums}
.act{flex:1;min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.act strong{font-weight:600} .act span{color:var(--text-2)} .act a{color:var(--text);text-decoration:none;font-weight:500}
.act a:hover{text-decoration:underline}

@media (max-width:820px){
  .side{flex:1 1 100%;position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;padding:8px 12px}
  .side .spacer,.side .lbl{display:none}
  .brand{padding:0 6px 0 0}
  .account{margin:0;border:0;padding:4px}
  .top,.filters{padding:12px 16px}
  .content{padding:16px 16px 32px}
  .due{width:auto}
}
```

## Appendix B: `D1-Tasks.html` styles

```css
/* ===== Harbor (D1) tokens ===== */
:root{
  --bg:#EDF1F7; --surface:#FFFFFF; --text:#0F1B2D; --text-2:#3F4F66; --muted:#5A6B82;
  --line:#D7DEE8; --row:#D3DAE5; --track:#E6EBF2;
  --accent:#1F5FBF; --accent-dk:#174A96; --accent-deeper:#12397A; --accent-soft:#DCE8F8;
  --side:#14264A; --side-text:#C9D4E8; --side-muted:#B9C6DE;
  --red:#B42318; --red-soft:#FCE8E6;
  --amber:#7A4D00; --amber-soft:#FFF0CC;
  --green:#1B6B2E; --green-soft:#E3F3E6;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent-dk)}
button,select,input{font:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.shell{display:flex;flex-wrap:wrap;min-height:100vh}

/* ===== Sidebar (same as Dashboard) ===== */
.side{flex:0 0 232px;position:sticky;top:0;align-self:flex-start;height:100vh;background:var(--side);display:flex;flex-direction:column;gap:2px;padding:16px 12px;overflow-y:auto;z-index:3}
.side a{color:var(--side-text);text-decoration:none}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 18px;color:#FFFFFF !important}
.logo{width:36px;height:36px;flex:none;border-radius:10px;background:#FFFFFF;color:var(--side);display:grid;place-items:center;font-weight:700;font-size:13px}
.brand-name{font-size:15px;font-weight:600;letter-spacing:-.01em}
.nav-item{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;font-size:14px;font-weight:500;transition:background .15s ease,color .15s ease}
.nav-item svg{flex:none}
.nav-item:hover{background:rgba(255,255,255,.12);color:#FFFFFF}
.nav-item[aria-current="page"]{background:rgba(255,255,255,.16);color:#FFFFFF;font-weight:600;box-shadow:inset 3px 0 0 #7FB0FF}
.spacer{flex:1}
.account{display:flex;align-items:center;gap:10px;padding:14px 8px 8px;margin-top:8px;border-top:1px solid rgba(255,255,255,.12);color:#FFFFFF !important}
.account:hover{background:rgba(255,255,255,.06)}
.account .who{display:flex;flex-direction:column;min-width:0}
.account .who b{font-size:14px;font-weight:600}
.account .who span{font-size:12px;color:var(--side-muted)}

/* ===== Header + view tabs (one white block) ===== */
main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;padding:14px 32px 6px;background:var(--surface)}
.title{display:flex;flex-direction:column;gap:2px;flex:1 1 200px}
.title h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.title span{font-size:13px;color:var(--muted)}
.search{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);flex:1 1 260px;max-width:420px}
.search:focus-within{border-color:var(--accent);background:var(--surface)}
.search input{flex:1;min-width:0;border:0;background:transparent;font-size:14px;color:var(--text);outline:none}
.search input::placeholder{color:var(--muted)}
.btn-primary{height:40px;padding:0 16px;border-radius:10px;background:var(--accent);color:#FFFFFF;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;text-decoration:none;transition:background .12s ease}
.btn-primary:hover{background:var(--accent-dk);color:#FFFFFF}

.tabs{display:flex;align-items:flex-end;gap:2px;padding:0 32px;background:var(--surface);border-bottom:1px solid var(--line);overflow-x:auto}
.tab{position:relative;height:44px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:transparent;font-size:14px;font-weight:500;color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.tab:hover{color:var(--text)}
.tab[aria-selected="true"]{color:var(--accent-dk);font-weight:600;border-bottom-color:var(--accent)}
.tab .n{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--track);color:var(--text-2)}
.tab[aria-selected="true"] .n{background:var(--accent-soft);color:var(--accent-dk)}
.tab-wrap{display:inline-flex;align-items:center}
.tab-del{width:24px;height:24px;margin:0 4px 0 -6px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center}
.tab-del:hover{background:var(--bg);color:var(--red)}
.addview{height:44px;padding:0 10px;border:0;background:transparent;font-size:14px;font-weight:600;color:var(--accent-dk);cursor:pointer;white-space:nowrap}
.addview:hover{text-decoration:underline}
.addform{display:inline-flex;align-items:center;gap:6px;height:44px}
.addform input{height:32px;width:170px;padding:0 10px;border-radius:8px;border:1px solid var(--accent);font-size:13px;outline:none}
.mini-btn{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer}
.mini-btn.solid{background:var(--accent);border-color:var(--accent);color:#FFFFFF}
.mini-btn:hover{filter:brightness(.97)}

/* ===== Content ===== */
.content{padding:16px 32px 40px;max-width:1760px;width:100%;display:flex;flex-direction:column;gap:12px}

/* One slim row: count, filter chips, sort */
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.count{font-size:13px;color:var(--muted);margin-right:4px;white-space:nowrap}
.count strong{color:var(--text);font-weight:600}
.chip{position:relative;display:inline-flex;align-items:center;gap:4px;height:32px;padding-left:12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:13px;color:var(--muted);white-space:nowrap;transition:border-color .12s ease}
.chip:hover{border-color:#B9C4D4}
.chip select{appearance:none;-webkit-appearance:none;height:30px;max-width:180px;padding:0 28px 0 0;border:0;background:transparent;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;outline:none}
.chip:focus-within{outline:2px solid var(--accent);outline-offset:1px}
.chip svg{position:absolute;right:11px;pointer-events:none}
.chip.on{border-color:var(--accent);background:#F5F9FE}
.chip.on select{color:var(--accent-dk)}
.dir{height:32px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap}
.dir:hover{border-color:#B9C4D4}
.clear{border:0;background:transparent;font-size:13px;font-weight:600;color:var(--accent-dk);text-decoration:underline;cursor:pointer;padding:0 4px}
.grow{flex:1 1 0}

/* Batch bar */
.batch{position:sticky;top:12px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px 10px 16px;border-radius:12px;background:var(--accent-dk);color:#FFFFFF;box-shadow:0 10px 24px rgba(23,74,150,.25)}
.batch .bcount{font-size:14px;font-weight:600;padding-right:6px}
.batch .div{width:1px;height:24px;background:rgba(255,255,255,.35)}
.batch .bsel{position:relative;display:inline-flex;align-items:center}
.batch select{appearance:none;-webkit-appearance:none;height:36px;padding:0 30px 0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:var(--accent-deeper);color:#FFFFFF;font-size:13px;font-weight:500;cursor:pointer}
.batch select:hover{border-color:#FFFFFF}
.batch .bsel svg{position:absolute;right:11px;pointer-events:none}
.batch .wbtn{height:36px;padding:0 12px;border-radius:8px;border:0;background:transparent;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline}

/* Table */
.table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow-x:auto}
table{width:100%;min-width:860px;border-collapse:collapse;font-size:14px}
thead th{background:#F4F7FB;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;text-align:left;padding:0;border-bottom:1px solid var(--line);white-space:nowrap}
thead th button.th{display:flex;align-items:center;gap:6px;width:100%;height:42px;padding:0 12px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;text-align:left}
thead th button.th:hover{color:var(--text)}
thead th[aria-sort="ascending"] button.th,thead th[aria-sort="descending"] button.th{color:var(--accent-dk)}
.cb{width:52px}
.cb label{display:flex;align-items:center;justify-content:center;width:52px;height:52px;cursor:pointer}
input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);margin:0;cursor:pointer}
tbody tr{border-top:1px solid var(--row);transition:background .12s ease}
tbody tr:first-child{border-top:0}
tbody tr:hover{background:#F8FAFC}
tbody tr.sel{background:#E9F1FC}
tbody tr.flash{animation:flash 1.6s ease}
@keyframes flash{0%,35%{background:#FFF6D6}100%{background:transparent}}
@media (prefers-reduced-motion:reduce){tbody tr.flash{animation:none}}
td{padding:6px 12px;vertical-align:middle}
td.cb{padding:0}
.t-title{color:var(--text);text-decoration:none;font-weight:500}
.t-title:hover{color:var(--accent-dk);text-decoration:underline}
.t-meta{display:block;margin-top:2px;font-size:12px;color:var(--muted)}

/* Inline quick-edit cells: look like text/pills, behave like dropdowns */
.ed{position:relative;display:inline-flex;align-items:center;max-width:100%}
.ed select{appearance:none;-webkit-appearance:none;max-width:100%;height:32px;padding:0 24px 0 8px;border:1px solid transparent;border-radius:8px;background:transparent;font-size:13px;font-weight:500;color:var(--text);cursor:pointer;text-overflow:ellipsis}
.ed svg{position:absolute;right:8px;pointer-events:none;opacity:.45;transition:opacity .12s ease}
.ed:hover select,.ed select:focus{border-color:var(--line);background:var(--surface)}
.ed:hover svg,tr:hover .ed svg{opacity:.9}
.ed select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ed.pill select{height:28px;padding:0 24px 0 10px;border-radius:999px;font-size:12px;font-weight:600}
.ed.pill:hover select{border-color:transparent;filter:brightness(.97)}
.st-todo{background:var(--track) !important;color:var(--text-2) !important}
.st-doing{background:var(--accent-soft) !important;color:var(--accent-dk) !important}
.st-blocked{background:var(--amber-soft) !important;color:var(--amber) !important}
.st-done{background:var(--green-soft) !important;color:var(--green) !important}
.ed.due.late select{color:var(--red);font-weight:600}
.ed.due.today select{font-weight:700}
.ed.pri.High select{color:var(--red);font-weight:600}
.ed.pri.Low select{color:var(--muted)}
.owner{display:flex;align-items:center;gap:6px;min-width:0}
.av{width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--text)}
.av.none{background:transparent;border:1.5px dashed #B9C4D4;color:var(--muted)}
.owner .ed select{padding-left:4px}
.empty{padding:40px 18px;text-align:center;color:var(--muted);font-size:14px;display:flex;flex-direction:column;align-items:center;gap:10px}

/* Saved / undo toast */
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;border-radius:12px;background:var(--text);color:#FFFFFF;font-size:14px;box-shadow:0 12px 32px rgba(15,27,45,.28);max-width:calc(100vw - 32px)}
.toast[hidden]{display:none}
.toast button{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer}
.toast button:hover{background:rgba(255,255,255,.12)}
.toast .x{border:0;width:32px;padding:0;display:grid;place-items:center}

@media (max-width:820px){
  .side{flex:1 1 100%;position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;padding:8px 12px}
  .side .spacer,.side .lbl{display:none}
  .brand{padding:0 6px 0 0}
  .account{margin:0;border:0;padding:4px}
  .top,.tabs{padding-left:16px;padding-right:16px}
  .content{padding:12px 16px 32px}
}
```

## Appendix C: `D1-Task.html` styles

```css
/* ===== Harbor (D1) tokens ===== */
:root{
  --bg:#EDF1F7; --surface:#FFFFFF; --text:#0F1B2D; --text-2:#3F4F66; --muted:#5A6B82;
  --line:#D7DEE8; --row:#D3DAE5; --track:#E6EBF2;
  --accent:#1F5FBF; --accent-dk:#174A96; --accent-deeper:#12397A; --accent-soft:#DCE8F8;
  --side:#14264A; --side-text:#C9D4E8; --side-muted:#B9C6DE;
  --red:#B42318; --red-soft:#FCE8E6; --red-line:#E5B4B4;
  --amber:#7A4D00; --amber-soft:#FFF0CC; --amber-line:#EAD2A2;
  --green:#1B6B2E; --green-soft:#E3F3E6;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent-dk)}
button,select,input,textarea{font:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.shell{display:flex;flex-wrap:wrap;min-height:100vh}

/* ===== Sidebar (same as the other D1 pages) ===== */
.side{flex:0 0 232px;position:sticky;top:0;align-self:flex-start;height:100vh;background:var(--side);display:flex;flex-direction:column;gap:2px;padding:16px 12px;overflow-y:auto;z-index:3}
.side a{color:var(--side-text);text-decoration:none}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 18px;color:#FFFFFF !important}
.logo{width:36px;height:36px;flex:none;border-radius:10px;background:#FFFFFF;color:var(--side);display:grid;place-items:center;font-weight:700;font-size:13px}
.brand-name{font-size:15px;font-weight:600;letter-spacing:-.01em}
.nav-item{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;font-size:14px;font-weight:500;transition:background .15s ease,color .15s ease}
.nav-item svg{flex:none}
.nav-item:hover{background:rgba(255,255,255,.12);color:#FFFFFF}
.nav-item[aria-current="page"]{background:rgba(255,255,255,.16);color:#FFFFFF;font-weight:600;box-shadow:inset 3px 0 0 #7FB0FF}
.spacer{flex:1}
.account{display:flex;align-items:center;gap:10px;padding:14px 8px 8px;margin-top:8px;border-top:1px solid rgba(255,255,255,.12);color:#FFFFFF !important}
.account:hover{background:rgba(255,255,255,.06)}
.account .who{display:flex;flex-direction:column;min-width:0}
.account .who b{font-size:14px;font-weight:600}
.account .who span{font-size:12px;color:var(--side-muted)}

/* ===== Header ===== */
main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:12px 32px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.crumbs{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);flex:1 1 220px;min-width:0}
.crumbs a{display:inline-flex;align-items:center;gap:6px;font-weight:600;text-decoration:none;color:var(--accent-dk)}
.crumbs a:hover{text-decoration:underline}
.crumbs .here{color:var(--text-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stepper{display:inline-flex;align-items:center;gap:2px;margin-left:6px}
.stepper a{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--text-2)}
.stepper a:hover{background:var(--bg)}
.stepper a[aria-disabled="true"]{opacity:.35;pointer-events:none}
.stepper span{font-size:12px;color:var(--muted);padding:0 4px;white-space:nowrap}
.btn{height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}
.btn:hover{background:var(--bg)}
.btn.solid{background:var(--accent);border-color:var(--accent);color:#FFFFFF} .btn.solid:hover{background:var(--accent-dk)}
.btn.ok{color:var(--green)} .btn.ok:hover{background:var(--green);border-color:var(--green);color:#FFFFFF}
.btn.running{border-color:#F3B4AE;background:#FFF5F4;color:var(--red)}
.btn.icon{width:36px;padding:0;justify-content:center}
.btn.ghost{border-color:transparent;background:transparent}
.btn.ghost:hover{background:var(--bg)}
.live{width:8px;height:8px;border-radius:50%;background:#D92D20}

/* ===== Page ===== */
.content{padding:20px 32px 40px;max-width:1760px;width:100%}
.head{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
.flags{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:0}
.flag{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600}
.flag.red{background:var(--red-soft);color:var(--red)}
.flag.grey{background:var(--track);color:var(--text-2)}
.flag.green{background:var(--green-soft);color:var(--green)}
.title-in{width:100%;margin-left:-10px;padding:4px 10px;border:1px solid transparent;border-radius:10px;background:transparent;font-size:26px;font-weight:600;letter-spacing:-.015em;color:var(--text);outline:none}
.title-in:hover{border-color:var(--line);background:var(--surface)}
.title-in:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft)}
.title-in::placeholder{color:#9AA7B8}
.meta{font-size:13px;color:var(--muted)}
.meta b{color:var(--text-2);font-weight:600}

/* ===== Task header: the record. Title, then the five facts that define the task, then quiet secondary facts. ===== */
.taskhead{background:var(--surface);border-bottom:1px solid var(--line);padding:22px 32px 20px}
.taskhead-in{max-width:1760px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px 32px;align-items:start}
@media (max-width:980px){.taskhead-in{grid-template-columns:minmax(0,1fr)}}

/* Property chips: one compact row, each chip is the editable value itself */
.chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px}
.pv{position:relative;display:inline-flex;align-items:center;gap:6px;height:36px;padding-left:12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);transition:border-color .12s ease,background .12s ease,box-shadow .12s ease}
.pv:hover{border-color:#B9C4D4;background:#F8FAFC}
.pv:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.pv .cl{font-size:12px;font-weight:500;color:var(--muted);white-space:nowrap}
.pv .ic{display:grid;place-items:center;color:var(--muted)}
.pv select{appearance:none;-webkit-appearance:none;height:34px;padding:0 30px 0 0;border:0;background:transparent;font-size:14px;font-weight:600;color:var(--text);cursor:pointer;outline:none;text-overflow:ellipsis}
.pv svg.chev{position:absolute;right:12px;pointer-events:none;opacity:.55}
.pv.lead{padding-left:4px}
.pv .lead{display:grid;pointer-events:none}
.pv.status{border-color:transparent;padding-left:12px}
.pv.status .sdot{width:8px;height:8px;border-radius:50%;background:currentColor}
.pv.status.st-todo{background:var(--track);color:var(--text-2)}
.pv.status.st-doing{background:var(--accent-soft);color:var(--accent-dk)}
.pv.status.st-blocked{background:var(--amber-soft);color:var(--amber)}
.pv.status.st-done{background:var(--green-soft);color:var(--green)}
.pv.status select{color:inherit}
.pv.status:hover{filter:brightness(.97)}
.pv.late{background:var(--red-soft);border-color:var(--red-line)}
.pv.late select,.pv.late .ic{color:var(--red)}
.pv.pri-High .pdot{background:var(--red)} .pv.pri-Normal .pdot{background:#8A9AB0} .pv.pri-Low .pdot{background:#C9D0DA}
.pv .pdot{width:8px;height:8px;border-radius:50%}
.pv.changed{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.pv.changed::after{content:'';position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid #FFFFFF}
.chips .sep{width:1px;height:22px;background:var(--row);margin:0 6px}
.meta-link{display:inline-flex;align-items:center;gap:4px;font-weight:600;text-decoration:none}
.meta-link:hover{text-decoration:underline}
.chip-link{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:600;color:var(--accent-dk);text-decoration:none}
.chip-link:hover{background:var(--bg)}
.pv.tog{padding:0 14px 0 8px;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer}
.pv.tog svg{color:var(--muted)}
.pv.tog[aria-pressed="true"]{color:var(--accent-dk)}
.pv.tog.on{background:var(--accent-soft);border-color:transparent;color:var(--accent-dk)}
.pv.tog.on svg{color:var(--accent-dk)}
.pv.tog .stack{display:inline-flex}
.pv.tog .stack .av{margin-left:-6px;border:2px solid #FFFFFF}
.pv.tog .stack .av:first-child{margin-left:0}

/* Time block: the one big number in the header */
.timebox{display:flex;align-items:center;gap:18px;width:340px;max-width:100%;box-sizing:border-box;padding:14px 14px 14px 18px;border-radius:16px;background:#F4F7FB;border:1px solid var(--line);transition:background .2s ease,border-color .2s ease}
.timebox .tlabel{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--muted)}
.timebox .tval{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:var(--text);font-variant-numeric:tabular-nums}
.timebox .tsub{font-size:12px;color:var(--muted)}
.timebox .tbtn{margin-left:auto;height:44px;padding:0 18px;border-radius:12px;border:0;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;transition:background .12s ease,transform .12s ease}
.timebox .tbtn:active{transform:scale(.98)}
.timebox .tbtn.start{background:var(--accent);color:#FFFFFF;box-shadow:0 6px 14px rgba(31,95,191,.25)}
.timebox .tbtn.start:hover{background:var(--accent-dk)}
.timebox.running{background:#FFF5F4;border-color:#F3B4AE}
.timebox.running .tval{color:var(--red)}
.timebox.running .tlabel{color:var(--red)}
.timebox .tbtn.stop{background:var(--red);color:#FFFFFF;box-shadow:0 6px 14px rgba(180,35,24,.25)}
.timebox .tbtn.stop:hover{background:#9A1D14}
.timebox .live{width:8px;height:8px;border-radius:50%;background:#D92D20;animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.timebox .live{animation:none}}

/* Review hand-off: a request for action, set apart by its own tinted surface */
.review{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 16px;margin-bottom:20px;border-radius:12px;background:#F5F9FE;border:1px solid #B7CDEE}
.review .txt{flex:1 1 280px;font-size:14px;color:var(--text-2)}
.review .txt b{color:var(--text)}
.review.done{background:var(--green-soft);border-color:#BFE0C6}
.review.done .txt{color:#24502F}
.review.returned{background:var(--surface);border-color:var(--line)}

/* Body: the work on the left, the conversation on the right */
.grid{display:grid;gap:20px;grid-template-columns:minmax(0,1fr);grid-template-areas:"main" "activity";align-items:start}
@media (min-width:1180px){.grid{grid-template-columns:minmax(0,1.4fr) minmax(360px,1fr);grid-template-areas:"main activity"}}
.g-main{grid-area:main;display:flex;flex-direction:column;gap:16px;min-width:0}
.g-act{grid-area:activity;min-width:0}

.card{background:var(--surface);border:1px solid var(--line);border-radius:12px}
.card-head{display:flex;align-items:center;gap:10px;padding:14px 18px 10px}
.card-head h2{margin:0;font-size:14px;font-weight:600;flex:1}
.card-head .small{font-size:12px;color:var(--muted)}
.card-body{padding:0 18px 16px}

textarea.desc{width:100%;min-height:96px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:14px;line-height:1.55;color:var(--text);resize:vertical;outline:none}
textarea.desc:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}

/* Checklist */
.progress{height:6px;border-radius:3px;background:var(--track);overflow:hidden;margin:0 18px 8px}
.progress i{display:block;height:100%;border-radius:3px;background:var(--accent);transition:width .2s ease}
.steps{list-style:none;margin:0;padding:0 10px 4px}
.step{display:flex;align-items:center;gap:12px;min-height:40px;padding:0 8px;border-radius:8px}
.step:hover{background:#F8FAFC}
.step label{display:flex;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer;font-size:14px}
.step.done label span{color:var(--muted);text-decoration:line-through}
.step .rm{opacity:0;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center}
.step:hover .rm,.step .rm:focus{opacity:1}
.step .rm:hover{background:var(--red-soft);color:var(--red)}
input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);margin:0;cursor:pointer;flex:none}
.add-row{display:flex;gap:8px;padding:6px 18px 16px}
.add-row input{flex:1;height:36px;padding:0 12px;border:1px dashed #B9C4D4;border-radius:8px;background:transparent;font-size:14px;color:var(--text);outline:none}
.add-row input:focus{border-style:solid;border-color:var(--accent);background:var(--surface)}
.add-row input::placeholder{color:var(--muted)}

/* Related tasks + files */
.rel{display:flex;align-items:center;gap:10px;min-height:42px;padding:0 18px;border-top:1px solid var(--row);font-size:14px}
.rel:first-of-type{border-top:0}
.rel .kind{font-size:12px;font-weight:600;color:var(--muted);width:78px;flex:none}
.rel a{color:var(--text);text-decoration:none;font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rel a:hover{text-decoration:underline}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.st-todo{background:var(--track);color:var(--text-2)} .st-doing{background:var(--accent-soft);color:var(--accent-dk)}
.st-blocked{background:var(--amber-soft);color:var(--amber)} .st-done{background:var(--green-soft);color:var(--green)}
.file{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 18px;border-top:1px solid var(--row)}
.file:first-of-type{border-top:0}
.ficon{width:32px;height:32px;flex:none;border-radius:8px;display:grid;place-items:center;font-size:10px;font-weight:700}
.file .fn{flex:1;min-width:0;display:flex;flex-direction:column}
.file .fn a{color:var(--text);font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file .fn a:hover{text-decoration:underline}
.file .fn small{font-size:12px;color:var(--muted)}
.drop{display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 18px 16px;height:44px;border:1.5px dashed #B9C4D4;border-radius:10px;font-size:13px;color:var(--text-2);cursor:pointer}
.drop:hover,.drop.over{border-color:var(--accent);background:#F5F9FE;color:var(--accent-dk)}
.empty-line{padding:4px 18px 12px;font-size:13px;color:var(--muted)}

/* Details (right) */
.details{padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.details h2{margin:0;font-size:14px;font-weight:600}
.field{display:flex;flex-direction:column;gap:6px}
.flabel{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;color:var(--muted)}
.flabel .edited{color:var(--accent-dk);font-weight:600}
.select{position:relative;display:block}
.select select{appearance:none;-webkit-appearance:none;width:100%;height:40px;padding:0 34px 0 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);font-size:14px;font-weight:500;color:var(--text);cursor:pointer}
.select select:hover{border-color:#B9C4D4}
.select select.changed{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.select svg.chev{position:absolute;right:12px;top:15px;pointer-events:none}
.select .lead{position:absolute;left:10px;top:9px;pointer-events:none}
.select.has-lead select{padding-left:42px}
.select.status select{font-weight:600}
.select.status.st-todo select{background:var(--track);color:var(--text-2)}
.select.status.st-doing select{background:var(--accent-soft);color:var(--accent-dk)}
.select.status.st-blocked select{background:var(--amber-soft);color:var(--amber)}
.select.status.st-done select{background:var(--green-soft);color:var(--green)}
.select.late select{color:var(--red);font-weight:600}
.select.cal svg.calic{position:absolute;right:12px;top:12px;pointer-events:none;color:var(--muted)}
.av{width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--text)}
.av.none{background:transparent;border:1.5px dashed #B9C4D4;color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kv{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px;min-height:28px}
.kv span:first-child{font-size:12px;font-weight:600;color:var(--muted)}
.kv b{font-weight:600}
.divider{height:1px;background:var(--row);margin:2px 0}
.switch{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-size:14px}
.switch small{display:block;font-size:12px;color:var(--muted)}
.switch input{appearance:none;-webkit-appearance:none;width:38px;height:22px;flex:none;border-radius:999px;background:#C9D0DA;position:relative;cursor:pointer;transition:background .15s ease;margin:0}
.switch input::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#FFFFFF;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}
.switch input:checked{background:var(--accent)}
.switch input:checked::after{transform:translateX(16px)}
.watchers{display:flex;align-items:center;gap:4px}
.watchers .av{width:26px;height:26px;margin-left:-6px;border:2px solid #FFFFFF}
.watchers .av:first-child{margin-left:0}

/* Activity */
.thread{display:flex;flex-direction:column;gap:16px;padding:4px 18px 8px}
.item{display:flex;gap:12px}
.item .av{width:30px;height:30px;font-size:11px}
.item .body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.item .who{font-size:13px}
.item .who b{font-weight:600}
.item .who span{color:var(--muted)}
.item .text{font-size:14px;line-height:1.5;color:var(--text)}
.item.event .text{color:var(--text-2);font-size:13px}
.item.event .dot{width:30px;flex:none;display:grid;place-items:center}
.item.event .dot i{width:8px;height:8px;border-radius:50%;background:#B9C4D4}
.compose{display:flex;gap:12px;padding:12px 18px 16px;border-top:1px solid var(--row)}
.compose .box{flex:1;display:flex;flex-direction:column;gap:8px}
.compose textarea{width:100%;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;line-height:1.5;resize:vertical;outline:none}
.compose textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.compose .row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted)}

/* One save bar */
.savebar{position:sticky;bottom:16px;z-index:4;display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:20px;padding:12px 14px 12px 18px;border-radius:12px;background:var(--accent-dk);color:#FFFFFF;box-shadow:0 12px 30px rgba(23,74,150,.3)}
.savebar[hidden]{display:none}
.savebar .dot{width:8px;height:8px;border-radius:50%;background:#FAB219}
.savebar b{font-size:14px}
.savebar .list{flex:1 1 200px;font-size:13px;color:#DCE8F8}
.savebar .kbd{font-size:12px;color:#B9C6DE}
.savebar button{height:38px;padding:0 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.savebar .discard{border:1px solid rgba(255,255,255,.4);background:transparent;color:#FFFFFF}
.savebar .discard:hover{background:rgba(255,255,255,.1)}
.savebar .save{border:0;background:#FFFFFF;color:var(--accent-dk)}
.savebar .save:hover{background:#EDF3FC}

.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;border-radius:12px;background:var(--text);color:#FFFFFF;font-size:14px;box-shadow:0 12px 32px rgba(15,27,45,.28);max-width:calc(100vw - 32px)}
.toast[hidden]{display:none}
.toast.good{background:var(--green)}
.toast button{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer}

.more-menu{position:fixed;z-index:70;min-width:200px;background:#FFFFFF;border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px rgba(15,27,45,.18);padding:6px}
.more-menu[hidden]{display:none}
.more-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:0 10px;border:0;border-radius:8px;background:transparent;font-size:14px;color:var(--text);cursor:pointer;text-align:left}
.more-menu button:hover,.more-menu button:focus-visible{background:var(--bg);outline:none}
.more-menu button.danger{color:var(--red)}
.more-menu hr{border:0;height:1px;background:var(--row);margin:4px 2px}

@media (max-width:820px){
  .side{flex:1 1 100%;position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;padding:8px 12px}
  .side .spacer,.side .lbl{display:none}
  .brand{padding:0 6px 0 0}
  .account{margin:0;border:0;padding:4px}
  .top{padding:10px 16px;position:static}
  .content{padding:16px 16px 32px}
  .title-in{font-size:22px}
}
```

## Appendix D: `d1-ui.js` (custom dropdowns, calendar, shared timer and sidebar pill)

```js
/* HL Central (Harbor / D1) dropdowns and date picker.
   Replaces the browser's square native <select> popups with a rounded menu, and due-date
   selects with a calendar. The real <select> stays in the page as the source of truth:
   picking something sets its value and fires a normal "change" event, so page code is unchanged.
   Include with <script src="d1-ui.js"></script>. A select opens the calendar when it has
   data-calendar, data-edit="due", data-batch="due", or id="qa-due". Date values are days of
   November in this mockup (0 or less = October, over 30 = December); today is Wed Nov 5. */
(function () {
  const TODAY = 5;
  const MONTHS = { 10: ['October', 'Oct', 31, 3], 11: ['November', 'Nov', 30, 6], 12: ['December', 'Dec', 31, 1] }; // name, short, days, weekday of the 1st (0 = Sun)
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const toDue = (m, d) => m === 10 ? d - 31 : m === 12 ? 30 + d : d;
  const fromDue = v => v <= 0 ? [10, v + 31] : v > 30 ? [12, v - 30] : [11, v];
  const weekday = (m, d) => (MONTHS[m][3] + d - 1) % 7;
  const dateLabel = v => { if (v === TODAY) return 'Today'; if (v === TODAY + 1) return 'Tomorrow'; const [m, d] = fromDue(v); return MONTHS[m][1] + ' ' + d; };

  const DOT = { todo: '#8A9AB0', doing: '#1F5FBF', blocked: '#B86E00', done: '#1B6B2E', High: '#B42318', Normal: '#8A9AB0', Low: '#C9D0DA' };
  const check = '<svg class="dd-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  const arrow = d => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `
  .dd-menu{position:fixed;z-index:70;display:flex;flex-direction:column;background:#FFFFFF;border:1px solid #D7DEE8;border-radius:12px;box-shadow:0 16px 40px rgba(15,27,45,.18),0 2px 6px rgba(15,27,45,.06);padding:6px;font-family:'Inter',system-ui,sans-serif;color:#0F1B2D;animation:ddIn .12s ease-out;max-height:min(380px,calc(100vh - 24px))}
  @keyframes ddIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.dd-menu{animation:none}}
  .dd-search{padding:2px 2px 6px}
  .dd-search input{width:100%;height:34px;padding:0 10px;border:1px solid #D7DEE8;border-radius:8px;background:#EDF1F7;font:inherit;font-size:13px;color:#0F1B2D;outline:none}
  .dd-search input:focus{border-color:#1F5FBF;background:#FFFFFF}
  .dd-list{overflow-y:auto;display:flex;flex-direction:column;gap:1px}
  .dd-opt{display:flex;align-items:center;gap:10px;min-height:36px;padding:0 10px;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap;user-select:none}
  .dd-opt.active{background:#EDF1F7}
  .dd-opt[aria-selected="true"]{color:#174A96;font-weight:600}
  .dd-opt .dd-check{margin-left:auto;padding-left:12px;box-sizing:content-box;color:#1F5FBF;visibility:hidden}
  .dd-opt[aria-selected="true"] .dd-check{visibility:visible}
  .dd-dot{width:9px;height:9px;flex:none;border-radius:50%}
  .dd-av{width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:700;background:#E6EBF2;color:#0F1B2D}
  .dd-av.none{background:transparent;border:1.5px dashed #B9C4D4;color:#5A6B82}
  .dd-empty{padding:12px 10px;font-size:13px;color:#5A6B82}
  .dd-cal{width:292px;padding:10px}
  .cal-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px 8px}
  .cal-head b{font-size:14px;font-weight:600}
  .cal-nav{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#3F4F66;cursor:pointer;display:grid;place-items:center}
  .cal-nav:hover{background:#EDF1F7}
  .cal-nav:disabled{opacity:.3;cursor:default;background:transparent}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
  .cal-wd{font-size:11px;font-weight:600;color:#5A6B82;padding:4px 0 6px}
  .cal-day{height:36px;border:0;border-radius:999px;background:transparent;font:inherit;font-size:13px;color:#0F1B2D;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .1s ease}
  .cal-day:hover{background:#EDF1F7}
  .cal-day.weekend{color:#5A6B82}
  .cal-day.past{color:#9AA7B8}
  .cal-day.today{box-shadow:inset 0 0 0 1.5px #1F5FBF;color:#174A96;font-weight:700}
  .cal-day[aria-pressed="true"]{background:#1F5FBF;color:#FFFFFF;font-weight:600;box-shadow:none}
  .cal-day:focus-visible{outline:2px solid #1F5FBF;outline-offset:1px}
  .cal-quick{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;padding-top:10px;border-top:1px solid #E6EBF2}
  .cal-quick button{height:30px;padding:0 8px;border:1px solid #D7DEE8;border-radius:999px;background:#FFFFFF;font:inherit;font-size:12px;font-weight:600;color:#3F4F66;cursor:pointer}
  .cal-quick button:hover{border-color:#1F5FBF;color:#174A96}
  .cal-quick button[aria-pressed="true"]{background:#DCE8F8;border-color:#DCE8F8;color:#174A96}
  .cal-foot{margin-top:8px;font-size:12px;color:#5A6B82;padding:0 2px}`;
  document.head.appendChild(style);

  let menu = null, sel = null, active = 0, items = [], month = 11, focusDay = null;

  const isDate = s => s.hasAttribute('data-calendar') || s.dataset.edit === 'due' || s.dataset.batch === 'due' || s.id === 'qa-due';
  const kindOf = s => {
    const k = s.dataset.edit || s.dataset.batch || s.dataset.action || s.dataset.filter || '';
    if (k === 'status') return 'status';
    if (k === 'priority' || k === 'pri') return 'priority';
    if (k === 'owner') return 'owner';
    return '';
  };

  /* ---------- Open / close ---------- */
  function open(s) {
    close(false);
    sel = s;
    menu = document.createElement('div');
    menu.className = 'dd-menu';
    menu.addEventListener('mousedown', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    document.body.appendChild(menu);
    s.setAttribute('aria-expanded', 'true');
    if (isDate(s)) { const v = parseInt(s.value, 10); month = isNaN(v) ? 11 : fromDue(v)[0]; focusDay = isNaN(v) ? TODAY : v; drawCalendar(); }
    else drawList('');
    place();
  }
  function close(refocus) {
    if (!menu) return;
    menu.remove(); menu = null;
    if (sel) { sel.removeAttribute('aria-expanded'); if (refocus) sel.focus({ preventScroll: true }); }
  }
  function place() {
    if (!menu || !sel) return;
    const r = sel.getBoundingClientRect();
    if (!isDate(sel)) menu.style.minWidth = Math.max(r.width, 200) + 'px';
    menu.style.left = '0px'; menu.style.top = '0px';
    const m = menu.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + m.height > window.innerHeight - 8 && r.top - m.height - 6 > 8) top = r.top - m.height - 6;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - m.width - 8);
    menu.style.left = left + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }
  function choose(value, label) {
    const s = sel;
    close(true);
    if (![...s.options].some(o => o.value === String(value))) s.add(new Option(label, value));
    if (s.value !== String(value)) { s.value = String(value); s.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  /* ---------- List menu ---------- */
  function drawList(q) {
    const kind = kindOf(sel);
    const all = [...sel.options].filter(o => !(o.value === '' && sel.dataset.batch) && !o.hidden && !o.disabled);
    const query = q.trim().toLowerCase();
    items = all.filter(o => !query || o.text.toLowerCase().includes(query));
    const searchable = all.length > 8;
    const first = menu.querySelector('.dd-search input');
    if (!first) {
      menu.innerHTML = (searchable ? `<div class="dd-search"><input type="text" placeholder="Search…" aria-label="Search options" autocomplete="off"></div>` : '') + `<div class="dd-list" role="listbox"></div>`;
      if (searchable) {
        const inp = menu.querySelector('.dd-search input');
        inp.addEventListener('input', () => drawList(inp.value));
        inp.addEventListener('keydown', listKeys);
        setTimeout(() => inp.focus({ preventScroll: true }), 0);
      }
    }
    const list = menu.querySelector('.dd-list');
    const curIdx = items.findIndex(o => o.value === sel.value);
    active = query ? 0 : Math.max(0, curIdx);
    list.innerHTML = items.length ? items.map((o, i) => {
      let lead = '';
      if (kind === 'status' || kind === 'priority') lead = DOT[o.value] ? `<span class="dd-dot" style="background:${DOT[o.value]}"></span>` : '';
      if (kind === 'owner') lead = o.value === 'none' ? '<span class="dd-av none">?</span>' : o.value === 'all' ? '' : `<span class="dd-av">${esc(o.value).slice(0, 2)}</span>`;
      return `<div class="dd-opt${i === active ? ' active' : ''}" role="option" data-i="${i}" aria-selected="${o.value === sel.value}">${lead}<span>${esc(o.text)}</span>${check}</div>`;
    }).join('') : '<div class="dd-empty">No matches</div>';
    list.onmousemove = e => { const el = e.target.closest('.dd-opt'); if (el) setActive(+el.dataset.i, false); };
    list.onclick = e => { const el = e.target.closest('.dd-opt'); if (el) { const o = items[+el.dataset.i]; choose(o.value, o.text); } };
    const a = list.querySelector('.dd-opt.active'); if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function setActive(i, scroll = true) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    menu.querySelectorAll('.dd-opt').forEach(el => el.classList.toggle('active', +el.dataset.i === active));
    if (scroll) { const a = menu.querySelector('.dd-opt.active'); if (a) a.scrollIntoView({ block: 'nearest' }); }
  }
  function listKeys(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter' || (e.key === ' ' && e.target.tagName !== 'INPUT')) { e.preventDefault(); const o = items[active]; if (o) choose(o.value, o.text); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1 && e.target.tagName !== 'INPUT') { // type-ahead
      const i = items.findIndex((o, j) => j > active && o.text.toLowerCase().startsWith(e.key.toLowerCase()));
      const k = i >= 0 ? i : items.findIndex(o => o.text.toLowerCase().startsWith(e.key.toLowerCase()));
      if (k >= 0) setActive(k);
    }
  }

  /* ---------- Calendar ---------- */
  function drawCalendar() {
    const [name, , days, first] = MONTHS[month];
    const cur = parseInt(sel.value, 10);
    const blanks = Array.from({ length: first }, () => '<span></span>').join('');
    const cells = Array.from({ length: days }, (_, i) => {
      const d = i + 1, v = toDue(month, d), wd = weekday(month, d);
      const cls = ['cal-day', v === TODAY ? 'today' : '', v < TODAY ? 'past' : '', wd === 0 || wd === 6 ? 'weekend' : ''].join(' ');
      return `<button type="button" class="${cls}" data-v="${v}" tabindex="${v === focusDay ? 0 : -1}" aria-pressed="${v === cur}" aria-label="${WEEKDAYS[wd]}, ${name} ${d}${v === TODAY ? ', today' : ''}">${d}</button>`;
    }).join('');
    const quick = [[TODAY, 'Today'], [TODAY + 1, 'Tomorrow'], [7, 'Friday'], [10, 'Next week']];
    menu.className = 'dd-menu dd-cal';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Choose a due date');
    menu.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month"${month === 10 ? ' disabled' : ''}>${arrow('M15 18l-6-6 6-6')}</button>
        <b>${name}</b>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Next month"${month === 12 ? ' disabled' : ''}>${arrow('M9 18l6-6-6-6')}</button>
      </div>
      <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => `<span class="cal-wd" title="${WEEKDAYS[i]}">${w}</span>`).join('')}${blanks}${cells}</div>
      <div class="cal-quick">${quick.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>
      ${!isNaN(cur) && cur < TODAY ? `<div class="cal-foot">Currently ${dateLabel(cur)}, ${TODAY - cur} ${TODAY - cur === 1 ? 'day' : 'days'} overdue</div>` : ''}`;
    menu.onclick = e => {
      const nav = e.target.closest('[data-nav]');
      if (nav && !nav.disabled) { month += +nav.dataset.nav; focusDay = toDue(month, 1); drawCalendar(); place(); menu.querySelector('.cal-day[tabindex="0"]')?.focus(); return; }
      const b = e.target.closest('[data-v]');
      if (b) { const v = +b.dataset.v; choose(v, (sel.id === 'qa-due' ? 'Due ' : '') + dateLabel(v)); }
    };
    menu.onkeydown = calKeys;
    setTimeout(() => (menu && menu.querySelector('.cal-day[tabindex="0"]'))?.focus({ preventScroll: true }), 0);
  }
  function calKeys(e) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab' && !menu.contains(e.target)) { close(false); return; }
    if (!step && e.key !== 'PageUp' && e.key !== 'PageDown') return;
    if (!e.target.classList.contains('cal-day')) return;
    e.preventDefault();
    let v = +e.target.dataset.v + (step || (e.key === 'PageUp' ? -30 : 30));
    v = Math.max(toDue(10, 1), Math.min(toDue(12, 31), v));
    focusDay = v;
    const m = fromDue(v)[0];
    if (m !== month) { month = m; drawCalendar(); place(); }
    else menu.querySelectorAll('.cal-day').forEach(b => b.tabIndex = +b.dataset.v === v ? 0 : -1);
    menu.querySelector(`.cal-day[data-v="${v}"]`)?.focus();
  }

  /* ---------- Hook every <select> on the page (works with re-rendered markup) ---------- */
  document.addEventListener('mousedown', e => {
    if (menu && menu.contains(e.target)) return;
    const s = e.target.closest('select') || (e.target.closest('label') && !e.target.closest('input,button,a,textarea') ? e.target.closest('label').querySelector('select') : null);
    if (s && !s.disabled && !s.multiple) {
      e.preventDefault();
      if (menu && sel === s) { close(true); return; }
      s.focus({ preventScroll: true });
      open(s);
      return;
    }
    if (menu) close(false);
  }, true);
  document.addEventListener('keydown', e => {
    if (menu && sel && document.activeElement === sel) { if (isDate(sel)) { if (e.key === 'Escape') close(true); } else listKeys(e); return; }
    const s = e.target;
    if (s.tagName === 'SELECT' && !s.multiple && ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(e.key)) { e.preventDefault(); open(s); }
  }, true);
  window.addEventListener('scroll', e => { if (menu && !menu.contains(e.target)) close(false); }, true);
  window.addEventListener('resize', () => close(false));

  // Small helpers other scripts can use.
  window.D1UI = { dateLabel, close: () => close(false) };

  /* ---------- One shared task timer for the whole app ----------
     Kept in this browser's storage so it keeps running when you leave the task page or close the tab.
     Only one timer runs at a time; starting another stops (and logs) the first. */
  const TKEY = 'd1-timer', LKEY = 'd1-timelog';
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const emit = () => window.dispatchEvent(new Event('d1-timer'));
  const D1Timer = {
    get: () => read(TKEY),
    isFor: (id, title) => { const t = read(TKEY); return !!t && (t.id === id || (!!title && t.title === title)); },
    link: t => 'D1-Task.html#' + (typeof t.id === 'number' ? 'id=' + t.id : 'title=' + encodeURIComponent(t.title)),
    elapsed: () => { const t = read(TKEY); return t ? Math.max(0, Math.floor((Date.now() - t.started) / 1000)) : 0; },
    start(id, title) {
      const cur = read(TKEY);
      if (cur && cur.id === id) return null;
      const stopped = cur ? D1Timer.stop(true) : null;
      write(TKEY, { id, title, started: Date.now() });
      emit();
      return stopped;
    },
    stop(quiet) {
      const cur = read(TKEY);
      if (!cur) return null;
      const min = Math.max(1, Math.round((Date.now() - cur.started) / 60000));
      const log = read(LKEY) || [];
      log.push({ id: cur.id, title: cur.title, min, at: Date.now() });
      write(LKEY, log); write(TKEY, null);
      if (!quiet) emit();
      return { id: cur.id, title: cur.title, min };
    },
    logged(id, title) { const e = (read(LKEY) || []).filter(x => x.id === id || (title && x.title === title)); return { min: e.reduce((n, x) => n + x.min, 0), n: e.length }; },
    todayMinutes() { const d = new Date().toDateString(); return (read(LKEY) || []).filter(x => new Date(x.at).toDateString() === d).reduce((n, x) => n + x.min, 0); },
    fmt: s => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
  };
  window.D1Timer = D1Timer;
  window.addEventListener('storage', e => { if (e.key === TKEY || e.key === LKEY) emit(); });   // started or stopped in another tab

  // Running-timer pill in the sidebar of every page, linking back to the task being timed.
  const pillCss = document.createElement('style');
  pillCss.textContent = `
  .tpill{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:10px 12px;border-radius:10px;background:rgba(217,45,32,.22);border:1px solid rgba(255,138,128,.4);color:#FFFFFF !important;text-decoration:none !important;transition:background .15s ease}
  .tpill:hover{background:rgba(217,45,32,.34)}
  .tpill .tdot{width:8px;height:8px;flex:none;border-radius:50%;background:#FF7A6E;animation:tpPulse 1.6s ease-in-out infinite}
  @keyframes tpPulse{50%{opacity:.35}}
  @media (prefers-reduced-motion:reduce){.tpill .tdot{animation:none}}
  .tpill .tt{display:flex;flex-direction:column;min-width:0}
  .tpill b{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .tpill small{font-size:12px;color:#FBD5D0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media (max-width:820px){.tpill{margin:0}.tpill small{display:none}}`;
  document.head.appendChild(pillCss);
  function drawPill() {
    const side = document.querySelector('.side');
    if (!side) return;
    const t = D1Timer.get();
    const p0 = new URLSearchParams(location.hash.slice(1));
    const onThatTask = t && /D1-Task\.html$/i.test(location.pathname) && (p0.get('id') === String(t.id) || p0.get('title') === t.title);
    let p = document.getElementById('timer-pill');
    if (!t || onThatTask) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement('a'); p.id = 'timer-pill'; p.className = 'tpill'; side.insertBefore(p, document.getElementById('apps-btn') || side.querySelector('.account')); }
    p.href = D1Timer.link(t);
    p.title = 'Timer running on “' + t.title + '”. Open the task';
    p.innerHTML = `<span class="tdot" aria-hidden="true"></span><span class="tt"><b id="tpill-clock">${D1Timer.fmt(D1Timer.elapsed())}</b><small>${esc(t.title)}</small></span><span class="sr">Timer running. Open the task.</span>`;
  }
  window.addEventListener('d1-timer', drawPill);
  window.addEventListener('hashchange', drawPill);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawPill); else setTimeout(drawPill, 0);
  setInterval(() => { const c = document.getElementById('tpill-clock'); if (c) c.textContent = D1Timer.fmt(D1Timer.elapsed()); }, 1000);
})();

```

## Appendix E: `d1-apps.js` (All apps launcher)

```js
/* HL Central (Harbor / D1) apps launcher.
   A Google-style apps panel that opens from the sidebar's "All apps" button on any D1 page.
   Include with <script src="d1-apps.js"></script>; the button needs id="apps-btn". */
(function () {
  const APPS = [
    ['Dashboard', 'D1-Dashboard.html', '#D4E3F7', '#174A96', 'M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z'],
    ['Tasks', 'D1-Tasks.html', '#D4E3F7', '#174A96', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
    ['Time', '#', '#D8F0DF', '#1B6B2E', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4l3 2'],
    ['Reports', '#', '#E8E2F8', '#5B2E8C', 'M4 20V10M10 20V4M16 20v-6M22 20H2'],
    ['People', '#', '#FFE0C7', '#7A3A00', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'],
    ['Tickets', '#', '#FFF0CC', '#7A4D00', 'M3 9a2 2 0 0 0 2-2V5h14v2a2 2 0 0 0 0 4v2a2 2 0 0 0 0 4v2H5v-2a2 2 0 0 0-2-2zM13 5v14'],
    ['Schedule', '#', '#D8F0DF', '#1B6B2E', 'M3 5h18v16H3zM16 3v4M8 3v4M3 11h18'],
    ['Documents', '#', '#E6EBF2', '#3F4F66', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8'],
    ['Reviews', '#', '#E8E2F8', '#5B2E8C', 'M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21l1.4-7L2 9.3l7-.8z'],
    ['Settings', '#', '#E6EBF2', '#3F4F66', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  ];
  const RECENT = [
    ['Care plan review, Room 12', 'Task · Nursing', 'D1-Task.html#id=4402', '#B42318'],
    ['Overdue, all departments', 'Tasks · filtered', 'D1-Tasks.html#scope=all&status=overdue', '#1F5FBF'],
    ['My team this week', 'Dashboard', 'D1-Dashboard.html#team', '#1F5FBF'],
  ];

  const css = `
  .side button.nav-item{border:0;background:transparent;width:100%;color:#C9D4E8;font:inherit;font-size:14px;font-weight:500;cursor:pointer;text-align:left}
  .side button.nav-item[aria-expanded="true"]{background:rgba(255,255,255,.16);color:#FFFFFF}
  .apps-pop{position:fixed;z-index:60;width:min(368px,calc(100vw - 16px));max-height:min(600px,calc(100vh - 24px));display:flex;flex-direction:column;background:#FFFFFF;border:1px solid #D7DEE8;border-radius:16px;box-shadow:0 18px 48px rgba(15,27,45,.20),0 2px 6px rgba(15,27,45,.06);overflow:hidden;color:#0F1B2D;transform-origin:bottom left;animation:appsIn .14s ease-out}
  .apps-pop[hidden]{display:none}
  @keyframes appsIn{from{opacity:0;transform:scale(.97) translateY(4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.apps-pop{animation:none}}
  .apps-head{display:flex;flex-direction:column;gap:10px;padding:14px 16px 10px;border-bottom:1px solid #E6EBF2}
  .apps-head .row1{display:flex;align-items:center;gap:8px}
  .apps-head h2{margin:0;font-size:15px;font-weight:600;flex:1}
  .apps-x{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#3F4F66;cursor:pointer;display:grid;place-items:center}
  .apps-x:hover{background:#EDF1F7}
  .apps-find{display:flex;align-items:center;gap:8px;height:38px;padding:0 10px;border-radius:10px;border:1px solid #D7DEE8;background:#EDF1F7}
  .apps-find:focus-within{border-color:#1F5FBF;background:#FFFFFF}
  .apps-find input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:14px;color:#0F1B2D;outline:none}
  .apps-find input::placeholder{color:#5A6B82}
  .apps-scroll{overflow-y:auto;padding:8px 10px 12px}
  .apps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
  .app{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 6px 10px;border-radius:12px;text-decoration:none;color:#0F1B2D;font-size:13px;font-weight:500;text-align:center;transition:background .12s ease}
  .app:hover,.app:focus-visible{background:#EDF1F7;outline:none}
  .app:focus-visible{box-shadow:0 0 0 2px #1F5FBF}
  .app .ico{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;transition:transform .12s ease}
  .app:hover .ico{transform:translateY(-1px)}
  .app[aria-current="page"] .ico{box-shadow:0 0 0 2px #FFFFFF,0 0 0 4px #1F5FBF}
  .app[aria-current="page"]{font-weight:600}
  .app .soon{font-size:11px;font-weight:500;color:#5A6B82;margin-top:-6px}
  .apps-none{padding:22px 8px;text-align:center;font-size:14px;color:#5A6B82}
  .apps-sec{font-size:11px;font-weight:600;color:#5A6B82;letter-spacing:.04em;text-transform:uppercase;padding:14px 8px 6px;border-top:1px solid #E6EBF2;margin-top:8px}
  .apps-recent a{display:flex;align-items:center;gap:10px;min-height:40px;padding:6px 8px;border-radius:8px;text-decoration:none;color:#0F1B2D;font-size:14px}
  .apps-recent a:hover,.apps-recent a:focus-visible{background:#EDF1F7;outline:none}
  .apps-recent .dot{width:8px;height:8px;border-radius:50%;flex:none}
  .apps-recent .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .apps-recent .k{font-size:12px;color:#5A6B82;white-space:nowrap}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const here = location.pathname.split('/').pop() || 'D1-Dashboard.html';
  const icon = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  const pop = document.createElement('div');
  pop.className = 'apps-pop';
  pop.id = 'apps-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'HL Central apps');
  pop.innerHTML = `
    <div class="apps-head">
      <div class="row1"><h2>HL Central apps</h2><button type="button" class="apps-x" aria-label="Close apps"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <label class="apps-find"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Find an app</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6B82" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3"/></svg>
        <input type="search" placeholder="Find an app" autocomplete="off">
      </label>
    </div>
    <div class="apps-scroll">
      <div class="apps-grid" role="list"></div>
      <div class="apps-none" hidden>No app matches that name.</div>
      <div class="apps-recent-wrap">
        <div class="apps-sec">Recent</div>
        <div class="apps-recent">${RECENT.map(([t, k, href, c]) => `<a href="${href}"><span class="dot" style="background:${c}"></span><span class="t">${t}</span><span class="k">${k}</span></a>`).join('')}</div>
      </div>
    </div>`;
  document.body.appendChild(pop);

  const grid = pop.querySelector('.apps-grid');
  const input = pop.querySelector('input');
  const none = pop.querySelector('.apps-none');
  const recentWrap = pop.querySelector('.apps-recent-wrap');

  function drawGrid(q) {
    const list = APPS.filter(a => a[0].toLowerCase().includes(q.trim().toLowerCase()));
    grid.innerHTML = list.map(([name, href, bg, fg, d]) => `
      <a class="app" role="listitem" href="${href}"${href === here ? ' aria-current="page"' : ''}${href === '#' ? ' title="' + name + ' is not designed yet"' : ''}>
        <span class="ico" style="background:${bg};color:${fg}">${icon(d)}</span>${name}
      </a>`).join('');
    none.hidden = list.length > 0;
    recentWrap.hidden = !!q.trim();
  }

  let btn = null;
  function place() {
    const r = btn.getBoundingClientRect();
    const narrow = window.innerWidth <= 820;
    pop.style.left = pop.style.top = pop.style.bottom = pop.style.right = pop.style.maxHeight = '';
    if (narrow) {             // sidebar is a top bar on phones: drop the panel below it
      pop.style.top = (r.bottom + 8) + 'px';
      pop.style.left = '8px';
      pop.style.transformOrigin = 'top left';
    } else {                  // open beside the sidebar, bottom-aligned with the button
      const bottom = Math.max(12, window.innerHeight - r.bottom);
      pop.style.left = (r.right + 12) + 'px';
      pop.style.bottom = bottom + 'px';
      pop.style.maxHeight = Math.min(720, window.innerHeight - bottom - 12) + 'px';   // grow upward into the free space
      pop.style.transformOrigin = 'bottom left';
    }
  }
  function open() {
    btn = document.getElementById('apps-btn');
    if (!btn) return;
    input.value = '';
    drawGrid('');
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    input.focus();
  }
  function close(returnFocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (returnFocus) btn.focus(); }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('#apps-btn');
    if (b) { e.preventDefault(); pop.hidden ? open() : close(true); return; }
    if (e.target.closest('.apps-x')) { close(true); return; }
    if (!pop.hidden && !pop.contains(e.target)) close(false);
    const a = e.target.closest('.apps-pop a[href="#"]');
    if (a) e.preventDefault();      // apps not designed yet do nothing
  });
  input.addEventListener('input', () => drawGrid(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = grid.querySelector('.app'); if (first && first.getAttribute('href') !== '#') location.href = first.getAttribute('href'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const first = grid.querySelector('.app'); if (first) first.focus(); }
  });
  // Arrow keys move around the 3-column grid, like Google's launcher.
  grid.addEventListener('keydown', e => {
    const items = [...grid.querySelectorAll('.app')], i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (!step) return;
    e.preventDefault();
    const j = i + step;
    if (j < 0) input.focus(); else if (items[j]) items[j].focus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) close(true); });
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  // A page can be opened with #apps to show the launcher straight away.
  if (location.hash === '#apps') setTimeout(open, 0);
})();

```
