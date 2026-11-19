import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DepartmentDto, TaskSearchFilters } from '@healthy-tasks/shared';
import { FilterMenu } from './FilterMenu';
import { buildFilters, defaultState, normalizeState } from './viewState';

const deps = [
  {
    id: 'd1',
    name: 'Ops',
    color: '#336',
    archived: false,
    duties: [{ id: 'x1', name: 'Receiving', archived: false }],
    peopleCount: 1,
  },
] as unknown as DepartmentDto[];

function renderMenu(extra: TaskSearchFilters = {}, onChange = vi.fn()) {
  render(
    <FilterMenu
      status="open"
      onStatus={() => {}}
      extra={extra}
      onChange={onChange}
      onClear={() => {}}
      showAssignee
      people={[{ value: 'u2', label: 'Bea Bell' }]}
      departments={deps}
      tags={['urgent']}
      groups={[]}
      applied={extra.statuses ? ['Status'] : []}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
  return onChange;
}

describe('FilterMenu: one menu, several picks per filter', () => {
  it('adds a second status to the first', () => {
    const onChange = renderMenu({ statuses: ['Open'] });
    fireEvent.click(screen.getByRole('checkbox', { name: /On Hold/ }));
    expect(onChange).toHaveBeenCalledWith({ statuses: ['Open', 'OnHold'] });
  });

  it('takes the last pick away again, leaving no filter', () => {
    const onChange = renderMenu({ statuses: ['Open'] });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Open$/ }));
    expect(onChange).toHaveBeenCalledWith({ statuses: undefined });
  });

  it('lists people, departments, duties and tags to pick from', () => {
    const onChange = renderMenu();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bea Bell' }));
    expect(onChange).toHaveBeenLastCalledWith({ assigneeIds: ['u2'] });
    expect(screen.getByRole('checkbox', { name: 'Receiving' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBeInTheDocument();
  });

  it('shows how many filters are on', () => {
    renderMenu({ statuses: ['Open'] });
    expect(screen.getByRole('button', { name: /Filter/ })).toHaveTextContent('1');
  });
});

describe('older saved states', () => {
  it('move their single choices into the lists', () => {
    const v = normalizeState({
      ...defaultState('all'),
      status: 's:OnHold',
      owner: 'u2',
      dept: 'd1',
      priority: 'High',
    });
    expect(v.extra).toEqual({
      statuses: ['OnHold'],
      assigneeIds: ['u2'],
      departmentIds: ['d1'],
      priorities: ['High'],
    });
    expect(v.status).toBe('any');
    expect(v.owner).toBe('__all');
  });

  it('picked statuses win over the Open preset', () => {
    const f = buildFilters({ ...defaultState('all'), extra: { statuses: ['Completed'] } }, 'me');
    expect(f.statuses).toEqual(['Completed']);
  });
});
