# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HL Central ("healthy-tasks") — a task-management web app: users, tasks with
hierarchy/dependencies, comments, attachments, notifications, reminders,
recurring tasks & templates, SMART goals, reporting, and fine-grained access
control.

> The root `README.md` describes only "Phase 1" and is **stale** — the codebase
> is through ~Phase 15. For deep, current design detail (data model, lifecycle
> state machines, access-control rules, scheduler design) treat
> **`docs/architecture.md`** as the authoritative reference; `docs/*-spec.md`
> files cover individual features/changes.

## Commands

Run from the repo root unless noted. This is an **npm workspaces monorepo**
(`packages/*`, `backend`, `frontend`).

```bash
npm install                    # install all workspaces
npm run build:shared           # compile packages/shared — REQUIRED before backend/frontend typecheck

npm run dev:backend            # Express API w/ hot reload (tsx watch)
npm run dev:frontend           # Vite dev server

npm run lint                   # ESLint across the repo
npm run format                 # Prettier write
npm test                       # backend integration suite (see Testing below)

# Prisma / DB (backend workspace)
npm run prisma:generate --workspace backend
npm run prisma:migrate  --workspace backend   # create a new dev migration
npm run prisma:deploy   --workspace backend   # apply migrations
npm run db:seed         --workspace backend   # create the first admin user
```

### "Update the migrations" (shorthand)

When the user says **"update the migrations"**, it means: apply any pending
(already-committed) migration files to the running Docker Postgres, step by step,
then refresh the Prisma client. The local `.env` `DATABASE_URL` points at the
compose hostname `db:5432`, so run these **inside the backend container** (in
order):

```bash
docker compose exec backend npm run prisma:deploy   --workspace backend  # apply all pending migrations
docker compose exec backend npm run prisma:generate --workspace backend  # regenerate the client
```

This is `prisma migrate deploy` (non-interactive, applies pending migrations) —
**never** `prisma:migrate` / `migrate dev`, which authors *new* migrations. Use
this when pulling another machine's migration files via git: the migration files
travel through git, but each machine's database is separate and must be migrated
locally.

Frontend tests use Vitest and are **not** covered by root `npm test`:

```bash
npm run test --workspace frontend        # vitest run
npm run test:watch --workspace frontend
```

Full local stack (Postgres + backend + frontend + MinIO + Redis + queue
dashboard; the email worker runs inside the backend) via `docker compose up
--build`. The backend runs `prisma migrate deploy` automatically on startup.
After adding backend packages, use `docker compose up --build -V`, or the
containers' own `node_modules` volumes hide the new packages. Add
`--remove-orphans` once to drop the old separate `worker` container.

Email queue (see Email delivery below):

```bash
# Queue dashboard: http://localhost:3005/bullmq locally; Render: <API>/bullmq behind a password
docker compose exec backend npm run queue:test-email -- you@example.com  # queue one test email
docker compose exec backend npm run queue:clean-failed-emails            # run the weekly failed-email cleanup now
docker compose logs -f backend                                           # watch the email worker (inside the API) send
npm run worker:dev --workspace backend    # the worker as its own process (with EMAIL_WORKER_IN_API=false on the API)
```

## Testing

- **Backend** (`backend/test/`): one integration suite (`integration.test.ts`)
  driven by `node --test` that exercises the API end-to-end. By default it boots
  an **ephemeral real Postgres** via `embedded-postgres` (no Docker), applies the
  project's actual Prisma migrations (schema **and** triggers), and
  `TRUNCATE`s + reseeds between each test. Point at an existing DB with
  `TEST_DATABASE_URL`. To run a single case: `npm test --workspace backend --
  --test-name-pattern "<name>"`.
- The suite imports `createApp` and drives services directly. The recurrence
  **scheduler is never started under tests** — tests call `runScheduler`
  themselves for determinism.
- Tests always use `EMAIL_DELIVERY=direct` and need no Redis.
- **Backend unit tests** (`backend/test/unit/`, no database):
  `npm run test:unit --workspace backend`. A few load `config/env.ts`, so on the
  host set any `DATABASE_URL` and `JWT_SECRET` (placeholders are fine).

## Architecture

### Shared types are the contract
`packages/shared/src/index.ts` (~1700 lines) is the single source of truth for
all DTOs, request/response shapes, enums (`Role`, task statuses, etc.), and
label/constant maps used by **both** backend and frontend. Change a contract
here, then `npm run build:shared` — otherwise the other workspaces typecheck
against stale `dist/`.

### Backend layering (vertical slice per feature)
Each feature is a slice through the same layers; follow the existing pattern when
adding one:

