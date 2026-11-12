import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { TaskDetailDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { setTaskRecurrence: vi.fn(), clearTaskRecurrence: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { TaskRecurrencePanel, describeRule } = await import('./TaskRecurrencePanel');
const { renderWithDataRouter } = await import('../test/render');

// Thursday, Nov 12 2026.
const task = (over: Partial<TaskDetailDto> = {}) =>
  ({
    id: 7,
    dueAt: new Date(2026, 10, 12, 17).toISOString(),
    startAt: null,
    recurrence: null,
    recurrenceSourceId: null,
    recurrenceSeq: null,
    ...over,
  }) as TaskDetailDto;

describe('describeRule', () => {
  const base = {
    type: 'Fixed' as const,
    count: 1,
    unit: 'Week' as const,
    weekdays: [4, 1],
    endType: 'Never' as const,
    endDate: null,
    max: 3,
  };
  it('reads as a sentence', () => {
    expect(describeRule(base)).toBe('Every week on Mon, Thu');
    expect(
      describeRule({ ...base, count: 2, unit: 'Day', endType: 'AfterOccurrences', max: 5 }),
    ).toBe('Every 2 days, 5 times in all');
    expect(describeRule({ ...base, type: 'RelativeToCompletion', count: 3 })).toBe(
      '3 weeks after each time it’s done',
    );
  });
});

describe('TaskRecurrencePanel', () => {
  it("offers Weekly on the task's day and saves it", async () => {
    const set = api.setTaskRecurrence as unknown as ReturnType<typeof vi.fn>;
    set.mockResolvedValue(task());
    renderWithDataRouter(<TaskRecurrencePanel task={task()} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Weekly on Thu' }));
    expect(screen.getByText('Every week on Thu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(set).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ intervalUnit: 'Week', intervalCount: 1, weekdays: [4] }),
    );
  });

  it('asks for a date first when the task has none', () => {
    renderWithDataRouter(<TaskRecurrencePanel task={task({ dueAt: null })} onChanged={() => {}} />);
    expect(screen.getByText(/Give the task a due or start date/)).toBeTruthy();
  });
});
