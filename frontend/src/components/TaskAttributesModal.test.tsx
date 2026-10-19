import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TaskDetailDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: { updateTask: vi.fn(), listExclusivesGroupOptions: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const { api, ApiError } = await import('../api/client');
const { TaskAttributesModal } = await import('./TaskAttributesModal');
const updateTask = api.updateTask as unknown as ReturnType<typeof vi.fn>;
const listGroups = api.listExclusivesGroupOptions as unknown as ReturnType<typeof vi.fn>;

const task = (over: Partial<TaskDetailDto> = {}) =>
  ({ id: 9, alertGroup: null, alertType: null, ...over }) as TaskDetailDto;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const UNSAVED = 'You have unsaved changes. Leave this page and discard them?';
let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  // OK unless a test says otherwise.
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  listGroups.mockResolvedValue([
    { id: 4, name: 'Versure Exclusives', groupType: 'GROUP', isActive: true },
    { id: 7, name: 'Sports Nutrition', groupType: 'GROUP', isActive: true },
    { id: 9, name: 'Paused Group', groupType: 'GROUP', isActive: false },
  ]);
});

/** Open an attribute's dropdown and click one of its options. */
const pick = (attribute: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${attribute}:`) }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const backdropOf = (container: HTMLElement) =>
  container.querySelector('.modal-backdrop') as HTMLElement;
/** A real click on the grey area: pressed and let go there. */
const clickOutside = (container: HTMLElement) => {
  fireEvent.mouseDown(backdropOf(container));
  fireEvent.click(backdropOf(container));
};

afterEach(() => {
  confirmSpy.mockRestore();
});

describe('TaskAttributesModal', () => {
  it('saves nothing while picking; Save sends both picks at once and closes', async () => {
    const saved = task({
      alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
      alertType: 'DimensionsChanged',
    });
    updateTask.mockResolvedValue(saved);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<TaskAttributesModal task={task()} onClose={onClose} onSaved={onSaved} />);
    await settle();

    pick('Alert Group', 'Versure Exclusives');
    pick('Alert Type', 'Dimensions Changed');
    expect(updateTask).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await settle();
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(9, {
      alertGroupId: 4,
      alertType: 'DimensionsChanged',
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only active groups', async () => {
    render(<TaskAttributesModal task={task()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /^Alert Group:/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '— None —',
      'Versure Exclusives',
      'Sports Nutrition',
    ]);
  });

  it("keeps the task's inactive group as its value, but not among the choices", async () => {
    updateTask.mockResolvedValue(task());
    render(
      <TaskAttributesModal
        task={task({ alertGroup: { id: 9, name: 'Paused Group', isActive: false } })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await settle();
    expect(
      screen.getByRole('button', { name: 'Alert Group: Paused Group (inactive)' }),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    // Changing only the type leaves the group alone.
    pick('Alert Type', 'Buy Box Lost');
    fireEvent.click(saveButton());
    await settle();
    expect(updateTask).toHaveBeenCalledWith(9, { alertType: 'BuyBoxLost' });
  });

  it('once another group is picked, the inactive one cannot be picked back', async () => {
    render(
      <TaskAttributesModal
        task={task({ alertGroup: { id: 9, name: 'Paused Group', isActive: false } })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await settle();
    pick('Alert Group', 'Sports Nutrition');
    fireEvent.click(screen.getByRole('button', { name: /^Alert Group:/ }));
    expect(screen.queryByRole('option', { name: /Paused Group/ })).not.toBeInTheDocument();
  });

  it('treats a group switched off since the task was loaded as inactive too', async () => {
    render(
      <TaskAttributesModal
        task={task({ alertGroup: { id: 9, name: 'Paused Group', isActive: true } })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await settle();
    expect(
      screen.getByRole('button', { name: 'Alert Group: Paused Group (inactive)' }),
    ).toBeInTheDocument();
  });

  it('Save stays off until something differs from the task', async () => {
    render(
      <TaskAttributesModal
        task={task({ alertType: 'PriceChanged' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await settle();
    expect(saveButton()).toBeDisabled();

    pick('Alert Type', 'Buy Box Lost');
    expect(saveButton()).toBeEnabled();
    // Back to what the task has: nothing to save again.
    pick('Alert Type', 'Price Changed');
    expect(saveButton()).toBeDisabled();
  });

  it('sends only what changed, and clears with the first option', async () => {
    updateTask.mockResolvedValue(task());
    render(
      <TaskAttributesModal
        task={task({
          alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
          alertType: 'BuyBoxLost',
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await settle();

    pick('Alert Group', '— None —');
    fireEvent.click(saveButton());
    await settle();
    expect(updateTask).toHaveBeenCalledWith(9, { alertGroupId: null });
  });

  it('shows why the attributes could not be saved, and stays open', async () => {
    updateTask.mockRejectedValue(
      new ApiError(400, 'That Alert Group no longer exists. Pick another one.'),
    );
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<TaskAttributesModal task={task()} onClose={onClose} onSaved={onSaved} />);
    await settle();

    pick('Alert Group', 'Versure Exclusives');
    fireEvent.click(saveButton());
    await settle();
    expect(
      screen.getByText('That Alert Group no longer exists. Pick another one.'),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it('Cancel closes without saving, and there is no "Saved" text', async () => {
    const onClose = vi.fn();
    render(<TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />);
    await settle();
    pick('Alert Type', 'Buy Box Lost');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('with nothing changed, a click outside or Escape closes it', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />,
    );
    await settle();

    clickOutside(container);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('with a pick not saved, a click outside asks, then OK closes it without saving', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />,
    );
    await settle();
    pick('Alert Type', 'Buy Box Lost');

    clickOutside(container);
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('with a pick not saved, Cancel on the question keeps the window and the picks, ready to Save', async () => {
    confirmSpy.mockReturnValue(false);
    updateTask.mockResolvedValue(task({ alertType: 'BuyBoxLost' }));
    const onClose = vi.fn();
    const { container } = render(
      <TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />,
    );
    await settle();
    pick('Alert Type', 'Buy Box Lost');

    clickOutside(container);
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Alert Type: Buy Box Lost/ })).toBeInTheDocument();

    fireEvent.click(saveButton());
    await settle();
    expect(updateTask).toHaveBeenCalledWith(9, { alertType: 'BuyBoxLost' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with a pick not saved, Escape asks the same: OK closes, Cancel keeps it', async () => {
    const onClose = vi.fn();
    render(<TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />);
    await settle();
    pick('Alert Group', 'Versure Exclusives');

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('picks back to what the task has: a click outside closes it without asking', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />,
    );
    await settle();
    pick('Alert Type', 'Buy Box Lost');
    pick('Alert Type', '— None —');

    clickOutside(container);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pressing inside the window and letting go outside does not close it', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />,
    );
    await settle();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(backdropOf(container));
    expect(onClose).not.toHaveBeenCalled();
  });
});
