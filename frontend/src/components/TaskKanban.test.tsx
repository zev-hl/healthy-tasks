import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TaskRowDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { updateTask: vi.fn(), getReviewerCandidates: vi.fn(() => Promise.resolve([])) },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { TaskKanban } = await import('./TaskKanban');
const { ToastProvider } = await import('./harbor/Toast');
const updateTask = api.updateTask as unknown as ReturnType<typeof vi.fn>;

const row = (id: number, name: string, over: Partial<TaskRowDto> = {}): TaskRowDto =>
  ({
    id,
    name,
    status: 'Open',
    statusChangedAt: null,
    priority: 'Medium',
    assignee: null,
    createdAt: '2026-11-01T00:00:00Z',
    startAt: null,
    dueAt: null,
    parentId: null,
    childrenCount: 0,
    tags: [],
    blockedByIds: [],
    mentionOnly: false,
    treeOnly: false,
    duty: null,
    dutyMismatch: false,
    ...over,
  }) as TaskRowDto;

function renderBoard(rows: TaskRowDto[], onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <TaskKanban rows={rows} loading={false} onChanged={onChanged} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return onChanged;
}

const column = (name: RegExp) => screen.getByRole('region', { name });

function drag(card: HTMLElement, to: HTMLElement) {
  fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
  fireEvent.dragOver(to);
  fireEvent.drop(to);
}

describe('TaskKanban (Board)', () => {
  beforeEach(() => {
    localStorage.clear();
    updateTask.mockReset();
  });

  it('puts each card in its status column, with Canceled folded', () => {
    renderBoard([row(1, 'Count stock'), row(2, 'Ship order', { status: 'InProgress' })]);
    expect(within(column(/^Open, 1 tasks$/)).getByText('Count stock')).toBeInTheDocument();
    expect(within(column(/^In Progress, 1 tasks$/)).getByText('Ship order')).toBeInTheDocument();
    expect(column(/^Canceled, 0 tasks, folded$/)).toBeInTheDocument();
  });

  it('moves a card on drop, then offers Undo', async () => {
    updateTask.mockResolvedValue({});
    const onChanged = renderBoard([row(1, 'Count stock')]);
    const card = screen.getByText('Count stock').closest('article')!;
    await act(async () => drag(card, column(/^In Progress/)));
    expect(updateTask).toHaveBeenCalledWith(1, { status: 'InProgress' });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('“Count stock” moved to In Progress.')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(updateTask).toHaveBeenLastCalledWith(1, { status: 'Open' });
  });

  it('snaps back with the reason when the move is refused', async () => {
    updateTask.mockRejectedValue(new Error('x'));
    renderBoard([row(1, 'Count stock')]);
    const card = screen.getByText('Count stock').closest('article')!;
    await act(async () => drag(card, column(/^Completed/)));
    expect(within(column(/^Open, 1 tasks$/)).getByText('Count stock')).toBeInTheDocument();
    expect(screen.getByText(/stayed in Open/)).toBeInTheDocument();
  });

  it('does not let a card in review be dragged', () => {
    renderBoard([row(1, 'Check copy', { status: 'Review' })]);
    expect(screen.getByText('Check copy').closest('article')).toHaveAttribute('draggable', 'false');
    expect(screen.getByText('In review')).toBeInTheDocument();
  });
});
