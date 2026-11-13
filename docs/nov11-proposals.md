# HL Central Tasks: proposed changes from the Nov 11 meeting

**Status: for review. Nothing here is built.** Each item is a proposal to confirm, change or drop.
Once the set is agreed, it becomes an implementation plan.

**Sources**

- **The Nov 11 meeting** (Lipa, Zev, Shloma):
  - Gemini's notes (a summary, not the word-for-word transcript).
  - **The recording's pictures** (updated Nov 13): 740 frames, about 300 distinct screens from
    0:25 to 3:16, all reviewed. What was _said_ is known only from the notes. The frames show
    what was _on screen_.
- **Lipa's ticket app:**
  - its source code (`ticket-brecx`, a rewrite of the live Syruvia);
  - the walkthroughs of ticket.brecx.com.
- **Brecx Connect:** its source code. connect.brecx.com itself couldn't be opened from here.
- **HL Central as it is now:** the brief's redesign. The meeting changes built on Nov 11–12 were
  rolled back on Nov 13.
- **On screen, three versions of HL Central were compared:**
  - the older live HL Central (hlcentral.onrender.com) for most of the meeting;
  - our redesign preview near the end;
  - Lipa's apps: the Syruvia tickets app and the Stockyle purchase-order workbench.

**How to read it**

- **Meeting:** decided or asked for in the meeting ("Aligned", or a next step).
- **Vision:** Lipa's design approach as shown in the meeting, not a decision.
- **Video:** what the recording's pictures add, with the time in the recording.
- **Work:** FE = HL Central screens only; BE = HL Central server and database; CX = Connect,
  which needs Connect's owner.
- **Q:** a question to settle before building.

**The rule from the last review:** the meeting decides, and Lipa's ticket app only shows what
she meant. Where her app doesn't match the meeting, the meeting wins. The video shows several
such places (e.g. her app hides attachments behind a tab and shows the due date three times).

---

## A. Principles for every screen (Vision)

| #   | Proposal                                                                                                                                                                                                                                                                                                                                                                          | Work |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A1  | **Expand in place instead of pop-ups.** Small actions open inline and keep the page usable. Pop-ups only for short, focused choices (a filter, a confirmation). _Video 0:57–1:04: Lipa compared editing a purchase-order line in a pop-up that dims the page (old) with the same line opening inline under its row, with Discard / Review & save (new). Filters stayed a pop-up._ | FE   |
| A2  | **Most-used things up front, the rest one click away.** Rare fields (creator, buyer) live in filters, exports or the ⋯ menu, not on the main screen. (Meeting: buyer and created-by off the main screen.) _Video 1:28: "Created by" and "Buyer" chips side by side, highlighted._                                                                                                 | FE   |
| A3  | **Each fact shown once,** where it's changed. _Video: Lipa's own ticket shows the due date three times (header chip, "SLA · due…", and the coloured card)._                                                                                                                                                                                                                       | FE   |
| A4  | **Different attributes look different:** status, priority, assignee and creator each get their own shape and colour. _Video 1:28–1:30: HL Central's header chips (status, priority, owner, duty, "Overdue 100d", tag) all look alike; the cursor went over them._                                                                                                                 | FE   |
| A5  | **White means you can change it, grey means fixed.** Details sit in separate tiles, not one big box.                                                                                                                                                                                                                                                                              | FE   |
| A6  | **Headers stay put while lists and pages scroll.** Everything folds for room; the icon shows which way it folds. _Video 1:30: on a long HL Central task, the title and chips scroll away._                                                                                                                                                                                        | FE   |
| A7  | **Plain words** (see J).                                                                                                                                                                                                                                                                                                                                                          | FE   |

---

## B. Tasks list

