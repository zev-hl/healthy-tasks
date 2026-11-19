import type { ActivityNotificationDto, NotificationsDto, TaskUserRef } from '@healthy-tasks/shared';
import { api } from '../../api/client';
import { userLabel } from '../ui/Avatar';

/** One notification, whatever list it came from, for the bell and the Dashboard. */
export interface FeedItem {
  key: string;
  id: string;
  list: 'mentioned' | 'reminders' | 'assigned' | 'activity';
  taskId: number;
  taskName: string;
  who: TaskUserRef | null;
  /** "mentioned you in", "assigned you", "reminder:" … */
  text: string;
  at: string | null;
  read: boolean;
}

/** What an Activity alert says (E3, E7). */
export function activityText(a: ActivityNotificationDto): string {
  const who = a.actor ? userLabel(a.actor) : 'Someone';
  switch (a.type) {
    case 'updateRequested':
      return a.note ? `${who} asked for an update: ${a.note}` : `${who} asked for an update`;
    case 'statusChanged':
      return `${who} moved it to ${a.detail ?? 'a new status'}`;
    case 'commented':
      return a.note ? `${who} commented: ${a.note}` : `${who} commented`;
    case 'dueSoon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue now';
    case 'snoozed':
      return `${who} snoozed it${a.detail ? ` until ${a.detail}` : ''}`;
    case 'timerCheckIn':
      return 'Your timer asks: still working on it?';
    case 'timerStopped':
      return 'Your timer stopped: nobody answered “Still working?”';
  }
}

export function toFeed(n: NotificationsDto): FeedItem[] {
  const items: FeedItem[] = [
    ...n.mentioned.map((m) => ({
      key: `m-${m.id}`,
      id: m.id,
      list: 'mentioned' as const,
      taskId: m.taskId,
      taskName: m.taskName,
      who: m.commenter,
      text: `${userLabel(m.commenter)} mentioned you`,
      at: m.commentAt,
      read: m.read,
    })),
    ...n.assigned.map((a) => ({
      key: `a-${a.id}`,
      id: a.id,
      list: 'assigned' as const,
      taskId: a.taskId,
      taskName: a.taskName,
      who: a.byAlert ? null : a.actor,
      // A task made from an Exclusives alert is assigned by the alert, not a person.
      text: a.byAlert
        ? 'Alert-assigned'
        : a.action === 'added'
          ? `${a.actor ? userLabel(a.actor) : 'Someone'} assigned you`
          : `${a.actor ? userLabel(a.actor) : 'Someone'} unassigned you`,
      at: a.createdAt,
      read: a.read,
    })),
    ...n.reminders.map((r) => ({
      key: `r-${r.id}`,
      id: r.id,
      list: 'reminders' as const,
      taskId: r.taskId,
      taskName: r.taskName,
      who: null,
      text:
        r.kind === 'canceled'
          ? 'Reminder canceled'
          : r.source === 'snooze'
            ? 'Back from snooze'
            : r.note
              ? `Reminder: ${r.note}`
              : 'Reminder',
      at: r.canceledAt ?? r.remindAt,
      read: r.read,
    })),
    ...(n.activity ?? []).map((a) => ({
      key: `x-${a.id}`,
      id: a.id,
      list: 'activity' as const,
      taskId: a.taskId,
      taskName: a.taskName,
      who: a.actor,
      text: activityText(a),
      at: a.createdAt,
      read: a.read,
    })),
  ];
  return items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

export async function markRead(item: FeedItem, read = true): Promise<void> {
  if (item.list === 'reminders') {
    await (read ? api.markReminderRead(item.id) : api.markReminderUnread(item.id));
  } else {
    await (read ? api.markNotificationRead(item.id) : api.markNotificationUnread(item.id));
  }
}

/** "Today 11:42" / "Tue 16:20" / "Nov 1" (§6.1 activity labels). */
export function whenLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return `Today ${time}`;
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (d >= weekAgo) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
