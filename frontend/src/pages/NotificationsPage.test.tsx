import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AssignedNotificationDto, NotificationsDto } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markNotificationUnread: vi.fn(),
    markReminderRead: vi.fn(),
    markReminderUnread: vi.fn(),
    snoozeReminder: vi.fn(),
    removeReminder: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../notifications/NotificationContext', () => ({
  useNotifications: () => ({ refresh: vi.fn() }),
}));

const { api } = await import('../api/client');
const { NotificationsPage } = await import('./NotificationsPage');
const { renderWithDataRouter } = await import('../test/render');

const assigned = (over: Partial<AssignedNotificationDto>): AssignedNotificationDto => ({
  id: 'n1',
  taskId: 7,
  taskName: 'WasiU_PC_263160842: Review the price change',
  startAt: null,
  dueAt: null,
  priority: 'Medium',
  action: 'added',
  actor: null,
  byAlert: false,
  blockedByCount: 0,
  createdAt: '2026-11-12T13:42:00Z',
  read: false,
  dutyMismatch: null,
  ...over,
});

function show(rows: AssignedNotificationDto[]) {
  const data: NotificationsDto = { mentioned: [], reminders: [], assigned: rows };
  (api.getNotifications as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(data);
  renderWithDataRouter(<NotificationsPage />);
}

beforeEach(() => vi.clearAllMocks());

describe('NotificationsPage — who assigned it', () => {
  it('shows "Alert-assigned" for a task made from an alert', async () => {
    show([assigned({ byAlert: true })]);
    expect(await screen.findByText('Alert-assigned')).toBeInTheDocument();
    expect(screen.getByText('ALR')).toBeInTheDocument();
  });

  it('names the person who assigned it by hand', async () => {
    show([
      assigned({
        actor: { id: 'u1', email: 'z@x', firstName: 'Zev', lastName: 'J', title: null },
      }),
    ]);
    expect(await screen.findByText('assigned you', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Alert-assigned')).not.toBeInTheDocument();
  });
});
