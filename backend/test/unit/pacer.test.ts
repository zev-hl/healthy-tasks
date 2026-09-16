import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, batch } from '../../src/services/exclusives/sp-api/pacer.js';

describe('batch', () => {
  it('splits into chunks of the given size', () => {
    assert.deepEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
  it('handles empty and exact-fit inputs', () => {
    assert.deepEqual(batch([], 20), []);
    assert.deepEqual(batch([1, 2, 3, 4], 2), [
      [1, 2],
      [3, 4],
    ]);
  });
  it('throws on a non-positive size', () => {
    assert.throws(() => batch([1], 0));
  });
});

describe('Pacer', () => {
  it('lets the first call through, then spaces immediate calls by the interval', () => {
    const p = new Pacer(5); // 200ms
    assert.equal(p.reserve(0), 0);
    assert.equal(p.reserve(0), 200);
    assert.equal(p.reserve(0), 400);
  });

  it('does not wait when enough time has already passed', () => {
    const p = new Pacer(5);
    assert.equal(p.reserve(0), 0); // nextAt = 200
    assert.equal(p.reserve(500), 0); // 500 > 200
  });

  it('waits only the remaining time when partway through the interval', () => {
    const p = new Pacer(2); // 500ms
    assert.equal(p.reserve(0), 0); // nextAt = 500
    assert.equal(p.reserve(300), 200); // wait until 500
  });

  it('adopts a stricter reported limit but never speeds up', () => {
    const p = new Pacer(5); // 200ms
    p.observeLimit(1); // 1000ms — stricter, adopt
    assert.equal(p.intervalMs, 1000);
    p.observeLimit(10); // 100ms — looser, ignore
    assert.equal(p.intervalMs, 1000);
    p.observeLimit(null);
    assert.equal(p.intervalMs, 1000);
  });

  it('throws on a non-positive rate', () => {
    assert.throws(() => new Pacer(0));
  });

  it('acquire sleeps for the reserved delay (injected clock/sleep)', async () => {
    const p = new Pacer(5);
    const waits: number[] = [];
    const clock = () => 0;
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    await p.acquire(clock, sleep); // delay 0 → no sleep
    await p.acquire(clock, sleep); // delay 200 → sleep(200)
    assert.deepEqual(waits, [200]);
  });
});