```
routes/*.routes.ts        Router + middleware wiring; imports Zod schemas + controllers
  → validation/schemas.ts validateBody(schema) parses & replaces req.body
  → controllers/*.controller.ts  thin HTTP glue, wrapped in asyncHandler
    → services/*.service.ts      business logic; talks to Prisma
      → *.mapper.ts              Prisma row (+ include shape) → shared DTO
```

`app.ts` (`createApp`) mounts every router under `/api/*` and installs the
`notFoundHandler` + central `errorHandler`. `server.ts` owns the listen +
graceful shutdown + scheduler start + boot-time production-readiness warnings.

### Errors & validation
Throw `HttpError` (`utils/http-error.ts`, e.g. `HttpError.badRequest(...)`,
`.unauthorized()`, `.forbidden()`) — the central `errorHandler` turns it into the
shared `ApiError` JSON shape and also maps Prisma `P2002` → 409. Wrap async
controllers in `asyncHandler`. Validate input with `validateBody(zodSchema)`.

### Auth & sessions
Stateless JWT with a revocation path. `requireAuth` (`middleware/auth.ts`)
verifies the token **and** re-checks on every request that the user exists, is
active, and `token.tv === user.tokenVersion`. Bumping `tokenVersion`
(deactivation / password reset / a new sign-in address) instantly invalidates outstanding tokens.
Authorize with `requireRole('Admin', ...)` / `requireAdmin` after `requireAuth`.

Sessions are **sliding/idle**, not fixed-lifetime: every authenticated response
carries a freshly signed token in the `X-Refreshed-Token` header (CORS-exposed);
the frontend API client swaps it into `localStorage` on each response. So the
`JWT_EXPIRES_IN` window (default `15m` in `env.ts`) is measured from the *last*
request — continuous use never logs you out, but a full idle window with no
requests expires the session and the SPA bounces to login. No self-registration
— Admins create users.

The address decides the way in: with `GOOGLE_ALLOWED_DOMAIN` set, a company
address signs in with Google only and any other with a password only
(`utils/allowed-domain.ts`, `signInMethodFor`). When an Admin changes someone's
address, both addresses are emailed (how to sign in now; a notice to the old one),
the old Google link and reset links are cleared, and `tokenVersion` is bumped so
they are signed out everywhere — see `docs/architecture.md` §4.

### Access control (Phase 13)
`services/access-control.service.ts` is central and non-trivial: per-task access
levels, parent/child tree inheritance, list scoping, assignee restrictions,
private tasks, and the review workflow. Task queries build their `where` via
`buildTaskAccessWhere` / access-scope helpers rather than querying `Task`
directly. Read `docs/architecture.md` §10 before touching task visibility.

### Optimistic concurrency
Mutable records carry a version; services call `assertNotStale`
(`utils/optimistic.ts`) to reject stale writes (409). The frontend surfaces this
via `useStaleWriteGuard` / `ConflictBanner`.

### Task special attributes (HLAI-118)
Optional, fixed-list attributes on a task — Alert Group (`Task.alertGroupId` →
`AlertGroup`) and Alert Type (`Task.alertType`, one of `EXCLUSIVES_ALERT_TYPES`) —
shown under the task page's property row (pencil → searchable dropdowns, saved
together with Save), as a capsule column in the task list, and as a list filter with "(not
set)". One list drives all of it: `TASK_ATTRIBUTE_KEYS` (shared) +
`lib/taskAttributes.ts`. A group an Admin switches off stays on its tasks (red
mark on the task page) but can no longer be picked. See `docs/architecture.md` §15.

### Alert Tasks (HLAI-112)
An Admin screen (`/exclusives/alert-tasks`) linking each Exclusives alert type to a
template and a person per role of that template, for tasks to be made from alerts
automatically. The setup is stored (`AlertTaskSetting`, Admin-only
`GET`/`PUT /api/exclusives/alert-tasks`). Immediate alerts make their tasks at the
end of each Exclusives pass (`services/exclusives/alert-tasks.service.ts`); an
alert's `taskHandledAt` makes sure it never makes two, and alerts from before
go-live none. Daily alerts make one task per group and type at 8:30 AM business
time (a scheduler pass), the day's alerts in a table with links to the Alert Log —
the only link rich text may keep. The Organization screen won't take away a
duty someone's Alert Task Setup role needs (that role is set to "Leave
unassigned" there first). Run both by hand with
`docker compose exec backend npm run alert-tasks:run --workspace backend`. See
`docs/architecture.md` §16.

