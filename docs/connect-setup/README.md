# Connect deploy kit

Everything needed to stand up our Connect on Render + Neon and link it to HL
Central, as files to follow in order. **No secret values are in here, and none
may ever be added** — this repo is public. Secrets live only in the owner's
vault and in Render's Environment pages.

The authoritative plan is `docs/connect-deploy-plan.md`; where it and its §13
(answers checked in Connect's source) disagree, §13 wins, and this kit already
follows §13. What each app needs from the other is in `docs/connect-changes.md`
(branch `redesign`).

Read / do in this order:

1. [`first-deploy-checklist.md`](first-deploy-checklist.md) — the one ordered
   list, empty accounts → "HL Central's Connect tile opens it", with who does
   each step. Start here; it points into the files below.
2. [`secrets.md`](secrets.md) — how to make each secret, where it is kept,
   which ones must never change.
3. [`neon.md`](neon.md) — the Neon project `connect` (N. Virginia).
4. [`render.md`](render.md) — the Render web service `hlcentral-connect`, and
   the post-deploy checks.
5. [`render-env.md`](render-env.md) — every environment variable on Connect's
   Render service.
6. [`hlcentral-env.md`](hlcentral-env.md) — the three `CONNECT_*` variables on
   HL Central's Render service.

**Never put Connect's source in this repo.** It lives only in the private repo
`zev-hl/connect`.
