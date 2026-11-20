import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }
  return { api: { getTimer: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn() }, ApiError };
});

const { api, ApiError } = await import('../api/client');
const { startTimer, stopTimer, stopMessage, stopTone, getTimer, refreshTimer, resetTimerCache } =
  await import('./timer');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const now = () => new Date().toISOString();
const running = (taskId: number, taskName: string, startedAt = now()) => ({
  timer: { taskId, taskName, startedAt },
  now: now(),
});

describe('the timer runs on the server (L2)', () => {
  beforeEach(() => {
    resetTimerCache();
    for (const f of [api.getTimer, api.startTimer, api.stopTimer]) fn(f).mockReset();
    fn(api.getTimer).mockResolvedValue({ timer: null, now: now() });
  });

  it('starts naming the timer it replaces, and a stop says where the time went', async () => {
    fn(api.startTimer).mockResolvedValue(running(7, 'Count'));
    await startTimer({ id: 7, name: 'Count' });
    expect(api.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, replacing: null }),
    );
    expect(getTimer()?.taskId).toBe(7);

    fn(api.startTimer).mockResolvedValue({
      ...running(8, 'Pack'),
      saved: {
        taskId: 7,
        taskName: 'Count',
        minutes: 12,
        duty: null,
        totalMinutes: 12,
        people: [],
      },
    });
    const switched = await startTimer({ id: 8, name: 'Pack' });
    expect(api.startTimer).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskId: 8, replacing: 7 }),
    );
    expect(switched && stopMessage(switched)).toMatch(/Saved 12m on “Count”.*No duty/);

    fn(api.stopTimer).mockResolvedValue({
      timer: null,
      now: now(),
      saved: {
        taskId: 8,
        taskName: 'Pack',
        minutes: 3,
        duty: { id: 'd', name: 'Receiving', departmentName: 'Ops' },
        totalMinutes: 3,
        people: [],
      },
    });
    const r = await stopTimer();
    expect(api.stopTimer).toHaveBeenCalledWith(expect.objectContaining({ taskId: 8 }));
    expect(getTimer()).toBeNull();
    expect(r && stopMessage(r)).toMatch(/Saved 3m on “Pack”.*under Ops › Receiving/);
  });

  it('shows the timer another browser started, and refuses to overwrite it', async () => {
    fn(api.getTimer).mockResolvedValue(running(5, 'Elsewhere'));
    await refreshTimer();
    expect(getTimer()?.taskName).toBe('Elsewhere');

    // Meanwhile it moved again; the server says so and hands the real one back.
    fn(api.startTimer).mockRejectedValue(
      new ApiError(409, 'Your timer is now running on “Other”.', {
        code: 'TIMER_CHANGED',
        timer: { taskId: 6, taskName: 'Other', startedAt: now() },
        now: now(),
      }),
    );
    await expect(startTimer({ id: 9, name: 'Mine' })).rejects.toThrow(
      /Other.*Nothing was changed here/,
    );
    expect(api.startTimer).toHaveBeenCalledWith(expect.objectContaining({ replacing: 5 }));
    expect(getTimer()?.taskId).toBe(6);
  });

  it('names the replaced task, in a calm tone, when its time could not be kept', async () => {
    fn(api.getTimer).mockResolvedValue(running(5, 'Old task'));
    await refreshTimer();
    // The server stopped it, but this person can no longer open task 5.
    fn(api.startTimer).mockResolvedValue({ ...running(9, 'Mine'), saved: null });
    const r = await startTimer({ id: 9, name: 'Mine' });
    expect(r && stopMessage(r)).toMatch(/timer on “Old task” stopped.*can no longer open/);
    expect(r && stopMessage(r)).not.toMatch(/that task”/);
    expect(r && stopTone(r, 'dark')).toBe('dark');
  });

  it('uses the server clock for the running time', async () => {
    const serverNow = Date.now() + 10 * 60_000; // this browser's clock is 10 minutes slow
    fn(api.getTimer).mockResolvedValue({
      timer: { taskId: 1, taskName: 'A', startedAt: new Date(serverNow - 60_000).toISOString() },
      now: new Date(serverNow).toISOString(),
    });
    await refreshTimer();
    const elapsed = Date.now() - getTimer()!.startedAt;
    expect(elapsed).toBeGreaterThan(55_000);
    expect(elapsed).toBeLessThan(65_000);
  });
});
