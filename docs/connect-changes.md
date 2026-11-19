# HL Central ⇄ our Connect: what each side needs (Nov 2026 plan, Stage 4)

HL Central's side of K1–K7 is built and switched off until the settings below
are set. This page is for whoever runs our copy of Connect (Brecx Connect,
`apps/api` + `apps/web`): the **settings** both sides need, and the **changes in
Connect** that K1, K4, K6 and K7 depend on. File paths refer to the Connect
source.

Everything HL Central sends Connect goes through Connect's existing bot API
(`docs/bot-api.md`, `docs/api-key.md`); the only new Connect endpoint is §3.

## 1. Settings (no code)

| Where | What | For |
| --- | --- | --- |
| Connect: Settings → Misc → API access | Mint a **read/write API key** named **HL Central**. It is shown once. | K2, K3, K5 (and K4 once §3 is in) |
| Connect: the workspace's plan | Must include **bots** and **scheduled calls**. | K2 (booking returns 403 otherwise) |
| HL Central (Render env) | `CONNECT_URL` = Connect's address (e.g. `https://connect.brecx.com`), `CONNECT_API_KEY` = that key. | Switches on K1, K2, K3, K4, K5 |
| HL Central (Render env) | `CONNECT_INBOUND_KEY` = a long random secret (`openssl rand -base64 48`). | K6, K7 (Connect → HL Central) |
| Connect (Render env) | `HLCENTRAL_URL` = HL Central's API address; `HLCENTRAL_KEY` = the same secret as `CONNECT_INBOUND_KEY`. | K6, K7 |

People are matched **by email** both ways: a person's HL Central address must
be their Connect address.

## 2. K1 — the chat pop-up inside HL Central

HL Central shows a chat button on every page that opens Connect in a frame
(`<iframe src="{CONNECT_URL}/" allow="camera; microphone; display-capture;
clipboard-write; autoplay; fullscreen">`), with "Open in Connect" beside it. Connect is also an **app in HL Central's
nine-dot menu**: its tile opens Connect in a tab of its own (no frame, so it needs
no change in Connect). The tile shows for everyone once Connect is linked; Admins
see it before, leading to `/connect`, which says what to set.

**Connect change:** let HL Central's address frame Connect. Add it to
`EMBED_EXCEPTIONS` in `apps/api/src/app.ts` (beside the ticket app), e.g.
`https://hlcentral.onrender.com` — or serve HL Central on a `*.brecx.com` name,
which the `frame-ancestors` rule already allows and which keeps the sign-in
cookie same-site. Until then the frame stays blank and "Open in Connect" works.

Nice to have (embed.md "Not built yet"): opening the pop-up on a given chat
(`?c=<conversationId>`), so "Discuss in Connect" (K5) can open in the pop-up
instead of a new tab, and the unread count on the button via `postMessage`.

## 3. K4 — Connect calls on HL Central's calendar (new endpoint)

Calls booked **from HL Central** are already on its calendar (they are its own
events). For calls booked **in Connect itself**, HL Central asks:

```
GET /api/v1/bots/people/:person/convenes?from=<ISO>&to=<ISO>
Authorization: Bearer <read/write key>
```

- `:person` — an email, @username or id, as in `to` elsewhere.
- Answer: `{ "calls": [ { "id", "title", "startAt", "endAt" | null, "status",
  "joinUrl", "host", "externalRef" | null } ] }` — the scheduled calls in the
  range that the person **hosts or is invited to** (not ones they declined),
  any bot or person having booked them; cancelled ones may be left out.
- Read/write keys only (a send-only token gets `403`): it shows somebody's
  calendar. Uses the 120/minute read budget.
- Where: beside `GET /convenes` in `apps/api/src/routes/bots.ts`, reading what
  `services/scheduled-calls.ts` already keeps for the in-app calendar.

HL Central treats `404` on this path as "not built yet" and shows no Connect
calls; it leaves out calls whose `externalRef` starts with `hlcentral:`.

## 4. K6 — "Create task in HL Central" from a chat or a voice note

**Connect change:** an action on a message (the message menu, like WorkTrack's
`components/worktrack/NewTaskDialog.tsx`) and on a voice note (with its
transcript as the text): a small dialog (title, assignee, due date), then
Connect's server calls HL Central:

```
POST {HLCENTRAL_URL}/api/integrations/connect/tasks
Authorization: Bearer {HLCENTRAL_KEY}
Content-Type: application/json

{
  "as": "person@company.com",          // the signed-in Connect person: the task's creator
  "name": "Order more boxes",           // 2–300 characters
  "text": "the message, or the voice note's transcript",   // optional, up to 10,000
  "assignee": "someone@company.com",   // optional; default: the creator
  "dueAt": "2026-11-24T17:00:00Z",      // optional
  "sourceUrl": "https://connect…/dms?c=…&m=…"              // optional, shown on the task
}
```

