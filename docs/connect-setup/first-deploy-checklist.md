# First deploy: empty accounts → HL Central's Connect tile opens it

One ordered list. Tick each box; don't skip ahead. **Owner** = the account
owner (holds the vault and the logins). **Developer** = whoever does the
technical steps (a person or a Claude session). Plan section in brackets.

## A. Decisions (owner)

- [ ] **Owner** — settle plan §1: D7 mail account + From address, D8 owner's
      name + **HL Central** email, D9 custom domain (can wait), D10 calls now
      or later, D11 workspace name, D12 the vault.

## B. The code (§2)

- [ ] **Owner** — GitHub → **New repository**: owner `zev-hl`, name `connect`,
      **Private**, *no* README, *no* .gitignore, *no* licence → **Create**.
- [ ] **Owner** — add `zev-hl/connect` to the Claude session that holds the
      source (or give the developer push access).
- [ ] **Developer** — push Connect's source to `main` (no `.env` files:
      `git ls-files | grep -i env` shows only examples). **Never** to
      `zev-hl/healthy-tasks`.
- [ ] **Developer** — check the repo shows `apps/api`, `apps/web`,
      `packages/db`, `pnpm-lock.yaml`, `.node-version`, a `render:build` script.
- [ ] **Owner** — Render → Account settings → Git providers → GitHub →
      Configure → *Repository access*: add `zev-hl/connect`.
- [ ] **Owner** (optional) — protect `main` if more than one person pushes.

## C. Accounts and secrets (§3, §5, `secrets.md`)

- [ ] **Owner** — Neon project `connect`, **N. Virginia**, scale-to-zero
      **off**, restore window max; pooled `DATABASE_URL` → vault (`neon.md`).
- [ ] **Owner** — Cloudflare R2 bucket `hl-connect` (private, CORS for
      `https://hlcentral-connect.onrender.com`), token scoped to it → vault
      (plan §5.1).
- [ ] **Owner** — SMTP mailbox + App Password → vault (plan §5.2).
- [ ] **Owner** — generate `DATA_ENCRYPTION_KEY` and `SEED_OWNER_PASSWORD`;
      `DATA_ENCRYPTION_KEY` in **two places** outside Render.

## D. Render service (§4, `render.md`, `render-env.md`)

- [ ] **Owner** — Render project `connect`, environment `production`.
- [ ] **Owner/Developer** — New Web Service `hlcentral-connect` from
      `zev-hl/connect`: **Virginia**, Standard, `main`, build/start commands,
      `/health`, ignored paths, 1 instance. Check region **before** Create.
- [ ] **Developer** — confirm variable names against Connect's `.env.example`.
- [ ] **Developer** — enter the **Required** and **Recommended** variables
      (values from the vault); none of *Leave unset*.
- [ ] **Developer** — first deploy; all post-deploy checks in `render.md` §5
      pass (`/health`, `auth/me`, tables, `SMTP ready`, `seeded owner`, no
      encryption warning, `mail:test` delivered).

## E. First sign-in (§6)

- [ ] **Owner** — sign in with `SEED_OWNER_EMAIL` / the temporary password;
      change the password; turn on 2FA.
- [ ] **Owner** — invite yourself at another address → the email arrives and
      its link works.
- [ ] **Developer** — `SEED_ON_BOOT=false`, delete `SEED_OWNER_*`, redeploy.
- [ ] **Owner** — Connect Settings: rename the workspace (`WORKSPACE_NAME` is
      display only); confirm **API access** and **scheduled calls** show.
- [ ] **Owner** — invite one colleague with their **HL Central** address;
      exchange messages and an attachment (proves R2).
- [ ] **Owner** — Render `connect` → production → **Protected**.

## F. Link HL Central (§9, `hlcentral-env.md`)

- [ ] **Owner** — Connect → Settings → Misc → API access → read/write key
      `HL Central` → vault.
- [ ] **Developer** — `curl …/api/v1/bots/convenes` with it → not 403.
- [ ] **Owner** — generate `CONNECT_INBOUND_KEY` → vault.
- [ ] **Owner/Developer** — HL Central production `hlcentral-api`: set
      `CONNECT_URL`, `CONNECT_API_KEY`, `CONNECT_INBOUND_KEY`; save and deploy;
      re-protect.
- [ ] **Developer** — Connect: `HLCENTRAL_URL`, `HLCENTRAL_KEY` (same value as
      `CONNECT_INBOUND_KEY`); redeploy at a quiet time.
- [ ] **Owner** — sign in to HL Central → nine-dot menu → **Connect tile
      opens Connect** in a new tab, already signed in or at its sign-in. ✅

## After go-live (not needed for the tile)

- [ ] **Developer** — Connect commit: HL Central's address in
      `EMBED_EXCEPTIONS` (the chat pop-up frame, plan §8.4).
- [ ] **Owner/Developer** — LiveKit (plan §7) **before** Call is announced.
- [ ] **Owner** — invite everyone with their exact HL Central addresses.
- [ ] **Developer** — the `hlcentral-env.md` checks (notice, Discuss, inbound curl).
- [ ] **Developer** — `render.yaml` updates: Connect's (match reality), HL
      Central's (`CONNECT_*` as `sync: false`).
- [ ] **Owner** — custom domain (D9, plan §8.3) when decided.
