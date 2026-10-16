import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  listGroups.mockResolvedValue([
    { id: 4, name: 'Versure Exclusives', groupType: 'GROUP' },
    { id: 7, name: 'Sports Nutrition', groupType: 'GROUP' },
  ]);
});

/** Open an attribute's dropdown and click one of its options. */
const pick = (attribute: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${attribute}:`) }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('TaskAttributesModal', () => {
  it('saves nothing while picking; Save sends both picks at once and closes', async () => {
    const saved = task({
      alertGroup: { id: 4, name: 'Versure Exclusives' },
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
        task={task({ alertGroup: { id: 4, name: 'Versure Exclusives' }, alertType: 'BuyBoxLost' })}
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

  it('Cancel and Escape close without saving, and there is no "Saved" text', async () => {
    const onClose = vi.fn();
    render(<TaskAttributesModal task={task()} onClose={onClose} onSaved={vi.fn()} />);
    await settle();
    pick('Alert Type', 'Buy Box Lost');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(updateTask).not.toHaveBeenCalled();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});
