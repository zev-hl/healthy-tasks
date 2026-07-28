import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import type {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesRequest,
} from '@healthy-tasks/shared';

// Absent row ⇒ these defaults: receive every list in-app, email nothing.
export const DEFAULT_PREFERENCES: NotificationPreferencesDto = {
  mentionedInApp: true,
  mentionedEmail: false,
  remindersInApp: true,
  remindersEmail: false,
  assignedInApp: true,
  assignedEmail: false,
};

type PrefRow = {
  mentionedInApp: boolean;
  mentionedEmail: boolean;
  remindersInApp: boolean;
  remindersEmail: boolean;
  assignedInApp: boolean;
  assignedEmail: boolean;
};

function toDto(row: PrefRow): NotificationPreferencesDto {
  return {
    mentionedInApp: row.mentionedInApp,
    mentionedEmail: row.mentionedEmail,
    remindersInApp: row.remindersInApp,
    remindersEmail: row.remindersEmail,
    assignedInApp: row.assignedInApp,
    assignedEmail: row.assignedEmail,
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/** The user's notification preferences, falling back to defaults if unset. */
export async function getNotificationPreferences(
  userId: string,
  db: Db = prisma,
): Promise<NotificationPreferencesDto> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  return row ? toDto(row) : { ...DEFAULT_PREFERENCES };
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
  for (const id of userIds) map.set(id, byId.get(id) ?? { ...DEFAULT_PREFERENCES });
  return map;
}

/** Upsert the user's preferences from a partial patch; returns the full result. */
export async function updateNotificationPreferences(
  userId: string,
  patch: UpdateNotificationPreferencesRequest,
): Promise<NotificationPreferencesDto> {
  // Keep only defined boolean fields (PATCH semantics).
  const data: Partial<PrefRow> = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof NotificationPreferencesDto)[]) {
    const v = patch[key];
    if (typeof v === 'boolean') data[key] = v;
  }
  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_PREFERENCES, ...data },
    update: data,
  });
  return toDto(row);
}
