import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ExclusivesGroupOptionDto } from '@healthy-tasks/shared';
import { TaskAttributeChips } from './TaskAttributeChips';

const groups: ExclusivesGroupOptionDto[] = [
  { id: 4, name: 'Versure Exclusives', groupType: 'GROUP', isActive: true },
  { id: 5, name: 'Sports Nutrition', groupType: 'GROUP', isActive: true },
  { id: 9, name: 'Old group', groupType: 'GROUP', isActive: false },
];

function renderChips(over: Partial<Parameters<typeof TaskAttributeChips>[0]> = {}) {
  const onGroup = vi.fn();
  const onType = vi.fn();
  render(
    <TaskAttributeChips
      savedGroup={null}
      groups={groups}
      groupId=""
      onGroup={onGroup}
      alertType=""
      onType={onType}
      savedType=""
      {...over}
    />,
  );
  return { onGroup, onType };
}

describe('TaskAttributeChips', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('offers only active groups, plus "Not set", and stages the pick', () => {
    const { onGroup } = renderChips();
    fireEvent.click(screen.getByRole('button', { name: /Alert Group/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Not set',
      'Versure Exclusives',
      'Sports Nutrition',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Sports Nutrition' }));
    expect(onGroup).toHaveBeenCalledWith('5');
  });

  it("keeps the task's switched-off group as its value, with the red mark, but not as a choice", () => {
    renderChips({
      savedGroup: { id: 9, name: 'Old group', isActive: false },
      groupId: '9',
    });
    expect(screen.getByRole('img', { name: 'Inactive group' })).toBeInTheDocument();
    expect(screen.getByText('Old group')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Alert Group/ }));
    expect(screen.queryByRole('option', { name: 'Old group' })).toBeNull();
  });

  it('marks a changed chip as edited', () => {
    renderChips({ alertType: 'PriceChanged', savedType: '' });
    expect(screen.getByRole('button', { name: /Alert Type/ }).className).toContain('is-dirty');
  });
});
