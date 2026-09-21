import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STALE_SHARE, assessSweepHealth } from '../../src/services/exclusives/sweep-health.js';

const NOW = new Date('2026-09-19T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const STALE_AFTER_MS = 1.5 * HOUR_MS; // 3 sweeps at 30 min
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR_MS);
const many = (n: number, at: Date) => Array.from({ length: n }, () => at);

describe('assessSweepHealth', () => {
  it('is healthy when every listing was checked recently', () => {
    const h = assessSweepHealth(many(434, hoursAgo(0.5)), hoursAgo(0.5), NOW, STALE_AFTER_MS);
    assert.equal(h.stale, 0);
    assert.equal(h.unhealthy, false);
  });

  it('is unhealthy when nothing has been checked for too long (an outage)', () => {
    const h = assessSweepHealth(many(434, hoursAgo(2)), hoursAgo(2), NOW, STALE_AFTER_MS);
    assert.equal(h.stale, 434);
    assert.equal(h.unhealthy, true);
  });

  it(`tolerates a few lagging listings, up to ${MAX_STALE_SHARE * 100}%`, () => {
    // e.g. listings Amazon stopped returning (delisted).
    const few = [...many(420, hoursAgo(0.5)), ...many(14, hoursAgo(5))];
    assert.equal(assessSweepHealth(few, hoursAgo(0.5), NOW, STALE_AFTER_MS).unhealthy, false);

    // e.g. every resold listing once the Catalog API is lost.
    const half = [...many(217, hoursAgo(0.5)), ...many(217, hoursAgo(5))];
    const h = assessSweepHealth(half, hoursAgo(0.5), NOW, STALE_AFTER_MS);
    assert.equal(h.stale, 217);
    assert.equal(h.unhealthy, true);
  });

  it('is healthy with nothing to monitor', () => {
    const h = assessSweepHealth([], null, NOW, STALE_AFTER_MS);
    assert.deepEqual(h, { listings: 0, stale: 0, lastSuccessAt: null, unhealthy: false });
  });
});
