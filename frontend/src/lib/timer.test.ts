import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { api: { saveTimedStretch: vi.fn() }, ApiError };
});

const { api, ApiError } = await import('../api/client');
const { startTimer, stopTimer, stopMessage, getTimer } = await import('./timer');
const save = api.saveTimedStretch as unknown as ReturnType<typeof vi.fn>;

describe('the timer saves stretches on the task (L2)', () => {
  beforeEach(() => {
    localStorage.clear();
    save.mockReset();
  });

  it('a stop saves the stretch and says where it went on My Time', async () => {
    save.mockResolvedValue({
      minutes: 1,
      duty: { id: 'd', name: 'Receiving', departmentName: 'Ops' },
      totalMinutes: 1,
      people: [],
    });
    await startTimer({ id: 7, name: 'Count' });
    expect(getTimer()?.taskId).toBe(7);
    const r = await stopTimer();
    expect(getTimer()).toBeNull();
    expect(save).toHaveBeenCalledWith(7, expect.objectContaining({ date: expect.any(String) }));
    expect(r && stopMessage(r)).toMatch(/Saved 1m on “Count”.*under Ops › Receiving/);
  });

  it('keeps a stretch that could not be sent, and sends it with the next stop', async () => {
    save.mockRejectedValueOnce(new Error('Network down'));
    await startTimer({ id: 7, name: 'Count' });
    const r = await stopTimer();
    expect(r?.logged).toBe(false);
    expect(JSON.parse(localStorage.getItem('hb-timer-unsaved')!)).toHaveLength(1);

    save.mockResolvedValue({ minutes: 1, duty: null, totalMinutes: 2, people: [] });
    await startTimer({ id: 8, name: 'Pack' });
    await stopTimer();
    await Promise.resolve();
    expect(save.mock.calls.map((c) => c[0])).toEqual([7, 7, 8]);
    expect(localStorage.getItem('hb-timer-unsaved')).toBeNull();
  });

  it('drops a stretch the server refuses', async () => {
    save.mockRejectedValueOnce(new ApiError(404, 'Task not found'));
    await startTimer({ id: 9, name: 'Gone' });
    const r = await stopTimer();
    expect(r?.logged).toBe(false);
    expect(localStorage.getItem('hb-timer-unsaved')).toBeNull();
  });
});
