import { Prisma } from '@prisma/client';
import {
  DEFAULT_PAGE_SIZE,
  type ExclusivesAlertRowDto,
  type ExclusivesAlertType,
  type ExclusivesMarketplace,
  type PaginatedResult,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { toExclusivesAlertRowDto } from './alert-log.mapper.js';

export interface AlertQueryInput {
  text?: string;
  alertTypes?: ExclusivesAlertType[];
  /** The Groups screen's "see this group's alerts" link. */
  groupIds?: number[];
  marketplaces?: ExclusivesMarketplace[];
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
}

export function buildAlertWhere(input: AlertQueryInput): Prisma.AlertLogWhereInput {
  const and: Prisma.AlertLogWhereInput[] = [];

  const text = input.text?.trim();
  if (text) {
    // Every one of these lives on the alert row itself, so there is no join.
    and.push({
      OR: [
        { asin: { contains: text, mode: 'insensitive' } },
        { title: { contains: text, mode: 'insensitive' } },
        { groupName: { contains: text, mode: 'insensitive' } },
      ],
    });
  }
  if (input.alertTypes?.length) and.push({ alertType: { in: input.alertTypes } });
  if (input.groupIds?.length) and.push({ groupId: { in: input.groupIds } });
  if (input.marketplaces?.length) and.push({ marketplace: { in: input.marketplaces } });

  // Both bounds are inclusive: the screen's date pickers read as "from this day
  // to that day", and an exclusive end would silently drop the last day.
  const createdAt: Prisma.DateTimeFilter = {};
  if (input.from) createdAt.gte = input.from;
  if (input.to) createdAt.lte = input.to;
  if (createdAt.gte || createdAt.lte) and.push({ createdAt });

  return and.length > 0 ? { AND: and } : {};
}

/** One page of the Alert Log, newest first. */
export async function queryAlerts(
  input: AlertQueryInput,
): Promise<PaginatedResult<ExclusivesAlertRowDto>> {
  const where = buildAlertWhere(input);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  const [rows, total] = await prisma.$transaction([
    prisma.alertLog.findMany({
      where,
      // id breaks ties, so two alerts written in the same millisecond cannot
      // swap places between pages.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.alertLog.count({ where }),
  ]);

  return { rows: rows.map(toExclusivesAlertRowDto), total, page, pageSize };
}