`201` → `{ "id", "name", "url" }`: post the link back into the chat ("Task
#123 made in HL Central"). HL Central makes it **as that person**, with their
rights (who they may assign to, and so on); its refusals come back as
`{ "error": "…" }` with `400`/`403`/`404` — show them as they are. `404` means
nobody active in HL Central has that address.

## 5. K7 — HL Central tasks inside Connect (a section and a timer)

**Connect change:** an "HL Central" section in the rail, the way Tickets is
one (`docs/tickets.md`), backed by these HL Central calls (same key as §4,
`as` = the signed-in person):

| Call | What it does |
| --- | --- |
| `GET /api/integrations/connect/tasks?as=…` | `{ "tasks": [ { "id", "name", "status", "priority", "dueAt", "url" } ] }` — their open tasks, soonest due first (up to 100). |
| `GET /api/integrations/connect/timer?as=…` | `{ "timer": { "taskId", "taskName", "startedAt", "checkInAt", "stopsAt" } \| null, "now" }` — their running timer, the same one HL Central shows. |
| `POST /api/integrations/connect/timer/start` | `{ "as", "taskId", "replacing": <taskId the section shows running> \| null }` — starts it (a timer on another task is stopped and saved first). |
| `POST /api/integrations/connect/timer/stop` | `{ "as", "taskId" }` — stops and saves it on the task. |

The timer is **one per person, kept on HL Central's server**, so HL Central
and Connect always show the same one. If it changed elsewhere since the
section last looked, a start or stop is refused with `409` and
`{ "details": { "code": "TIMER_CHANGED", "timer": <the one running>, "now" } }`
— show the running one and the message, change nothing. `now` is HL Central's
clock: use it for the running time. After `timerCheckInHours` (an HL Central
Admin setting, 4 by default) HL Central asks "Still working?"; with no answer
the timer stops itself and saves the time up to the question.

Opening a task goes to its HL Central `url` (a new tab, or the HL Central
pop-up once §2's reverse is wanted).

## 6. What needs no Connect change (already live once §1 is set)

- **K3** — task notices as messages from the HL Central bot, with a link back,
  per each person's settings in HL Central (one way: a reply in Connect does
  not post on the task). Sent with an `idempotencyKey`, so a retry never
  doubles a message.
- **K2** — "Call" on a task: rings now (`POST /api/v1/bots/calls`) or books
  (`/api/v1/bots/convenes`, `externalRef` `hlcentral:event:<id>`), the HL
  Central user hosting; moving or canceling the HL Central event moves or
  cancels the Connect call. When Connect refuses, HL Central keeps it as a
  meeting and shows Connect's reason.
- **K5** — "Discuss in Connect": makes the task's group (`POST
  /api/v1/bots/groups`: the assignee, the creator, the assignee's supervisor
  and whoever pressed it), posts a link back, and later reopens it, adding
  whoever presses it.

## 7. Stage 5 — sign in to Connect with HL Central (settings only)

Connect already has "central sign-in", built for auth.brecx.com
(`docs/central-signin.md` in Connect). HL Central plays that service's part,
so **Connect needs no code change**, only the settings below. People sign in to
Connect with their HL Central sign-in (Google for company addresses, password
for the rest), and Connect's member list follows HL Central.

| Where | Setting | Value |
| --- | --- | --- |
| HL Central | `CONNECT_AUTH_URL` | HL Central's API address + `/api/connect-auth`, e.g. `https://api.<domain>/api/connect-auth` |
| HL Central | `CONNECT_SIGNING_KEY` | an Ed25519 private key: `openssl genpkey -algorithm ed25519 \| base64 -w0` (keep it in the vault) |
| HL Central | `CONNECT_ORG_ID` | a fixed uuid naming our workspace (`uuidgen`, lower case); never change it |
| HL Central | `CONNECT_PROVISION_SECRET` | `openssl rand -hex 32`, the **same** value on both |
| HL Central | `CONNECT_WORKSPACE_NAME` | optional, default `HL Central` |
| Connect | `CENTRAL_SIGNIN` | `allowlist` (with `CENTRAL_SIGNIN_ALLOW` = a few addresses) to try it, then `on` |
| Connect | `CENTRAL_AUTH_URL` | exactly HL Central's `CONNECT_AUTH_URL` |
| Connect | `CENTRAL_SIGNIN_URL` | HL Central's site + `/connect-signin`, e.g. `https://app.<domain>/connect-signin` |
| Connect | `CONNECT_PROVISION_SECRET` | the same value as HL Central's |
| Connect | `CENTRAL_INVITES` | `off` (people are added in HL Central) |

Once, in Connect's database, name our workspace with that uuid (Connect has no
screen for it; its `central:backfill` script does the same):

```sql
UPDATE workspaces SET org_id = '<CONNECT_ORG_ID>' WHERE id = '<our workspace id>';
```

Then, as an HL Central Admin: **Settings → Connect sign-in → Send everyone to
Connect**. It links each existing Connect account to its HL Central person by
email (and adds anyone missing); from then on every change to a person in HL
Central (added, renamed, new address, role, deactivated or back) reaches
Connect by itself. HL Central Admins are Connect admins; everyone else is a
member. The workspace owner stays as they are.

How it works: Connect's "Continue with your Brecx account" button (worded by
Connect) asks HL Central's `/api/connect-auth/token` for a five-minute EdDSA
token, using a cookie HL Central set when the person signed in at
`/connect-signin`; Connect checks it against `/api/connect-auth/.well-known/jwks.json`
and opens a session. Signing out of HL Central, "Sign out everywhere", a
password reset or deactivation ends it.

Good to know:

- **One domain.** The cookie is on HL Central's API address and is asked for
  from Connect's site. Serve both on one domain (`api.<domain>`, `app.<domain>`,
  `connect.<domain>`); on unrelated addresses, browsers that block third-party
  cookies (Safari, and Chrome as it phases them out) will keep sending people
  back to sign in.
- **Password sign-in to Connect stays**, and is still the default form; Connect
  users with its email two-step keep using their password (Connect refuses
  central sign-in for them).
- **Deleting someone in Connect** asks HL Central first (signed); HL Central
  says yes. But who works here is decided in HL Central: deactivate them there,
  or the next push adds them back.
- The button's wording ("Brecx account") is Connect's; changing it to "HL
  Central" is a one-line change in Connect's web app, if wanted.

