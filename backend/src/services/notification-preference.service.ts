import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  DEFAULT_NOTIFY_MATRIX,
  NOTIFICATION_SOUNDS,
  NOTIFY_CHANNELS,
  NOTIFY_EVENTS,
  type ChannelPrefs,
  type NotificationPreferencesDto,
  type NotificationSound,
  type NotifyChannel,
  type NotifyEvent,
  type UpdateNotificationPreferencesRequest,
} from '@healthy-tasks/shared';

/**
 * Notification settings (Nov 2026 plan, E7): every kind of event per channel
 * (in-app, email, Connect), plus a sound and browser push. The three lists that
 * came first (mentioned, reminders, assigned) keep their own in-app / email
 * columns; everything else, their Connect choice included, sits in `channels`.
 */

type PrefRow = {
  mentionedInApp: boolean;
  mentionedEmail: boolean;
  remindersInApp: boolean;
  remindersEmail: boolean;
  assignedInApp: boolean;
  assignedEmail: boolean;
  channels: Prisma.JsonValue;
  soundOn: boolean;
  sound: string;
  pushOn: boolean;
};

const LEGACY_FLAGS = [
  'mentionedInApp',
  'mentionedEmail',
  'remindersInApp',
  'remindersEmail',
  'assignedInApp',
  'assignedEmail',
] as const;
type LegacyFlag = (typeof LEGACY_FLAGS)[number];

/** The events whose in-app / email choice is a column of its own. */
const LEGACY_EVENT: Partial<Record<NotifyEvent, { inApp: LegacyFlag; email: LegacyFlag }>> = {
  mention: { inApp: 'mentionedInApp', email: 'mentionedEmail' },
  reminder: { inApp: 'remindersInApp', email: 'remindersEmail' },
  assigned: { inApp: 'assignedInApp', email: 'assignedEmail' },
};

const DEFAULT_ROW: PrefRow = {
  mentionedInApp: true,
  mentionedEmail: false,
  remindersInApp: true,
  remindersEmail: false,
  assignedInApp: true,
  assignedEmail: false,
  channels: {},
  soundOn: false,
  sound: 'chime',
  pushOn: false,
};

function storedChannels(
  json: Prisma.JsonValue,
): Partial<Record<NotifyEvent, Partial<ChannelPrefs>>> {
  return json && typeof json === 'object' && !Array.isArray(json)
    ? (json as Partial<Record<NotifyEvent, Partial<ChannelPrefs>>>)
    : {};
}

function toDto(row: PrefRow): NotificationPreferencesDto {
  const stored = storedChannels(row.channels);
  const matrix = {} as Record<NotifyEvent, ChannelPrefs>;
  for (const ev of NOTIFY_EVENTS) {
    const cell: ChannelPrefs = { ...DEFAULT_NOTIFY_MATRIX[ev], ...(stored[ev] ?? {}) };
    const legacy = LEGACY_EVENT[ev];
    if (legacy) {
      cell.inApp = row[legacy.inApp];
      cell.email = row[legacy.email];
    }
    matrix[ev] = cell;
  }
  return {
    mentionedInApp: row.mentionedInApp,
    mentionedEmail: row.mentionedEmail,
    remindersInApp: row.remindersInApp,
    remindersEmail: row.remindersEmail,
    assignedInApp: row.assignedInApp,
    assignedEmail: row.assignedEmail,
    matrix,
    soundOn: row.soundOn,
    sound: (NOTIFICATION_SOUNDS as readonly string[]).includes(row.sound)
      ? (row.sound as NotificationSound)
      : 'chime',
    pushOn: row.pushOn,
  };
}

export const DEFAULT_PREFERENCES: NotificationPreferencesDto = toDto(DEFAULT_ROW);

type Db = PrismaClient | Prisma.TransactionClient;

/** The user's notification preferences, falling back to defaults if unset. */
export async function getNotificationPreferences(
  userId: string,
  db: Db = prisma,
): Promise<NotificationPreferencesDto> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  return toDto(row ?? DEFAULT_ROW);
}

/** Preferences for many users at once (missing users fall back to defaults). */
export async function getPreferencesMap(
  userIds: string[],
  db: Db = prisma,
): Promise<Map<string, NotificationPreferencesDto>> {
  const map = new Map<string, NotificationPreferencesDto>();
  if (userIds.length === 0) return map;
  const rows = await db.notificationPreference.findMany({ where: { userId: { in: userIds } } });
  const byId = new Map(rows.map((r) => [r.userId, toDto(r)]));
  for (const id of userIds) map.set(id, byId.get(id) ?? toDto(DEFAULT_ROW));
  return map;
}

/** Whether this person wants this event on this channel. */
export function wants(
  prefs: NotificationPreferencesDto,
  event: NotifyEvent,
  channel: NotifyChannel,
): boolean {
  return prefs.matrix[event][channel];
}

/** Upsert the user's preferences from a partial patch; returns the full result. */
export async function updateNotificationPreferences(
  userId: string,
  patch: UpdateNotificationPreferencesRequest,
): Promise<NotificationPreferencesDto> {
  const current = await prisma.notificationPreference.findUnique({ where: { userId } });
  const base = current ?? DEFAULT_ROW;
  const data: Partial<Omit<PrefRow, 'channels'>> & { channels?: Prisma.InputJsonValue } = {};
  for (const key of LEGACY_FLAGS) {
    const v = patch[key];
    if (typeof v === 'boolean') data[key] = v;
  }
  if (patch.matrix) {
    const channels = { ...storedChannels(base.channels) };
    for (const ev of NOTIFY_EVENTS) {
      const cell = patch.matrix[ev];
      if (!cell) continue;
      const legacy = LEGACY_EVENT[ev];
      const kept: Partial<ChannelPrefs> = { ...(channels[ev] ?? {}) };
      for (const ch of NOTIFY_CHANNELS) {
        const v = cell[ch];
        if (typeof v !== 'boolean') continue;
        if (legacy && ch !== 'connect') data[legacy[ch]] = v;
        else kept[ch] = v;
      }
      channels[ev] = kept;
    }
    data.channels = channels as Prisma.InputJsonValue;
  }
  if (typeof patch.soundOn === 'boolean') data.soundOn = patch.soundOn;
  if (patch.sound && (NOTIFICATION_SOUNDS as readonly string[]).includes(patch.sound)) {
    data.sound = patch.sound;
  }
  if (typeof patch.pushOn === 'boolean') data.pushOn = patch.pushOn;
  const { channels: baseChannels, ...baseRest } = DEFAULT_ROW;
  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      ...baseRest,
      channels: baseChannels as Prisma.InputJsonValue,
      ...data,
    },
    update: data,
  });
  return toDto(row);
}