| #   | Proposal                                                                                                                                                                                                                                   | Source            | Work    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------- |
| B1  | **One Tasks list.** Drop the separate My tasks / All tasks / Team tabs; a "Me / My team / Everyone" switch up front replaces them.                                                                                                         | Meeting (Aligned) | FE      |
| B2  | **Expand arrow on each row:** the description and key details open under the row. _Video: shown from Lipa's purchase-order app, where every row has a ∨ arrow._                                                                            | Meeting           | FE      |
| B3  | **Group by** status, owner, department, due date or template, **groups that fold.** Tasks made from one template (one alert template has made 376 tasks with the same name) group together. _Video 1:10: Jira's collapsible named groups._ | Meeting           | FE      |
| B4  | **Parent and sub-task rows look clearly different.** _Video 1:08: the cursor on the list's "Nest" checkbox; sub-tasks show only a small "↑ #5" link._                                                                                      | Meeting           | FE      |
| B5  | **Clicking a task's name or number opens it.**                                                                                                                                                                                             | Meeting (Aligned) | FE      |
| B6  | **A small icon on repeating tasks.** _Not seen on screen._                                                                                                                                                                                 | Vision            | BE + FE |
| B7  | **A "snoozed" mark** beside the due date.                                                                                                                                                                                                  | Meeting           | with E1 |

**Q-B1.** The older HL Central list **already has** quick filters with counts across the top
(Overdue, Due today, In progress, In review, Completed today), and Lipa's app has the same idea
(status chips with counts). Bring them back in the redesign, up front?

---

## C. Creating tasks

| #   | Proposal                                                                                                                                                                                                                                                                                                                      | Source            | Work                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------- |
| C1  | **Two ways to create.** A quick pop-up (title, date, time) that saves without leaving the page, and the full form.                                                                                                                                                                                                            | Meeting (Aligned) | FE                    |
| C1a | **NEW (video): one "+" button on every page** that offers each kind of thing to create, each with a one-line explanation: Task, Quick reminder, Event, Draft (I1), Tasks from a template (G3). Lipa's app has this ("Start something new"), shown several times (0:26, 0:29, 1:12, 2:29).                                     | Video             | FE                    |
| C2  | **The full form in compact side-by-side sections:** the title big, short fields small, no long scroll. _Video 1:12: HL Central's New task is one narrow column with empty space either side; the cursor sat in the empty space. Lipa's full create form is a two-column pop-up, not a page._                                  | Vision            | FE                    |
| C3  | **Make a task repeat from the task page too.** _Video: "+ Make recurring" is already on the older task page._                                                                                                                                                                                                                 | Meeting           | exists, simplify (C4) |
| C4  | **A simpler repeat setup:** common choices first, details on demand.                                                                                                                                                                                                                                                          | Meeting (Shloma)  | FE                    |
| C5  | **Picking a duty fills in** the assignee, department and the duty's standard sub-tasks. _Video 1:12, 2:31, 2:48: in Lipa's form, Duty comes right after Title, with "Assignee, department and subtasks are filled in from the duty." Each duty has a Subtasks tab ("every ticket opened for this duty gets these subtasks")._ | Meeting           | BE + FE               |

**Q-C1.** Which fields are required? The meeting set a separate session for this. Until then,
keep today's. **Q-C1a (video):** Lipa's form fills an empty due date with **7 days from today**.
Do we want a default due date?
**Q-C2.** Should the quick pop-up assign to me by default, with no duty?

---

## D. Task page

