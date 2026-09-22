import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextSweepDueAt, exclusivesSweepMode } from '../../src/services/exclusives/sweep-clock.js';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('nextSweepDueAt', () => {
  it('is due now when nothing has run yet', () => {
    assert.deepEqual(nextSweepDueAt(NOW, null, null, 30), NOW);
  });

  it('is one interval after the last successful sweep', () => {
    const due = nextSweepDueAt(NOW, minutesBefore(10), null, 30);
    assert.equal(due.toISOString(), '2026-09-22T12:20:00.000Z');
  });

  it('is never in the past', () => {
    assert.deepEqual(nextSweepDueAt(NOW, minutesBefore(90), null, 30), NOW);
  });

  it('also waits an interval after a failed attempt, so a broken Amazon is not hammered', () => {
    // The sweep failed 5 minutes ago and saved no snapshot: the newest snapshot
    // alone would read "due now" forever.
    const due = nextSweepDueAt(NOW, minutesBefore(600), minutesBefore(5), 30);
    assert.equal(due.toISOString(), '2026-09-22T12:25:00.000Z');
  });

  it('takes whichever of the two is later', () => {
    const success = nextSweepDueAt(NOW, minutesBefore(2), minutesBefore(20), 30);
    assert.equal(success.toISOString(), '2026-09-22T12:28:00.000Z');
    const attempt = nextSweepDueAt(NOW, minutesBefore(20), minutesBefore(2), 30);
    assert.equal(attempt.toISOString(), '2026-09-22T12:28:00.000Z');
  });

  it('follows the configured interval', () => {
    assert.equal(
      nextSweepDueAt(NOW, minutesBefore(1), null, 5).toISOString(),
      '2026-09-22T12:04:00.000Z',
    );
    assert.equal(
      nextSweepDueAt(NOW, minutesBefore(1), null, 60).toISOString(),
      '2026-09-22T12:59:00.000Z',
    );
  });
});

describe('exclusivesSweepMode', () => {
  const ready = {
    sweepEnabled: true,
    sweepMinutes: 30,
    clientId: 'a',
    clientSecret: 'b',
    refreshToken: 'c',
    merchantToken: 'd',
  };

  it('is on when switched on and fully configured', () => {
    assert.deepEqual(exclusivesSweepMode(ready), { on: true, summary: 'on, every 30 min' });
  });

  it('is off when the switch is off', () => {
    const mode = exclusivesSweepMode({ ...ready, sweepEnabled: false });
    assert.equal(mode.on, false);
    assert.match(mode.summary, /EXCLUSIVES_SWEEP_ENABLED/);
  });

  it('names the missing credentials when it cannot run', () => {
    const mode = exclusivesSweepMode({ ...ready, refreshToken: undefined });
    assert.equal(mode.on, false);
    assert.match(mode.summary, /SP_API_REFRESH_TOKEN/);
  });
});
