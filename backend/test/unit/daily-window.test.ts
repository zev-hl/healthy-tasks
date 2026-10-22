import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// env.ts reads its config once, at import: the business clock is New York, and
// the time comes from each test, not from this machine's settings.
process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.JWT_SECRET ??= 'unused';
process.env.BUSINESS_TIMEZONE = 'America/New_York';
delete process.env.EXCLUSIVES_DAILY_TASKS_AT;
const { parseClockTime, formatClockTime } = await import('../../src/utils/clock-time.js');
const { lastDailyRunAt, nextDailyRunAt, dailyWindowStart, describeDailyWindow } =
  await import('../../src/services/exclusives/daily-window.js');
const { env } = await import('../../src/config/env.js');

/**
 * HLAI-112: when the Daily alert tasks are made (EXCLUSIVES_DAILY_TASKS_AT,
 * business clock), and the day before it each one covers.
 */

const t = (s: string) => parseClockTime(s)!;
// October 2026: New York is on EDT (UTC-4).
const ny = (iso: string) => new Date(`${iso}-04:00`);
const iso = (d: Date) => d.toISOString();

describe('the time setting', () => {
  it('reads a 24-hour time, to the minute', () => {
    assert.deepEqual(parseClockTime('08:30'), { hour: 8, minute: 30 });
    assert.deepEqual(parseClockTime('8:30'), { hour: 8, minute: 30 });
    assert.deepEqual(parseClockTime(' 16:59 '), { hour: 16, minute: 59 });
    assert.deepEqual(parseClockTime('00:00'), { hour: 0, minute: 0 });
    assert.deepEqual(parseClockTime('23:59'), { hour: 23, minute: 59 });
  });

  it('refuses anything else', () => {
    for (const bad of [
      '8.30',
      '24:00',
      '25:00',
      '08:60',
      '8:5',
      '0830',
      'ab',
      '',
      ' ',
      '8:30 AM',
    ]) {
      assert.equal(parseClockTime(bad), null, bad);
    }
  });

  it('writes a time for people', () => {
    assert.equal(formatClockTime(t('08:30')), '8:30 AM');
    assert.equal(formatClockTime(t('16:59')), '4:59 PM');
    assert.equal(formatClockTime(t('00:00')), '12:00 AM');
    assert.equal(formatClockTime(t('12:00')), '12:00 PM');
  });

  it('defaults to 08:30', () => {
    assert.deepEqual(env.alertTasks.dailyAt, t('08:30'));
    assert.equal(
      describeDailyWindow(),
      '8:30 AM New York time, covering the day before (8:30 AM to 8:29 AM)',
    );
  });

  it('stops the server at start-up on a wrong value, saying what is wanted', () => {
    const backend = fileURLToPath(new URL('../..', import.meta.url));
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/config/env.ts')"],
      {
        cwd: backend,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://unused',
          JWT_SECRET: 'unused',
          EXCLUSIVES_DAILY_TASKS_AT: '8:30 AM',
        },
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /EXCLUSIVES_DAILY_TASKS_AT must be a 24-hour time, HH:MM/);
  });
});

describe('the Daily run and the day it covers', () => {
  it('by default: made at 8:30 AM, for 8:30 AM the day before to 8:29 AM', () => {
    assert.equal(iso(lastDailyRunAt(ny('2026-10-19T10:00:00'))), iso(ny('2026-10-19T08:30:00')));
    assert.equal(iso(lastDailyRunAt(ny('2026-10-19T08:29:00'))), iso(ny('2026-10-18T08:30:00')));
    assert.equal(iso(nextDailyRunAt(ny('2026-10-19T08:30:00'))), iso(ny('2026-10-20T08:30:00')));
    assert.equal(iso(nextDailyRunAt(ny('2026-10-19T08:29:59'))), iso(ny('2026-10-19T08:30:00')));
    assert.equal(iso(dailyWindowStart(ny('2026-10-19T08:30:00'))), iso(ny('2026-10-18T08:30:00')));
  });

  it('set to 14:00: made at 2:00 PM, for 2:00 PM the day before to 1:59 PM', () => {
    const at = t('14:00');
    const run = nextDailyRunAt(ny('2026-10-19T10:00:00'), at);
    assert.equal(iso(run), iso(ny('2026-10-19T14:00:00')));
    assert.equal(iso(dailyWindowStart(run, at)), iso(ny('2026-10-18T14:00:00')));
    assert.equal(
      iso(nextDailyRunAt(ny('2026-10-19T14:00:00'), at)),
      iso(ny('2026-10-20T14:00:00')),
    );
    assert.equal(
      iso(lastDailyRunAt(ny('2026-10-19T13:59:00'), at)),
      iso(ny('2026-10-18T14:00:00')),
    );
    assert.equal(
      describeDailyWindow(at),
      '2:00 PM New York time, covering the day before (2:00 PM to 1:59 PM)',
    );
  });

  it('set to 00:00: made at midnight, for the calendar day just ended', () => {
    const at = t('00:00');
    const run = nextDailyRunAt(ny('2026-10-19T22:30:00'), at);
    assert.equal(iso(run), iso(ny('2026-10-20T00:00:00')));
    assert.equal(iso(dailyWindowStart(run, at)), iso(ny('2026-10-19T00:00:00')));
    assert.equal(iso(lastDailyRunAt(ny('2026-10-20T00:00:00'), at)), iso(run));
    assert.equal(
      describeDailyWindow(at),
      '12:00 AM New York time, covering the day before (12:00 AM to 11:59 PM)',
    );
  });

  it('runs from the same clock time the day before on the DST change days (25 and 23 hours)', () => {
    const hours = (end: Date) => (end.getTime() - dailyWindowStart(end).getTime()) / 3_600_000;
    // 1 Nov 2026: clocks go back. 8:30 AM is now EST (UTC-5).
    const nov1 = new Date('2026-11-01T08:30:00-05:00');
    assert.equal(iso(nextDailyRunAt(new Date('2026-11-01T03:00:00-05:00'))), iso(nov1));
    assert.equal(hours(nov1), 25);
    // 8 Mar 2026: clocks go forward. 8:30 AM is EDT again.
    const mar8 = new Date('2026-03-08T08:30:00-04:00');
    assert.equal(iso(nextDailyRunAt(new Date('2026-03-08T04:00:00-04:00'))), iso(mar8));
    assert.equal(hours(mar8), 23);
  });

  it('leaves no gap and no overlap: each day starts where the one before ended', () => {
    for (const at of [t('08:30'), t('14:00'), t('00:00')]) {
      let run = nextDailyRunAt(new Date('2026-10-25T12:00:00Z'), at);
      for (let i = 0; i < 14; i += 1) {
        // Across 1 Nov (DST) too.
        const next = nextDailyRunAt(run, at);
        assert.equal(iso(dailyWindowStart(next, at)), iso(run));
        run = next;
      }
    }
  });
});
