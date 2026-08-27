import { describe, it, expect } from 'vitest';
import {
  IDLE_LONG_MS,
  IDLE_SHORT_MS,
  POLL_ACTIVE_MS,
  POLL_IDLE_LONG_MS,
  POLL_IDLE_SHORT_MS,
  pollDelayMs,
  createAlwaysLeaderElection,
  createBroadcastChannel,
  type PollMessage,
} from './pollCoordinator';

describe('pollDelayMs (C2 idle ladder)', () => {
  it('polls at the active rate while the user is interacting', () => {
    expect(pollDelayMs(0)).toBe(POLL_ACTIVE_MS);
    expect(pollDelayMs(IDLE_SHORT_MS - 1)).toBe(POLL_ACTIVE_MS);
  });

  it('steps down at each idle threshold, inclusive of the boundary', () => {
    expect(pollDelayMs(IDLE_SHORT_MS)).toBe(POLL_IDLE_SHORT_MS);
    expect(pollDelayMs(IDLE_LONG_MS - 1)).toBe(POLL_IDLE_SHORT_MS);
    expect(pollDelayMs(IDLE_LONG_MS)).toBe(POLL_IDLE_LONG_MS);
  });

  it('never backs off past the longest rung', () => {
    expect(pollDelayMs(IDLE_LONG_MS * 100)).toBe(POLL_IDLE_LONG_MS);
  });

  it('is monotonic: more idle never means more frequent polling', () => {
    let previous = 0;
    for (let idle = 0; idle <= IDLE_LONG_MS * 2; idle += 30_000) {
      const delay = pollDelayMs(idle);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });
});

describe('createAlwaysLeaderElection (degraded fallback)', () => {
  it('elects immediately, so a browser without Web Locks behaves as it did before', () => {
    let elected = false;
    const resign = createAlwaysLeaderElection().campaign(() => {
      elected = true;
    });
    expect(elected).toBe(true);
    expect(() => resign()).not.toThrow();
  });
});

describe('createBroadcastChannel', () => {
  const available = typeof BroadcastChannel !== 'undefined';

  it.skipIf(!available)(
    'survives close/reopen, so StrictMode double-mount does not kill fan-out',
    async () => {
      const a = createBroadcastChannel('hl-test-reopen');
      // React StrictMode in development does mount -> cleanup -> mount. If close()
      // were terminal, the second mount would listen to a dead channel and every
      // cross-tab message would be lost, in dev only.
      const first = a.subscribe(() => {});
      first();
      a.close();

      const received: PollMessage[] = [];
      a.subscribe((m) => received.push(m));

      const b = createBroadcastChannel('hl-test-reopen');
      b.post({ type: 'activity' });
      await new Promise((r) => setTimeout(r, 20));

      expect(received).toEqual([{ type: 'activity' }]);
      a.close();
      b.close();
    },
  );

  it('never throws when posting, whatever state the channel is in', () => {
    const ch = createBroadcastChannel('hl-test-throw');
    ch.close();
    expect(() => ch.post({ type: 'activity' })).not.toThrow();
    ch.close();
  });
});
