import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { UnreadCountDto } from '@healthy-tasks/shared';
import { NotificationProvider, useNotifications } from './NotificationContext';
import { api } from '../api/client';
import {
  POLL_ACTIVE_MS,
  IDLE_SHORT_MS,
  type LeaderElection,
  type PollChannel,
  type PollMessage,
} from './pollCoordinator';

// Hoisted by Vitest above the imports, so `api` below is already the mock.
vi.mock('../api/client', () => ({
  api: { getUnreadCount: vi.fn() },
}));

const getUnreadCount = api.getUnreadCount as unknown as ReturnType<typeof vi.fn>;

function counts(total: number): UnreadCountDto {
  return { total, mentioned: total, reminders: 0, assigned: 0, schedulerDown: false };
}

/** A channel that records what was posted and can deliver messages inward. */
function fakeChannel() {
  const subscribers = new Set<(m: PollMessage) => void>();
  const sent: PollMessage[] = [];
  const channel: PollChannel = {
    post: (m) => {
      sent.push(m);
    },
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    close: () => subscribers.clear(),
  };
  return {
    channel,
    sent,
    /** Simulate another tab broadcasting to this one. */
    deliver: (m: PollMessage) => subscribers.forEach((fn) => fn(m)),
  };
}

/**
 * An election we drive by hand. jsdom has no Web Locks, so testing against the
 * real implementation would be testing nothing; this exercises the coordination
 * logic, and real lock semantics are covered by the manual multi-tab checklist.
 */
