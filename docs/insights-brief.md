# Insights: brief for the next design session

The mockup `docs/mockups/insights/` (`kpi-mockup.html`, `kpi-desktop.png`, `NOTES.md`) is a
first idea for a KPI page. It was reviewed, and the user changed its direction. **Follow this
brief where it differs from the mockup.** The mockup's KPI formulas and data sources in
`NOTES.md` still hold.

Work on the `redesign` branch, in the Harbor style (`docs/redesign-brief.md`,
`docs/redesign-decisions.md`, `CLAUDE.md` › Frontend). Frontend only: no schema, migration or
API-contract changes on this branch. Anything that needs the backend goes on the backend jobs
list in `docs/redesign-decisions.md`.

## Decisions so far

1. **Everyone sees it.** Members, Managers and Admins alike.
2. **Individual first, not teams.** The page opens on _my own_ numbers: the KPIs are about one
   person. Team or department roll-ups are secondary at most (see the open questions).
   Per person, the mockup's KPIs become:
   - on-time completion % (my tasks completed in the period, by their due date);
   - tasks completed;
   - median cycle time (created → completed);
   - overdue now (count, oldest);
   - hours logged vs expected (8h × weekdays, for now);
   - timesheet days submitted;
   - my goals: by stage, and met/exceeded when resolved;
   - each with the change against the previous period and a 12-week trend where it makes sense.
3. **Add the "Job plate": a "My job" card.** It shows who the person is at work:
   - title and job description (`UserDto.title`, `jobDescription`);
   - supervisor;
   - departments and the duties they hold;
   - per duty, the time logged and the number of tasks in the period.

   It sits prominently, as the first card or beside the KPI tiles.

## Still to ask the user (before building)

- **Where it lives:** a new "Insights" sidebar item (as mocked), or a tab on the Dashboard?
- **Other people's pages:** can a Manager or Admin open someone else's page (a person picker, limited to their
  downline / everyone), and is there still a team roll-up for them?
- **Comparison:** against the same days of the previous period (as mocked), or the whole previous period?
- **Expected hours:** 8h per weekday for everyone? (No holidays, leave or part-time data exists.)
- **Two KPIs need backend jobs:** a daily overdue snapshot for "since …" deltas, and review turnaround.
  Include them as marked placeholders, or leave them out of the first version?

## How to work

- Show a mockup or screenshots first, then build. Check desktop (1440×900) and phone.
- Keep the conventions used across the redesign:
  - `hb-` prefixed classes in `frontend/src/harbor.css`, with no clashes with existing class names;
  - Harbor `Select` / `DatePicker` instead of the browser's own pickers;
  - side panels, not pop-ups;
  - no thick colored edges.
- Run `npx tsc --noEmit -p .`, `npx vitest run` (frontend) and `npm run lint` before each commit.