### Background scheduler
`services/scheduler.service.ts` runs recurrence materialization, reminder-email
dispatch, and goal-review passes. Started only from `server.ts` and only when
`SCHEDULER_ENABLED !== false` (it's off on staging to keep the Neon compute from
staying awake 24/7 — meaning recurrences/reminders don't fire there). Design is a
two-clock model (coarse ceiling + earlier-only fine wake), re-derived from the DB
every pass so nothing caches into staleness; a watchdog emails admins if the
heartbeat stalls.

### Email delivery
Every email goes through `queueEmail(email, { kind })` (`queue/email-queue.ts`);
never call `mailer.send` directly. With `EMAIL_DELIVERY=queue` (the
docker-compose default) it goes on a BullMQ queue in Redis and the **email
worker** (`queue/email-worker.ts`) sends it, retrying a failure every 2 minutes,
10 times. The worker runs inside the API process by default
(`EMAIL_WORKER_IN_API`, started from `server.ts`), locally and on Render; set it
to `false` to run `src/worker.ts` as a separate service instead. With `direct`
(the app's default, always under tests) the API sends it itself; if Redis is
down in queue mode, it falls back to that. Emails that run out of tries are kept
in the `FailedEmail` table, which the worker empties of `failed` rows every
Sunday 04:00 business time. The API must get SIGTERM itself (Render: `node
backend/dist/server.js`, not `npm start`) so it finishes the emails it is
sending before it stops. The queue dashboard (`queue/dashboard-board.ts`) is
`http://localhost:3005/bullmq` locally (its own container, no sign-in); the API
also serves it at `/bullmq` behind HTTP Basic auth when `QUEUE_DASHBOARD_USER`
and `QUEUE_DASHBOARD_PASSWORD` (16+ characters) are set (staging and production,
each its own pair). Admins open it from the profile page's "Queues Dashboard" card,
which follows `VITE_QUEUE_DASHBOARD_URL`. Full design: `docs/architecture.md` §14.

### Storage
`storage/index.ts` selects a backend by `STORAGE_DRIVER`: `memory` (tests) or
`s3` (default — MinIO locally, any S3-compatible bucket in prod). **File bytes
never pass through the API** — clients upload/download directly via pre-signed
URLs. For S3, `S3_ENDPOINT` is used for server-side ops while
`S3_PUBLIC_ENDPOINT` signs the URLs the browser must reach.

### Rich text
User-authored HTML (task descriptions, comments) is sanitized server-side
(`utils/rich-text.ts`, `sanitize-html`) and rendered via TipTap / DOMPurify on
the frontend. Links are stripped, except one to the Alert Log (HLAI-112's Daily
alert tasks), which is kept on the server, the display and the editor alike.
Tables are allowed (the editor's Table menu, `@tiptap/extension-table`); a cell
keeps only its colspan/rowspan. `express.json` limit is raised to 2mb to fit rich-text payloads.

### Database invariants live in Postgres
Some rules can't be a `CHECK` constraint (they depend on other rows) and are
enforced by **triggers** in migrations — e.g. `user_supervisor_role_check`
(a `supervisorId` must point at a Manager/Admin). These are enforced in two
layers: a friendly app-layer check in the service **and** the DB trigger as the
backstop. Migrations are ordered/named by phase under
`backend/prisma/migrations/`.

### Frontend
Vite + React SPA, `react-router-dom` **data router** (`router.tsx`) with
`React.lazy` code-splitting per route (keeps the heavy TipTap editor out of the
first paint). Auth state in `auth/AuthContext.tsx`; the single fetch wrapper is
`api/client.ts` (attaches the bearer token, consumes `X-Refreshed-Token`, and
routes 401s to a global unauthorized handler). `RequireAuth` gates routes and
enforces `roles`.

## Config

Backend config is centralized and validated in `backend/src/config/env.ts`
(missing required vars throw at boot). Copy `.env.example` → `.env`. Notable
vars: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `EMAIL_PROVIDER`
(`console` dev / `smtp`), `EMAIL_DELIVERY` (`direct` / `queue`),
`EMAIL_WORKER_IN_API` (`true` default / `false`), `REDIS_URL`,
`EMAIL_RETRY_DELAY_SECONDS`, `EMAIL_MAX_RETRIES`, `QUEUE_DASHBOARD_USER` /
`QUEUE_DASHBOARD_PASSWORD` (the API's own queue dashboard), `STORAGE_DRIVER`,
`SCHEDULER_ENABLED`, the `S3_*` set, and `SEED_ADMIN_*`. Run as its own process,
the email worker loads only `config/email-config.ts` and
`config/business-time-zone.ts`, not `env.ts`, so it needs none of the API's
secrets.
