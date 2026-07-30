# HL Central

A task-management web app. **This repository is Phase 1 — the foundation only:**
project scaffold, user data model, authentication, and admin user management.
Tasks, notifications, search, and the rest arrive in later phases.

## Tech stack

| Layer            | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Frontend         | React + TypeScript, built with Vite (SPA)         |
| Backend          | Node.js + Express + TypeScript                    |
| Database         | PostgreSQL (local via Docker; Neon in production) |
| ORM / migrations | Prisma                                            |
| Auth             | Email + password, stateless JWT                   |
| Local dev        | Docker Compose (frontend + backend + Postgres)    |

### Repository layout

This is an **npm workspaces monorepo** so the frontend and backend can share
types (the `Role` enum, `User` DTOs, request/response shapes) without
duplication — which the relational task/notification models in later phases will
lean on heavily.

```
healthy-tasks/
├─ packages/shared/   # Types & contracts shared by frontend and backend
├─ backend/           # Express API, Prisma schema, migrations, seed
├─ frontend/          # Vite + React SPA
├─ docker-compose.yml # Postgres + backend + frontend for local dev
└─ .env.example       # Copy to .env
```

## Quick start (Docker — recommended)

Requires Docker Desktop.

```bash
# 1. Create your local env file (defaults already work with Docker)
cp .env.example .env

# 2. Build and start Postgres + backend + frontend
docker compose up --build

# 3. In a second terminal, create the first admin user
docker compose exec backend npm run db:seed
```

Then open:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:4000/health
- Sign in with the seeded admin (defaults): `admin@healthy-tasks.local` / `ChangeMe123!`

The backend applies database migrations automatically on startup.

## Quick start (without Docker)

Requires Node 20+ and a local PostgreSQL you can point `DATABASE_URL` at.

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL host to localhost (see the commented line in the file)

npm install
npm run build:shared            # compile the shared types package once

# From the backend workspace:
npm run prisma:generate --workspace backend
npm run prisma:deploy   --workspace backend   # apply migrations
npm run db:seed         --workspace backend   # create the first admin

# Run the two dev servers (separate terminals):
npm run dev:backend
npm run dev:frontend
```

> Tip: if you change the shared types while developing on the host, re-run
> `npm run build:shared` (or `npm run dev --workspace @healthy-tasks/shared` to
> watch).

## Authentication model

- **Login** returns a short-lived **JWT** (default 15 min) which the SPA stores
  and sends as `Authorization: Bearer <token>`.
- Because JWTs are stateless, we add a **`tokenVersion`** per user. The auth
  middleware re-checks, on every request, that the user still exists, is active,
  and that the token's version matches. **Deactivating a user or resetting a
  password bumps `tokenVersion`, immediately invalidating existing tokens** —
  giving us prompt revocation without server-side sessions.
- **No self-registration.** Only Admins create users.

### Password reset (works end-to-end in dev)

1. A reset is triggered (user via _Forgot password_, or an Admin via the Users
   screen, or automatically when an Admin creates a user).
2. A random token is generated; only its SHA-256 **hash** is stored. The raw
   token goes into the reset link only.
3. The email is **printed to the backend console** in dev (see
   `EMAIL_PROVIDER=console`). Swap in a real provider by setting
   `EMAIL_PROVIDER=smtp` and the `SMTP_*` vars — see `backend/src/utils/mailer.ts`.
4. Opening the link → `/reset-password?token=…` lets the user set a new password.

## User model & the supervisor rule

`User` fields: `id`, `email` (unique login id), `title?`, `jobDescription?`,
`role` (`Admin` | `Manager` | `Member`), `supervisorId?`, `passwordHash`,
`isActive` (default true), `createdAt`, `updatedAt`.

**A `supervisorId` may only reference a user whose role is Manager or Admin.**
This is enforced in two layers:

1. **Application layer** (`backend/src/services/user.service.ts`) — friendly,
   specific error messages, plus an active-supervisor check and a guard against
   demoting a supervisor who still has reports.
2. **Database layer** — a Postgres trigger (`user_supervisor_role_check`,
   migration `…_supervisor_role_check`) guarantees the invariant even against
   direct SQL. A plain `CHECK` constraint can't express this because it depends
   on another row, so a trigger is the clean Postgres mechanism.

Deactivation is a **soft delete** (`isActive = false`, never a hard delete) and
also clears the user from any reports' `supervisorId`.

## API overview

| Method | Path                            | Access | Purpose                          |
| ------ | ------------------------------- | ------ | -------------------------------- |
| GET    | `/health`                       | public | Health check                     |
| POST   | `/api/auth/login`               | public | Email + password → JWT           |
| POST   | `/api/auth/logout`              | public | Client discards token (204)      |
| GET    | `/api/auth/me`                  | auth   | Current user                     |
| POST   | `/api/auth/forgot-password`     | public | Email a reset link               |
| POST   | `/api/auth/reset-password`      | public | Consume token, set password      |
| GET    | `/api/users`                    | admin  | List all users                   |
| GET    | `/api/users/supervisors`        | admin  | Eligible supervisors (Mgr/Admin) |
| POST   | `/api/users`                    | admin  | Create user (+ reset link)       |
| PATCH  | `/api/users/:id`                | admin  | Update user                      |
| POST   | `/api/users/:id/deactivate`     | admin  | Soft-deactivate                  |
| POST   | `/api/users/:id/reset-password` | admin  | Admin-triggered reset link       |

Role authorization is handled by `requireAuth` + `requireRole(...)` middleware
(`backend/src/middleware/auth.ts`) — the pattern future task endpoints will use.

## Environment variables

See `.env.example` for the full, commented list. Key ones:

- `DATABASE_URL` — standard Postgres connection string (Docker vs. localhost vs. Neon).
- `JWT_SECRET` — **set a long random value outside dev.**
- `EMAIL_PROVIDER` — `console` (dev) or `smtp` (real email).
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — used by the seed script.

## Tests

Integration tests (`backend/test/`) exercise the API end-to-end against a **real,
throwaway PostgreSQL** — no Docker required. On startup the suite:

1. boots an ephemeral Postgres via [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres),
2. applies the project's actual Prisma migrations (schema **and** the
   supervisor-role trigger), then
3. runs every case with a truncate-and-reseed between tests.

```bash
npm test                 # from the repo root (runs the backend suite)
```

Coverage includes: login success/failure & no-user-enumeration, validation
errors, admin create/list/deactivate, the supervisor Manager/Admin rule (both the
app-layer 400 **and** the DB trigger rejecting direct writes), self-supervision,
demotion-with-reports guard, role-based authorization (401/403), the full
password-reset round-trip, token reuse rejection, and JWT revocation via
`tokenVersion` after deactivation and after a password reset.

To run against an existing Postgres instead of the embedded one (e.g. a CI
service container), set `TEST_DATABASE_URL` — the suite will migrate and use it:

```bash
TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/ht_test" npm test
```

## Scripts (run from the repo root)

```bash
npm run dev:backend          # backend with hot reload
npm run dev:frontend         # frontend dev server
npm run build:shared         # compile shared types
npm test                     # backend integration tests (throwaway Postgres)
npm run lint                 # ESLint across the repo
npm run format               # Prettier write
npm run prisma:migrate       # create a new migration (backend)
npm run db:seed              # seed the first admin
```

## What's intentionally NOT here (later phases)

Tasks & task CRUD, notifications, search/dashboard, attachments, comments,
change history, warehouse integration, Google OAuth.
