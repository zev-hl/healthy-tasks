import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// backend/ (this file lives in backend/test/)
const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface TestDb {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Start a throwaway Postgres for the test run and apply the project's real
 * Prisma migrations to it (so the schema AND the supervisor-role trigger are
 * exercised exactly as in production).
 *
 * By default this uses `embedded-postgres`, which runs a real Postgres binary
 * with no Docker required. Set TEST_DATABASE_URL to point at an existing
 * Postgres instead (e.g. a CI service container).
 */
export async function startTestDb(): Promise<TestDb> {
  if (process.env.TEST_DATABASE_URL) {
    const url = process.env.TEST_DATABASE_URL;
    applyMigrations(url);
    return { databaseUrl: url, stop: async () => {} };
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'ht-testpg-'));
  // A high, unlikely-to-collide port for the ephemeral instance.
  const port = 49152 + Math.floor(Math.random() * 15000);

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test',
    password: 'test',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('healthy_tasks_test');

  const url = `postgresql://test:test@localhost:${port}/healthy_tasks_test?schema=public`;
  applyMigrations(url);

  return {
    databaseUrl: url,
    stop: async () => {
      await pg.stop();
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

function applyMigrations(databaseUrl: string): void {
  // Resolve the local prisma CLI so this works cross-platform without relying
  // on `npx` shell resolution.
  const prismaBin = join(BACKEND_ROOT, '..', 'node_modules', 'prisma', 'build', 'index.js');
  try {
    execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`;
    throw new Error(`prisma migrate deploy failed:\n${out}`);
  }
}
