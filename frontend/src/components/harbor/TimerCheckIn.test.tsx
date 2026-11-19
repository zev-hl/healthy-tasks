import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

vi.mock('../../api/client', () => ({
  api: { getTimer: vi.fn(), keepTimer: vi.fn(), stopTimer: vi.fn(), startTimer: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../../api/client');
const { TimerCheckIn } = await import('./TimeBlock');
const { renderWithRouter } = await import('../../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

describe('the timer’s “Still working?” (L2)', () => {
  it('asks once the check-in time has come, and Keep going sends it', async () => {
    fn(api.getTimer).mockResolvedValue({
      timer: {
        taskId: 3,
        taskName: 'Count',
        startedAt: iso(-4 * 3_600_000),
        checkInAt: iso(-60_000),
        stopsAt: iso(14 * 60_000),
      },
      now: iso(0),
    });
    fn(api.keepTimer).mockResolvedValue({
      timer: {
        taskId: 3,
        taskName: 'Count',
        startedAt: iso(-4 * 3_600_000),
        checkInAt: iso(4 * 3_600_000),
        stopsAt: iso(4 * 3_600_000 + 15 * 60_000),
      },
      now: iso(0),
    });
    renderWithRouter(<TimerCheckIn />);
    await settle();
    expect(screen.getByText(/Still working on/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Keep going' })));
    await settle();
    expect(api.keepTimer).toHaveBeenCalledWith({ taskId: 3 });
    expect(screen.queryByText(/Still working on/)).toBeNull();
  });
});
