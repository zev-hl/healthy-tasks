import {
  EXCLUSIVES_PANEL_WINDOW_HOURS,
  type ExclusivesAlertType,
  type ExclusivesGroupAlertStatsDto,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';

/**
 * How many alerts of each type one group has had lately.
 *
 * One `groupBy` rather than twelve counts: the panel shows a chip per alert
 * type, and asking the screen to tally a page of alerts would be silently wrong
 * for any group busy enough to exceed a page — this group logged 110 alerts in
 * the last 24 hours.
 */
export async function groupAlertStats(
  groupId: number,
  now: Date = new Date(),
  windowHours: number = EXCLUSIVES_PANEL_WINDOW_HOURS,
): Promise<ExclusivesGroupAlertStatsDto> {
  const group = await prisma.alertGroup.findUnique({
    where: { id: groupId },
    select: { id: true },
  });
  if (!group) throw HttpError.notFound('Alert group not found.');

  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const rows = await prisma.alertLog.groupBy({
    by: ['alertType'],
    where: { groupId, createdAt: { gte: since } },
    _count: { _all: true },
  });

  const byType: Partial<Record<ExclusivesAlertType, number>> = {};
  let total = 0;
  for (const row of rows) {
    byType[row.alertType as ExclusivesAlertType] = row._count._all;
    total += row._count._all;
  }

  return { groupId, windowHours, total, byType };
}
