# HL Central's side: `CONNECT_*` on `hlcentral-api`

Render → `healthy-tasks` project → **production** → `hlcentral-api` →
*Environment*. Production is **Protected**: lift protection for this, then
re-protect. *Save and deploy.* Who: **owner** (or developer with access).

**When:** only after Connect is deployed and checked (`render.md` §5), the
owner has signed in, and bots/scheduled calls are confirmed (step below).
Ideally after LiveKit too — once `CONNECT_URL` is set, HL Central's "Call"
button shows, and calls can't be joined without LiveKit (plan §7.1).

| Key | Put | How to get it | Switches on |
|---|---|---|---|
| `CONNECT_URL` | `https://hlcentral-connect.onrender.com` (later `https://connect.<domain>`), **no trailing slash** | the Render service's address | with the key: chat pop-up, nine-dot tile for everyone, Connect notices, Call on a task, Discuss in Connect (K1–K5) |
| `CONNECT_API_KEY` 🔒 | the key | Connect → Settings → Misc → API access → new key, **read/write** (send-only is not enough), named `HL Central`. Shown once → vault → here | needed with `CONNECT_URL` |
| `CONNECT_INBOUND_KEY` 🔒 | `openssl rand -base64 48` (32+ chars or it stays off) | `secrets.md`; the same value goes on Connect as `HLCENTRAL_KEY` | `/api/integrations/connect` for Connect to call (K6/K7) |

## Before setting them: check the key works

```bash
curl -s -H "Authorization: Bearer $CONNECT_API_KEY" \
  https://hlcentral-connect.onrender.com/api/v1/bots/convenes
```

JSON (even an empty list) = good. **403** = bots/scheduled calls not allowed:
check the workspace row is still `plan = 'internal'`, `is_internal = true` (id
`00000000-0000-7000-8000-000000000001`). Do not link the Brecx Platform to fix it.

## Checks after the deploy

- [ ] The **nine-dot tile** for Connect shows and opens Connect in a new tab
- [ ] The **chat button** shows on every page (the frame stays blank until
      Connect's `EMBED_EXCEPTIONS` commit is deployed — plan §8.4)
- [ ] Notification settings show a **Connect** column; a Connect notice you
      turned on arrives from the HL Central bot with a link back
- [ ] **Discuss in Connect** makes a group with the right people
- [ ] **Call on a task** (if LiveKit is up): *now* rings; *at a time* books
- [ ] Inbound key:
      `curl -s -H "Authorization: Bearer $CONNECT_INBOUND_KEY" "https://hlcentral-api.onrender.com/api/integrations/connect/tasks?as=<your HL Central email>"`
      → `{ "tasks": [ … ] }` (401 wrong key; 404 no active user with that address)
- [ ] Calendar's "Connect calls" layer is empty — expected (K4 isn't built in Connect)

## Rules

- **Production only.** Never link staging HL Central to production Connect —
  staging's data has real people's addresses.
- **Roll back:** unset `CONNECT_URL` and `CONNECT_API_KEY` → every Connect
  feature in HL Central switches off.
- Follow-up on `main`: add the three keys to HL Central's `render.yaml` as
  `sync: false` so the Blueprint documents them (no values).

## One sign-in for Connect (Stage 5, checklist G)

| Variable | When | Value |
| --- | --- | --- |
| `CONNECT_AUTH_URL` | with the rest of G | this API's address + `/api/connect-auth` |
| `CONNECT_SIGNING_KEY` 🔒 | G | `openssl genpkey -algorithm ed25519 \| base64 -w0` |
| `CONNECT_ORG_ID` | G | a uuid, lower case, never changed |
| `CONNECT_PROVISION_SECRET` 🔒 | G | the same value as Connect's |
| `CONNECT_WORKSPACE_NAME` | optional | default `HL Central` |

Check: `curl https://<API>/api/connect-auth/.well-known/jwks.json` shows one
key; Settings → Connect sign-in says it is on. **Roll back:** unset
`CONNECT_SIGNING_KEY` → the sign-in routes answer 404 and Connect's button
fails; set Connect's `CENTRAL_SIGNIN=off` too. Details: `docs/connect-changes.md`
§7 on the `redesign` branch.

