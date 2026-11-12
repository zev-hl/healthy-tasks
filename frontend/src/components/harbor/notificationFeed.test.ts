import { describe, expect, it, vi } from 'vitest';
import type { AssignedNotificationDto, NotificationsDto } from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({ api: {} }));
const { toFeed } = await import('./notificationFeed');

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
const feed = (rows: AssignedNotificationDto[]) =>
  toFeed({ mentioned: [], reminders: [], assigned: rows } as NotificationsDto);

describe('toFeed — who assigned it', () => {
  it('says "Alert-assigned" for a task made from an alert', () => {
    const [it0] = feed([assigned({ byAlert: true })]);
    expect(it0!.text).toBe('Alert-assigned');
    expect(it0!.who).toBeNull();
  });

  it('names the person who assigned it by hand', () => {
    const [it0] = feed([
      assigned({ actor: { id: 'u1', email: 'z@x', firstName: 'Zev', lastName: 'J', title: null } }),
    ]);
    expect(it0!.text).toBe('Zev J assigned you');
  });
});
