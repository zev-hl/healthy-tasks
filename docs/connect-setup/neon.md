# Neon: the `connect` project

Plan §3 (choice B). A **separate project** from HL Central's — never Connect's
tables in HL Central's database, and not a second database inside HL Central's
project (it would keep HL Central's compute awake 24/7). Who: **owner** (or the
developer with the owner's Neon login).

## Create

1. **Neon console → New project.**
   - Name: `connect`
   - Region: **AWS US East 1 (N. Virginia)** — same as HL Central's Neon and
     the Render service. **Cannot be changed later.** Look at it twice.
   - Postgres version: Neon's default (17 or 18). Connect runs 18 in
     production and 16 in CI, needs no extensions (§13 #1).
   - Database name: `connect`. Keep the owner role Neon creates (e.g.
     `connect_owner`).
2. **Branches → `main` (production) → Computes → Edit:**
   - **Scale to zero: off.** Connect keeps sockets open and runs sweeps every
     15–30 s (§13 #8).
   - Autoscaling: min **0.25 CU**, max **1 CU**.
3. **Settings → Instant restore / history retention:** the longest the plan
   allows (7 days on Launch when last checked — confirm in Neon). This is the
   undo for a bad migration.
4. **Connect button** → Database `connect`, role `connect_owner`,
   **Connection pooling: on** → copy the string → **into the vault**. It is
   `DATABASE_URL` (the only database variable — §13 #2: no separate direct URL;
   migrations use the pooled string too).

## Check

- [ ] Project region shows **US East 1 (N. Virginia)**
- [ ] The host contains **`-pooler`** (e.g. `ep-xxxx-pooler.us-east-1.aws.neon.tech`)
- [ ] The string ends with `?sslmode=require` (keep `&channel_binding=require` if Neon adds it)
- [ ] Scale to zero is **off** on production
- [ ] After the first Render deploy: *Tables* shows Connect's tables

## Optional

A weekly `pg_dump` kept outside Neon (e.g. in R2). It is useless without
`DATA_ENCRYPTION_KEY` (message bodies are encrypted).

## Roll back

Before anything uses it: delete the project. After: Neon → `connect` →
*Restore* the branch to just before a bad deploy (messages since are lost), or
restore into a new branch and point `DATABASE_URL` at it to inspect first.
