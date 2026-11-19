import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_NOTIFY_MATRIX } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    requestUpdate: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../api/client');
const { NotificationSettings } = await import('./NotificationSettings');
const { RequestUpdateButton } = await import('./RequestUpdateButton');
const { activityText } = await import('./harbor/notificationFeed');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const prefs = {
  mentionedInApp: true,
  mentionedEmail: false,
  remindersInApp: true,
  remindersEmail: false,
  assignedInApp: true,
  assignedEmail: false,
  matrix: DEFAULT_NOTIFY_MATRIX,
  soundOn: false,
  sound: 'chime',
  pushOn: false,
};

describe('NotificationSettings', () => {
  beforeEach(() => {
    fn(api.getNotificationPreferences).mockResolvedValue(prefs);
    fn(api.updateNotificationPreferences).mockImplementation(
      async (p: { matrix?: Record<string, object> } & Record<string, unknown>) => {
        const matrix = { ...prefs.matrix } as Record<string, object>;
        for (const [k, v] of Object.entries(p.matrix ?? {})) matrix[k] = { ...matrix[k], ...v };
        return { ...prefs, ...p, matrix };
      },
    );
  });

  it('shows every event per channel and saves one cell at a time', async () => {
    render(<NotificationSettings email="me@x" />);
    await settle();
    const cell = screen.getByRole('checkbox', { name: 'Status changed on my task: Email' });
    expect(cell).not.toBeChecked();
    fireEvent.click(cell);
    await settle();
    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({
      matrix: { status: { email: true } },
    });
    expect(screen.getByRole('checkbox', { name: 'Asked for an update: Email' })).toBeChecked();
  });

  it('turns the sound on', async () => {
    render(<NotificationSettings />);
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Play a sound for new alerts' }));
    await settle();
    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ soundOn: true });
  });
});

describe('Activity alerts say what happened', () => {
  const base = {
    id: 'n1',
    taskId: 1,
    taskName: 'T',
    actor: { id: 'u', email: 'ada@x', firstName: 'Ada', lastName: 'Lee', title: null },
    note: null,
    detail: null,
    createdAt: '',
    read: false,
  };
  it('names the person and the change', () => {
    expect(activityText({ ...base, type: 'updateRequested', note: 'By 3pm?' })).toBe(
      'Ada Lee asked for an update: By 3pm?',
    );
    expect(activityText({ ...base, type: 'statusChanged', detail: 'On Hold' })).toBe(
      'Ada Lee moved it to On Hold',
    );
    expect(activityText({ ...base, type: 'overdue', actor: null })).toBe('Overdue now');
  });
});

describe('RequestUpdateButton', () => {
  it('sends the note to the assignee', async () => {
    fn(api.requestUpdate).mockResolvedValue({ askedAt: '' });
    const onSent = vi.fn();
    render(
      <RequestUpdateButton
        task={
          {
            id: 7,
            assignee: { id: 'w', email: 'w@x', firstName: 'Wes', lastName: 'Ray', title: null },
          } as never
        }
        onSent={onSent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Request update/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note for the update request' }), {
      target: { value: 'Where are we?' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(api.requestUpdate).toHaveBeenCalledWith(7, 'Where are we?');
    expect(onSent).toHaveBeenCalled();
  });
});
