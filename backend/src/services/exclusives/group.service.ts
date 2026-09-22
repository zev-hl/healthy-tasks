import { Prisma } from '@prisma/client';
import {
  DEFAULT_PAGE_SIZE,
  EXCLUSIVES_ASIN_PREVIEW,
  type ExclusivesGroupRowDto,
  type ExclusivesGroupDto,
  type ExclusivesGroupSortField,
  type ExclusivesGroupType,
  type PaginatedResult,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { GROUP_DETAIL_INCLUDE, toExclusivesGroupDto } from './group.mapper.js';

export const ALERTS_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface GroupQueryInput {
  text?: string;
  groupTypes?: ExclusivesGroupType[];
  sort?: { field: ExclusivesGroupSortField; dir: 'asc' | 'desc' }[];
  page?: number;
  pageSize?: number;
}

function buildWhere(input: GroupQueryInput): Prisma.AlertGroupWhereInput {
  const and: Prisma.AlertGroupWhereInput[] = [];
  const text = input.text?.trim();
  if (text) {
    // Name, any ASIN in the group, or any listing's last-seen title.
    and.push({
      OR: [
        { name: { contains: text, mode: 'insensitive' } },
        { listings: { some: { asin: { contains: text, mode: 'insensitive' } } } },
        {
          listings: {
            some: { snapshots: { some: { title: { contains: text, mode: 'insensitive' } } } },
          },
        },
      ],
    });
  }
  if (input.groupTypes && input.groupTypes.length > 0) {
    and.push({ groupType: { in: input.groupTypes } });
  }
  return and.length > 0 ? { AND: and } : {};
}

function buildOrderBy(sort: GroupQueryInput['sort']): Prisma.AlertGroupOrderByWithRelationInput[] {
  const out: Prisma.AlertGroupOrderByWithRelationInput[] = [];
  for (const s of sort ?? []) {
    if (s.field === 'listingCount') out.push({ listings: { _count: s.dir } });
    else out.push({ [s.field]: s.dir });
  }
  if (out.length === 0) out.push({ updatedAt: 'desc' });
  // Stable tiebreaker, so paging can never repeat or skip a row.
  out.push({ id: 'asc' });
  return out;
}

/**
 * The first few ASINs of each group, in one query. A plain include would pull
 * every listing of every group on the page — one group already holds 445 — so
 * the ranking is done in Postgres and only the preview rows come back. DISTINCT
 * first: a product sold in both marketplaces is two listings but one ASIN, and
 * showing it twice in a three-item preview looks like a bug.
 */
async function previewAsins(ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const rows = await prisma.$queryRaw<{ groupId: number; asin: string }[]>`
    SELECT "groupId", "asin"
    FROM (
      SELECT "groupId", "asin",
             ROW_NUMBER() OVER (PARTITION BY "groupId" ORDER BY "asin") AS rn
      FROM (
        SELECT DISTINCT "groupId", "asin"
        FROM "Listing"
        WHERE "groupId" IN (${Prisma.join(ids)})
      ) distinct_asins
    ) ranked
    WHERE rn <= ${EXCLUSIVES_ASIN_PREVIEW}
    ORDER BY "groupId", "asin"`;
  for (const row of rows) {
    const list = out.get(row.groupId) ?? [];
    list.push(row.asin);
    out.set(row.groupId, list);
  }
  return out;
}

/** One page of the Alert Groups list, with the numbers each row shows. */
export async function queryGroups(
  input: GroupQueryInput,
  now: Date = new Date(),
): Promise<PaginatedResult<ExclusivesGroupRowDto>> {
  const where = buildWhere(input);
  const orderBy = buildOrderBy(input.sort);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  const [groups, total] = await prisma.$transaction([
    prisma.alertGroup.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { listings: true } } },
    }),
    prisma.alertGroup.count({ where }),
  ]);

  // Everything else is a fixed number of aggregates over this page's ids, so
  // the query count does not grow with the page size.
  const ids = groups.map((g) => g.id);
  const since = new Date(now.getTime() - ALERTS_WINDOW_MS);
  const [recent, latest, typesOn, preview] = await Promise.all([
    ids.length
      ? prisma.alertLog.groupBy({
          by: ['groupId'],
          where: { groupId: { in: ids }, createdAt: { gte: since } },
          _count: { _all: true },
        })
      : [],
    ids.length
      ? prisma.alertLog.groupBy({
          by: ['groupId'],
          where: { groupId: { in: ids } },
          _max: { createdAt: true },
        })
      : [],
    ids.length
      ? prisma.alertSetting.groupBy({
          by: ['groupId'],
          where: { groupId: { in: ids }, mode: { not: 'off' } },
          _count: { _all: true },
        })
      : [],
    previewAsins(ids),
  ]);

  const recentById = new Map(recent.map((r) => [r.groupId, r._count._all]));
  const latestById = new Map(latest.map((r) => [r.groupId, r._max.createdAt]));
  const typesOnById = new Map(typesOn.map((r) => [r.groupId, r._count._all]));

  const rows = groups.map((g): ExclusivesGroupRowDto => ({
    id: g.id,
    name: g.name,
    groupType: g.groupType as ExclusivesGroupType,
    listingCount: g._count.listings,
    asinPreview: preview.get(g.id) ?? [],
    alerts24h: recentById.get(g.id) ?? 0,
    alertTypesOn: typesOnById.get(g.id) ?? 0,
    latestAlertAt: latestById.get(g.id)?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  }));

  return { rows, total, page, pageSize };
}

/** One group with its listings and all 12 alert settings, for the editor. */
export async function getGroup(id: number): Promise<ExclusivesGroupDto> {
  const group = await prisma.alertGroup.findUnique({
    where: { id },
    include: GROUP_DETAIL_INCLUDE,
  });
  if (!group) throw HttpError.notFound('Alert group not found.');
  return toExclusivesGroupDto(group);
}
