import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActiveUserDto, TaskRef } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { searchTasks: vi.fn(), getReviewerCandidates: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { TaskLinkPicker } = await import('./TaskLinkPicker');
const { ReviewerPickerModal } = await import('./ReviewerPickerModal');
const searchTasks = api.searchTasks as unknown as ReturnType<typeof vi.fn>;
const getCandidates = api.getReviewerCandidates as unknown as ReturnType<typeof vi.fn>;

const ref = (id: number, name: string): TaskRef => ({ id, name, status: 'Open', accessible: true });
const person = (id: string, firstName: string, role: ActiveUserDto['role'] = 'Manager') =>
  ({
    id,
    firstName,
    lastName: 'Test',
    email: `${id}@x.test`,
    role,
    supervisorId: null,
  }) as ActiveUserDto;

function renderLinkPicker(onPick = vi.fn()) {
  const anchor = createRef<HTMLButtonElement>();
  render(
    <>
      <button ref={anchor}>+ Link</button>
      <TaskLinkPicker
        anchorRef={anchor}
        title="Blocked by"
        hint="This task waits until the one you pick is done."
        excludeId={5}
        linkedIds={new Set([2])}
        onPick={onPick}
        onClose={vi.fn()}
      />
    </>,
  );
  return onPick;
}

describe('TaskLinkPicker', () => {
  it('searches, skips tasks already linked, and picks with the keyboard', async () => {
    searchTasks.mockResolvedValue([ref(2, 'Old link'), ref(3, 'Restock'), ref(4, 'Report')]);
    const onPick = renderLinkPicker();
    const input = screen.getByRole('textbox', { name: 'Search tasks' });
    fireEvent.change(input, { target: { value: '#re' } });
    await waitFor(() => expect(screen.getByText('Restock')).toBeTruthy());
    expect(searchTasks).toHaveBeenCalledWith('re', 5);
    expect(screen.getByText('Old link')).toBeTruthy();
    expect(
      screen.getByText('Old link').closest('[role=option]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    // The first pickable task is highlighted; ArrowDown moves to the next.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('ignores a click on a task that is already linked', async () => {
    searchTasks.mockResolvedValue([ref(2, 'Old link')]);
    const onPick = renderLinkPicker();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), {
      target: { value: 'al' },
    });
    await waitFor(() => expect(screen.getByText('Old link')).toBeTruthy());
    fireEvent.click(screen.getByText('Old link'));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('ReviewerPickerModal', () => {
  it('chooses the only reviewer already and sends to them', async () => {
    getCandidates.mockResolvedValue([person('u1', 'Dana')]);
    const onPick = vi.fn();
    render(
      <ReviewerPickerModal
        taskId={5}
        currentAssignee="Sam Test"
        returnStatus="In Progress"
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Dana Test/ }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByLabelText('What happens').textContent).toContain('Back to Sam Test');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    });
    expect(onPick).toHaveBeenCalledWith('u1');
  });

  it('waits for a choice when several people can review, and Esc closes', async () => {
    getCandidates.mockResolvedValue([person('u1', 'Dana'), person('u2', 'Eli', 'Admin')]);
    const onClose = vi.fn();
    render(<ReviewerPickerModal taskId={5} onPick={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('option', { name: /Eli Test/ })).toBeTruthy());
    const send = screen.getByRole('button', { name: 'Send for review' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('option', { name: /Eli Test/ }));
    expect(send.disabled).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