| #   | Proposal                                                                                                                                                                                                                                | Source            | Work       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------- |
| D1  | **Comments front and center,** the description on the side. _Video 1:13–1:21: Lipa pasted a long email and an HL Central task's description into her app's narrow description panel to show it fits; the long one ran past the bottom._ | Meeting (Aligned) | FE         |
| D2  | **Attachments visible on the main page.** _Video: HL Central's older task page already shows Attachments next to Sub-tasks; Lipa's app hides them behind a tab._ **Keep HL Central's.**                                                 | Meeting           | FE         |
| D3  | **Comment quick filters:** All / Mentions me / With files.                                                                                                                                                                              | Meeting           | FE         |
| D4  | **Voice notes and screen recording** in the comment box. _Video 2:00: Attach / Voice / Screen, voice up to 5 minutes, and a clear message when screen sharing is refused._                                                              | Meeting           | FE         |
| D4a | **NEW (video 2:01): unfinished comments are kept** as a draft, with a "Finish comment · Draft" button when the box is closed (likely the notes' "finished common drafts").                                                              | Video             | FE         |
| D5  | **Tags and other often-changed attributes out of the header.** _Video 1:41: tags selected in the header._                                                                                                                               | Meeting           | FE         |
| D6  | **Overdue stands out clearly.** _Video 2:02–2:04: Lipa highlighted "35 days past due" in her app's big red Overdue box._                                                                                                                | Meeting           | FE         |
| D7  | **Reminders as their own tab.**                                                                                                                                                                                                         | Meeting           | FE         |
| D8  | **A "Calls" record on the task** (see K2).                                                                                                                                                                                              | Meeting           | with K2    |
| D9  | **Quick actions:** Schedule call, Request update, Snooze, Remind me. **Rare actions in the ⋯ menu, each appearing once.** _Video: her ⋯ menu repeats all four icon actions._                                                            | Meeting           | FE + BE/CX |
| D10 | **Delete:** a confirmation; an Admin can restore. _Video: only "Delete" in the menu was on screen; the undo banner was discussed, not shown._                                                                                           | Meeting           | BE + FE    |

**Q-D1.** Delete: the meeting agreed on a 10-second undo banner, but on Nov 12 you said the
countdown isn't needed. Is it still dropped?
**Q-D2.** Overdue: the red due chip (your Nov 12 choice), or a box like the one Lipa pointed at?
**Q-D3.** Header: always-editable chips (today), or plain text with a pencil to edit (Lipa's
app)?

---

## E. Snooze, Request update, reminders, alerts

| #   | Proposal                                                                                                                                                                                                                                                                                                                       | Source            | Work           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------- |
| E1  | **Snooze a task.** It leaves the active lists until a date and comes back by itself. **The due date and every overdue count never change.** A Snoozed view lists what's parked.                                                                                                                                                | Meeting (Aligned) | BE + FE        |
| E2  | **When it wakes:** an alert to whoever snoozed it. _Video 1:26: in Lipa's purchase-order app, snoozed items come back into Notifications on their day._                                                                                                                                                                        | Ticket app        | BE             |
| E3  | **Request update:** asks the assignees for progress. **A note is required.** In-app and email, at most every 5 minutes per task. The request is logged on the task ("Asked X for an update"). _Video 1:45–1:49: her issue card has Resolve / Add update / Request update, and the thread shows "Asked … for an update"._       | Meeting (Aligned) | BE + FE        |
| E4  | **Reminders: a date and time plus a note,** seen only by you, delivered through your alerts. **Change (video 1:30):** HL Central's reminders today _need a start date_ and are set relative to it ("1 hour before"); Lipa's are an exact date and time. Proposal: exact date and time, no start date needed.                   | Meeting (Aligned) | BE + FE        |
| E5  | **An Alerts group on the Dashboard:** mentions, reminders, assignments, snoozed.                                                                                                                                                                                                                                               | Meeting           | FE (+ E1)      |
| E6  | **Notifications in both places:** the bell and the personal section of the sidebar. _Video: HL Central already has a Reminders filter in Notifications; Lipa's sidebar has Notifications / My Reminders / Mentioned under "Personal"._                                                                                         | Meeting           | FE             |
| E7  | **Notification settings per kind of event** (assigned, status, comment, mention, update requested, due, overdue, snooze), **per channel: in-app, email and Connect.** Sound and push later. _Video 2:53: Lipa's settings have exactly this table, with Email / Slack / **Connect** columns, a sound picker and a push switch._ | Meeting           | BE + FE (+ K3) |

**Q-E1. Snooze: personal or for the task?** **Q-E2. Longest?** (Lipa's code: 6 days; her live
app: up to a month, as on screen at 1:53.) **Q-E3. Who may snooze?**
**Q-E4.** Should Request update also message them in Connect (K3)?

---

## F. Sub-tasks and task levels

| #   | Proposal                                                                                                                                                                        | Source            | Work    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| F1  | **Three levels at most:** project › task › sub-task. _Video 2:10: the older template editor lets any node be the parent of another, so nesting is unlimited today._             | Meeting (Aligned) | BE + FE |
| F2  | **Sub-tasks keep full task abilities.**                                                                                                                                         | Meeting (Aligned) | exists  |
| F3  | **A read-only box of the parent's details on a sub-task.** _Video 2:15: neither app shows the parent's details on a sub-task (HL Central only links it under "Relationships")._ | Meeting           | FE      |
| F4  | **Sub-tasks shown as a group** on the parent's page, each with status and priority, **plus progress ("1 of 3 done")** and All / Open / Done filters.                            | Meeting           | FE      |
| F5  | **Convert:** a sub-task to a standalone task, a task to a project, and back. _Video 1:54, 2:03, 2:21: "Convert to project" and "Convert back to ticket" in her ⋯ menu._         | Meeting           | BE + FE |

**Q-F1.** Is "project" a flag on a task (as in her code) or a separate kind? I propose the flag,
with the three-level limit.
**Q-F2.** Checklists (steps you tick, no status), as in Lipa's app? HL Central shows "Checklist:
coming soon".

---

## G. Templates and repeating tasks

| #   | Proposal                                                                                                                                                                                                                                                                                                                                                                    | Source            | Work          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------- |
| G1  | **Templates are company-wide or for one department.**                                                                                                                                                                                                                                                                                                                       | Meeting (Aligned) | BE + FE       |
| G2  | **The Templates list in groups.** _Video 0:51: Lipa renamed her templates live into categories: Flavor, R&D, Shipping._                                                                                                                                                                                                                                                     | Meeting           | FE (after G1) |
| G3  | **A clearer name for the button that makes tasks from a template.** _Video 1:09: the live label is "Instantiate" (with an "Instances 376" column)._                                                                                                                                                                                                                         | Meeting           | FE            |
| G4  | **The template editor beside the list,** main task and sub-tasks looking different, add a task by typing its name, **and "Node 1 · Root" wording gone.** _Video 0:41–0:45: the editor takes the whole page, with identical "Node 1 · Root" / "Node 2" cards, "+ Add node"; for parent vs child she showed stock items with their sales listings as a different card style._ | Meeting           | FE            |
| G4a | **NEW (video):** keep what the editor already has (role placeholders, start/due as days after, "blocked by / blocks"), restyled. Ask before leaving with unsaved changes (today a plain browser box). Deleting a template says tasks already made are kept.                                                                                                                 | Video             | FE            |
| G5  | **Tasks made automatically are told apart:** e.g. a "Made from: Alert – Review" chip. _Video 0:47: Lipa's generated tickets carry a "Launch: Apple" chip._                                                                                                                                                                                                                  | Meeting           | FE            |

**Q-G1.** The name for G3: "Use template" (my pick), "Start from template", "Make tasks now".
**Q-G2.** Group templates by department (the meeting) or by category, as Lipa did on screen?

---

## H. Dashboard and calendar

| #   | Proposal                                                                                                                                                                                                                                                                                                                                                      | Source            | Work                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- |
| H1  | **The Dashboard shows the core numbers grouped:** open, in progress, overdue, closed today, plus mentions. No empty space, no long lists. _Video 0:52–0:55: the older HL Central "My Day" shows a 40-row list and an empty right half; Lipa's dashboard has "Your insights" tiles: **Unread**, **Stale (no activity 2+ days)**, **Mentions awaiting reply**._ | Meeting           | FE (+ BE for "Stale")      |
| H2  | **Items open in place on the Dashboard** instead of jumping to a filtered list. _Video 0:55, 1:04, 1:37: tiles opened inline ("Click to expand / collapse"); 1:07: HL Central lands on a filtered list instead._                                                                                                                                              | Meeting           | FE                         |
| H3  | **One calendar** with a Me / Team toggle. _Video 2:52: Lipa's app has a separate Team Calendar page. The meeting chose one calendar; her layers are worth reusing: open tasks, overdue, repeats, reminders, meetings and calls, time off._                                                                                                                    | Meeting (Aligned) | FE                         |
| H4  | **Kinds of item look different in the calendar:** meetings, calls, tasks, deadlines, due dates. _Video 1:44: her legend is Meetings / Tasks / Deadlines / Dues._                                                                                                                                                                                              | Meeting           | FE                         |
| H4a | **NEW (video 1:52): "New event"** from the calendar or a task: kind (Meeting / Task / Deadline), title, time, attendees, a link or place (or a Connect room), linked task, notes.                                                                                                                                                                             | Video             | BE + FE (+ K2)             |
| H5  | **Calls and meetings in the calendar,** from Connect.                                                                                                                                                                                                                                                                                                         | Meeting           | CX (K4)                    |
| H6  | **Google Calendar sync:** a feed Google subscribes to.                                                                                                                                                                                                                                                                                                        | Meeting           | BE                         |
| H7  | **Department analytics and history.** _Video 2:49–2:52: Lipa's Analytics and our Insights design (as a picture) were compared._                                                                                                                                                                                                                               | Meeting           | → Insights (separate work) |

**Q-H1.** The Dashboard layout: on Nov 12 you chose the brief's, with the meeting's points. Add
the **Unread** and **Stale** tiles? ("Stale" needs a server change: HL Central keeps no
last-activity time.)

---

## I. Drafts, duties and SOPs

| #   | Proposal                                                                                                                                                                                                                                                              | Source                             | Work    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------- |
| I1  | **Drafts:** a place for ideas (title, notes, files, a reminder) that start no workflow, turned into a task when ready. Active / Waiting / Archived. _Video 2:25: Lipa's "Planning" page and its "New plan" form._                                                     | Meeting                            | BE + FE |
| I2  | **Structured SOPs** (checklists, questions, decision trees). _Video 2:42: shown as a questionnaire with recommended answers; 2:38: an Accounts Payable example._                                                                                                      | Meeting: **not needed for launch** | later   |
| I3  | **One file cabinet with filters.** _Video 3:08: Connect already has a Files page (search, filters, upload, record screen)._                                                                                                                                           | Meeting: **needs more discussion** | later   |
| I4  | **NEW (video 2:31–2:46): a page per duty:** what it's for, who's on it, its standard sub-tasks, a written SOP, a training video, open tasks and a "ready" checklist. Plus "My duties" for each person. HL Central has Departments & duties settings but no such page. | Video                              | BE + FE |

---

## J. Wording (Shloma)

| #   | Proposal                                                                                                                                                                                                                                                                                    | Work |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| J1  | **A plain-words list for the whole app,** for Shloma to approve. Words seen on screen: Instantiate, Instances, Node 1 · Root, + Add node, Role placeholder, Nest, Read-only. Also the duty name "Distributer Buying" (spelling). Lipa's words to avoid copying: SLA, Flavor, Simple ticket. | FE   |

---

## K. Connect integration

What Connect already offers to other apps (its "bot" API, with a key an Admin creates in
Connect):

- **Messages:** send to a person or a group chat.
- **Group chats:** create one and add people.
- **Calls:** book a call or ring people now; each gets a join link.
- **Meeting links.**
- **A chat pop-up** other `*.brecx.com` sites can embed.

Missing on Connect's side:

- telling another app when something happens;
- listing a person's calls;
- opening the pop-up on a specific chat;
- embedding outside `brecx.com`.

_Video 2:58–3:04:_

- Connect was shown mainly as its **own desktop window** (DMs, groups, calls, meetings, calendar,
  files, a **Tickets** section with Lipa's tickets inside it, and a ticket timer).
- Google Chat's small floating window, with voice notes and transcripts, was the model for "a
  small pop-up".

| #   | Proposal                                                                                                                                                                                                                                                                                                                                                                                                        | Source  | Work             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- |
| K1  | **Connect's chat one click away from HL Central:** a chat button opening Connect's pop-up (embed) or the Connect desktop app.                                                                                                                                                                                                                                                                                   | Meeting | FE + CX (domain) |
| K2  | **"Schedule call" on a task:** book a Connect call at a time or now, with quick times (in 30 min, in 1 hour, tomorrow 10:00, next Monday 10:00). Saved on the task and the calendar. **If Connect can't book it, it's still saved as a meeting and the person is told why.** _Video 1:43: her app showed "On the calendar, but Connect did not book the call: none of the participants has a Connect account"._ | Meeting | BE + FE          |
| K3  | **Task events as Connect messages,** per person's settings (the Connect column in E7).                                                                                                                                                                                                                                                                                                                          | Meeting | BE               |
| K4  | **Connect calls in HL Central's calendar.**                                                                                                                                                                                                                                                                                                                                                                     | Meeting | CX               |
| K5  | **"Discuss in Connect" on a task:** opens or creates a group chat for it.                                                                                                                                                                                                                                                                                                                                       | Meeting | BE + FE + CX     |
| K6  | **Create a task from a Connect chat or voice note.**                                                                                                                                                                                                                                                                                                                                                            | Meeting | CX + BE          |
| K7  | **NEW (video): HL Central tasks inside Connect,** the way Connect already shows Lipa's tickets (a Tickets section and a "time a ticket" timer).                                                                                                                                                                                                                                                                 | Video   | CX + BE          |

**Q-K1. Who owns users and permissions?** The meeting: HL Central. Connect and Lipa's app
follow **auth.brecx.com**. _Video 2:54: Lipa's app has its own Users page (members, department,
role, status). Its Permissions page was listed but never opened, so per-screen view/edit/hidden
wasn't shown._ A decision for Zev and Connect's owner.
**Q-K2.** Will HL Central live under `*.brecx.com` (needed for K1's pop-up)?
**Q-K3.** Which Connect workspace, and who creates HL Central's key?
**Q-K4.** Start with K2 and K3 (nothing needed from Connect's team), then K1, K5, K4, K6, K7?

---

## L. Raised in the meeting, outside Tasks

| #   | Proposal                                                                                                                                                                                                                                                                                         | Source                         | Work          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------- |
| L1  | **Sign-in:** drop password sign-in; no 8-hour sign-out on trusted devices. _Video 0:25: "You were signed out after a period of inactivity", with Google and password sign-in._ **Q-L1:** password sign-in is how people outside the company domain get in. Remove it only for company addresses? | Meeting                        | BE + FE       |
| L2  | **Timer:** not required at rollout; it should check the task has a duty. _Video 3:09–3:15: our redesign's timer already hints "Give the task a duty…" but still runs without one; a duty was added live to make it log._ So: **ask for a duty when the timer starts.**                           | Meeting                        | FE            |
| L3  | **NEW (video 2:55): "What's New" announcements:** an Admin posts an update (title, message, file/voice/screen), optionally as a pop-up that must be acknowledged, to everyone or to Admins and Managers only.                                                                                    | Meeting ("what's new" section) | BE + FE       |
| L4  | **Org tree views:** _Video 2:47: HL Central's Organization page already has reporting lines / by department / by person / by duty._ Lipa's adds drag-to-reassign and "reporting to nobody" / "without a duty" counts.                                                                            | Meeting                        | FE (optional) |
| L5  | **Elsewhere:** reports for Amazon competitor and buyback metrics, the HR module, the subscriptions register, catalog and purchase orders (Stockyle), merging other tools into HL Central.                                                                                                        | Meeting                        | not here      |

---

## Open items about the sources

- What was said is known only from Gemini's notes. The video's pictures confirm what was shown,
  not what was decided. The word-for-word transcript (a Google Meet "Transcript" doc) would
  settle the rest.
- Not seen on screen: the snooze badge, the delete undo banner, per-screen permissions, turning
  chat messages into events, Google Calendar sync settings, and a repeating-task icon.
