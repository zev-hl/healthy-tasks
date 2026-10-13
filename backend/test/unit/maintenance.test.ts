import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEAN_FAILED_EMAILS,
  createMaintenanceProcessor,
  scheduleMaintenance,
  type FailedEmailCleanupTable,
} from '../../src/queue/maintenance.js';

/** A FailedEmail table holding rows in the given states. */
function tableWith(statuses: string[]) {
  const rows = [...statuses];
  const table: FailedEmailCleanupTable = {
    async deleteMany({ where }) {
      const before = rows.length;
      const kept = rows.filter((status) => status !== where.status);
      rows.splice(0, rows.length, ...kept);
      return { count: before - rows.length };
    },
  };
  return { table, rows };
}

describe('weekly cleanup of failed emails', () => {
  it('deletes only the failed rows and reports how many', async () => {
    const { table, rows } = tableWith(['failed', 'retrying', 'failed']);
    const result = await createMaintenanceProcessor({ failedEmail: table })({
      name: CLEAN_FAILED_EMAILS,
    });
    assert.deepEqual(result, { deleted: 2 });
    assert.deepEqual(rows, ['retrying']);
  });

  it('reports zero when nothing has failed', async () => {
    const { table } = tableWith(['retrying']);
    const result = await createMaintenanceProcessor({ failedEmail: table })({
      name: CLEAN_FAILED_EMAILS,
    });
    assert.deepEqual(result, { deleted: 0 });
  });

  it('refuses a job it does not know', async () => {
    const { table, rows } = tableWith(['failed']);
    await assert.rejects(
      createMaintenanceProcessor({ failedEmail: table })({ name: 'something-else' }),
      /Unknown maintenance job/,
    );
    assert.deepEqual(rows, ['failed']);
  });

  it('is scheduled for Sundays at 04:00 in the given zone, under one fixed id', async () => {
    const calls: unknown[][] = [];
    const next = Date.parse('2026-10-18T08:00:00Z');
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        calls.push(args);
        return undefined;
      },
      async getJobScheduler(id: string) {
        return id === CLEAN_FAILED_EMAILS ? { key: id, name: id, next } : undefined;
      },
    } as unknown as Parameters<typeof scheduleMaintenance>[0];

    const when = await scheduleMaintenance(queue, 'America/New_York');
    await scheduleMaintenance(queue, 'America/New_York');

    assert.equal(when?.getTime(), next);
    assert.equal(calls.length, 2);
    for (const [id, repeat, template] of calls) {
      assert.equal(id, CLEAN_FAILED_EMAILS);
      assert.deepEqual(repeat, { pattern: '0 4 * * 0', tz: 'America/New_York' });
      assert.equal((template as { name: string }).name, CLEAN_FAILED_EMAILS);
    }
  });
});
