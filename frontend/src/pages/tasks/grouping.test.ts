import { describe, expect, it } from 'vitest';
import type { TaskRowDto } from '@healthy-tasks/shared';
import { groupRows } from './grouping';

const row = (id: number, over: Partial<TaskRowDto> = {}) =>
  ({
    id,
    name: `Task ${id}`,
    status: 'Open',
    assignee: null,
    dueAt: null,
    duty: null,
    depth: 0,
    ...over,
  }) as TaskRowDto;

describe('groupRows', () => {
  it('keeps one group when not grouping', () => {
    expect(groupRows([row(1), row(2)], 'none')).toHaveLength(1);
  });

  it('orders status groups by the status order', () => {
    const g = groupRows(
      [row(1, { status: 'Completed' }), row(2, { status: 'Open' }), row(3, { status: 'Open' })],
      'status',
    );
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ['Open', 2],
      ['Completed', 1],
    ]);
  });

  it('keeps a nested sub-task with its parent and puts Unassigned last', () => {
    const ada = { id: 'a', firstName: 'Ada', lastName: 'Lee' } as TaskRowDto['assignee'];
    const g = groupRows(
      [row(1), row(2, { depth: 1, assignee: ada }), row(3, { assignee: ada })],
      'owner',
    );
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([
      ['Ada Lee', [3]],
      ['Unassigned', [1, 2]],
    ]);
  });

  it('sorts due dates into Overdue / Today / Next 7 days / Later / No due date', () => {
    const now = new Date(2026, 10, 12, 10);
    const at = (d: number) => new Date(2026, 10, d, 17).toISOString();
    const g = groupRows(
      [
        row(1, { dueAt: at(30) }),
        row(2),
        row(3, { dueAt: at(12) }),
        row(4, { dueAt: at(10) }),
        row(5, { dueAt: at(15) }),
        row(6, { dueAt: at(10), status: 'Completed' }),
      ],
      'due',
      now,
    );
    expect(g.map((x) => x.label)).toEqual([
      'Overdue',
      'Today',
      'Next 7 days',
      'Later',
      'Earlier (done)',
      'No due date',
    ]);
  });
});
