import type { EventKind } from '@healthy-tasks/shared';

/**
 * What each kind of item looks like on the calendar (Nov 2026 plan, H4): its
 * colour, and its name in the legend. Tasks show by their due date with their
 * status colour; everything else with its kind's colour.
 */
export type CalendarLayer = 'tasks' | 'reminders' | 'events' | 'google' | 'connect';

export const EVENT_COLORS: Record<EventKind, string> = {
  meeting: '#7c3aed',
  call: '#0e8a5f',
  deadline: '#c62828',
  other: '#1f5fbf',
};
export const REMINDER_COLOR = '#b86e00';
export const GOOGLE_COLOR = '#5f6b7a';
/** Connect calls booked in Connect itself (K4); calls booked here are events. */
export const CONNECT_COLOR = '#0f766e';

export const LAYER_LABELS: Record<CalendarLayer, string> = {
  tasks: 'Due dates',
  reminders: 'My reminders',
  events: 'Events',
  google: 'Google Calendar',
  connect: 'Connect calls',
};
