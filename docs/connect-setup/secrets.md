# Secrets: make, keep, never change

**Rule:** no secret value goes in a repo, a chat, a ticket or an email. Each
one is generated, stored in the **owner's vault first** (plan D12: a shared
vault/password manager the owner controls), then pasted into Render.
Render is not a backup.

## How to make each

| Secret | Make it with | Where it goes | Can it change? |
|---|---|---|---|
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` (32 random bytes, base64) | Connect (Render) | **Never.** See below |
| `SEED_OWNER_PASSWORD` | `openssl rand -base64 24`, or the vault's generator | Connect (Render), first deploy only | Temporary: the owner changes it at first sign-in, then it is deleted from Render |
| `CONNECT_INBOUND_KEY` = `HLCENTRAL_KEY` | `openssl rand -base64 48` (one value, used on both sides) | HL Central (`CONNECT_INBOUND_KEY`) **and** Connect (`HLCENTRAL_KEY`) | Yes, but on both sides in the same sitting. Must be 32+ characters or HL Central keeps it off |
| `CONNECT_API_KEY` | Not generated: **minted in Connect** → Settings → Misc → API access → new key, read/write, named `HL Central`. Shown once | HL Central (Render) | Yes: mint a new one, swap it in HL Central, revoke the old one |
| `DATABASE_URL` | Copied from Neon (pooled string, see `neon.md`). Holds the role's password | Connect (Render) | Yes, if the Neon role's password is reset — update Render the same minute |
| `SMTP_PASS` | From the mail provider (Google Workspace: an **App Password** for the sending mailbox) | Connect (Render) | Yes: make a new App Password, swap, revoke the old |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → Manage API tokens → Account API token, **Object Read & Write**, bucket `hl-connect` only. Shown once | Connect (Render) | Yes: new token, swap, delete the old |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (later) | Written by LiveKit's config generator on the droplet (plan §7.2) | Connect (Render), all three `LIVEKIT_*` at once | Yes, together with the droplet's config |

`openssl` is on any Mac/Linux. Without it, the same 32-byte key:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## `DATA_ENCRYPTION_KEY` — the one that matters most

- It encrypts message bodies, notes, to-dos, reminders, the ticket cache and
  the API failure log (plan §13 #9).
- **Connect cannot rotate it** (one key, no key id). A changed or lost key
  leaves every encrypted item showing "[Encrypted message — key missing or
  wrong]" — in the live app, in every Neon restore and in every dump.
- Set it **before the first real message** (without it, text is stored
  unencrypted and boot only warns).
- Keep it in **two places outside Render**: the vault, plus a second copy the
  owner controls (e.g. printed, in a safe).
- A staging Connect (later) gets its **own** key.

## Who keeps what

| Who | Holds |
|---|---|
| Owner | The vault and every value in it; the second copy of `DATA_ENCRYPTION_KEY` |
| Developer | Pastes values from the vault into Render while setting up; keeps no copy elsewhere |

## Never change once set

- `DATA_ENCRYPTION_KEY` (ever).
- The Render service **name** and **region**, and the Neon **region** — not
  secrets, but fixed at creation.