function fakeElection() {
  const state = { campaigns: 0, withdrawals: 0 };
  let pending: (() => void) | null = null;
  const election: LeaderElection = {
    campaign(onElected) {
      state.campaigns += 1;
      pending = onElected;
      return () => {
        state.withdrawals += 1;
        pending = null;
      };
    },
  };
  return {
    election,
    state,
    /** Grant leadership to whoever is currently standing. */
    elect: () => pending?.(),
    get standing() {
      return pending !== null;
    },
  };
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function Bell() {
  const { unread, refresh } = useNotifications();
  return (
    <div>
      <span data-testid="total">{unread ? String(unread.total) : 'none'}</span>
      <button onClick={refresh}>refresh</button>
    </div>
  );
}

function renderProvider(election: LeaderElection, channel: PollChannel) {
  return render(
    <NotificationProvider election={election} channel={channel}>
      <Bell />
    </NotificationProvider>,
  );
}

/** Advance timers and let any pending promises settle. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getUnreadCount.mockReset();
  getUnreadCount.mockResolvedValue(counts(1));
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('C1: visibility gates polling', () => {
  it('a tab that mounts hidden neither stands for election nor fetches', async () => {
    setVisibility('hidden');
    const { election, state } = fakeElection();
    const { channel } = fakeChannel();

    renderProvider(election, channel);
    await settle();

    expect(state.campaigns).toBe(0);
    expect(getUnreadCount).not.toHaveBeenCalled();

    // And it stays quiet: background tabs are only throttled by the browser,
    // not stopped, which is exactly what this prevents.
    await advance(POLL_ACTIVE_MS * 4);
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it('becoming visible stands for election and refreshes immediately once elected', async () => {
    setVisibility('hidden');
    const { election, state, elect } = fakeElection();
    const { channel } = fakeChannel();
    renderProvider(election, channel);
    await settle();
    expect(state.campaigns).toBe(0);

    act(() => setVisibility('visible'));
    expect(state.campaigns).toBe(1);

    // Taking leadership means a tab that just came to the front; it wants
    // current numbers at once rather than after a full interval.
    await act(async () => elect());
    expect(getUnreadCount).toHaveBeenCalled();
    expect(screen.getByTestId('total')).toHaveTextContent('1');
  });

  it('becoming hidden resigns leadership and stops the loop', async () => {
    const { election, state, elect } = fakeElection();
    const { channel } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    const afterElection = getUnreadCount.mock.calls.length;
    expect(afterElection).toBeGreaterThan(0);

    act(() => setVisibility('hidden'));
    expect(state.withdrawals).toBe(1);

    await advance(POLL_ACTIVE_MS * 3);
    expect(getUnreadCount.mock.calls.length).toBe(afterElection);
  });
});

describe('C3: one poller per browser', () => {
  it('a follower does not poll, but renders the leader broadcast', async () => {
    const { election } = fakeElection(); // never elected => this tab is a follower
    const { channel, deliver } = fakeChannel();
    renderProvider(election, channel);
    await settle();

    // A visible tab still does exactly one fetch on mount so its bell is not
    // blank while it waits for the leader.
    const onMount = getUnreadCount.mock.calls.length;
    expect(onMount).toBe(1);

    await advance(POLL_ACTIVE_MS * 5);
    expect(getUnreadCount.mock.calls.length).toBe(onMount);

    await act(async () => deliver({ type: 'counts', counts: counts(7) }));
    expect(screen.getByTestId('total')).toHaveTextContent('7');
  });

  it('the leader broadcasts every result it fetches', async () => {
    const { election, elect } = fakeElection();
    const { channel, sent } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    const broadcasts = sent.filter((m) => m.type === 'counts');
    expect(broadcasts.length).toBeGreaterThan(0);
    expect(screen.getByTestId('total')).toHaveTextContent('1');
  });

  it('polls once per interval while it holds leadership', async () => {
    const { election, elect } = fakeElection();
    const { channel } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    const start = getUnreadCount.mock.calls.length;
    await advance(POLL_ACTIVE_MS);
    expect(getUnreadCount.mock.calls.length).toBe(start + 1);
    await advance(POLL_ACTIVE_MS);
    expect(getUnreadCount.mock.calls.length).toBe(start + 2);
  });
});

describe('C2: idle backoff', () => {
  it('stretches the interval once the user has gone idle', async () => {
    const { election, elect } = fakeElection();
    const { channel } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    // Run past the first idle threshold with no interaction at all.
    await advance(IDLE_SHORT_MS);
    const atThreshold = getUnreadCount.mock.calls.length;

    // At the active rate this window would add three more polls; backed off to
    // two minutes it adds none.
    await advance(POLL_ACTIVE_MS * 3);
    expect(getUnreadCount.mock.calls.length).toBe(atThreshold);
  });

  it('interaction in another tab resets the ladder', async () => {
    const { election, elect } = fakeElection();
    const { channel, deliver } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    await advance(IDLE_SHORT_MS);
    await act(async () => deliver({ type: 'activity' }));

    // The pending long timer still has to expire, but the schedule it computes
    // after that is back at the active rate.
    await advance(POLL_ACTIVE_MS * 4);
    const before = getUnreadCount.mock.calls.length;
    await advance(POLL_ACTIVE_MS);
    expect(getUnreadCount.mock.calls.length).toBe(before + 1);
  });

  it('broadcasts local interaction, throttled', async () => {
    const { election, elect } = fakeElection();
    const { channel, sent } = fakeChannel();
    renderProvider(election, channel);
    await act(async () => elect());

    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      window.dispatchEvent(new Event('keydown'));
      window.dispatchEvent(new Event('scroll'));
    });

    expect(sent.filter((m) => m.type === 'activity').length).toBe(1);
  });
});

describe('refresh()', () => {
  it('fetches locally and shares the result, even from a follower', async () => {
    const { election } = fakeElection(); // follower
    const { channel, sent } = fakeChannel();
    renderProvider(election, channel);
    await settle();

    getUnreadCount.mockResolvedValue(counts(42));
    await act(async () => {
      screen.getByText('refresh').click();
    });

    expect(screen.getByTestId('total')).toHaveTextContent('42');
    expect(sent.some((m) => m.type === 'counts' && m.counts.total === 42)).toBe(true);
  });

  it('survives a failing poll without breaking the provider', async () => {
    const { election, elect } = fakeElection();
    const { channel } = fakeChannel();
    getUnreadCount.mockRejectedValue(new Error('network'));
    renderProvider(election, channel);
    await act(async () => elect());

    expect(screen.getByTestId('total')).toHaveTextContent('none');

    getUnreadCount.mockResolvedValue(counts(3));
    await advance(POLL_ACTIVE_MS);
    expect(screen.getByTestId('total')).toHaveTextContent('3');
  });
});
