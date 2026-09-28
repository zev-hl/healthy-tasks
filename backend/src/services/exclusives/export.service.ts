import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  EXCLUSIVES_EXPORT_MAX_ROWS,
  EXCLUSIVES_MARKETPLACE_LABELS,
  type ExclusivesAlertType,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { csvDate, toCsv } from '../../utils/csv.js';
import { buildAlertWhere, type AlertQueryInput } from './alert-log.service.js';

const marketplaceLabel = (value: string): string =>
  EXCLUSIVES_MARKETPLACE_LABELS[value as ExclusivesMarketplace] ?? value;

/**
 * The short code the bulk importer's sheet uses. The group export is written to
 * be handed straight back to that importer, so it speaks the importer's words
 * rather than the screen's labels.
 */
const MARKETPLACE_CODES: Record<ExclusivesMarketplace, string> = { USA: 'US', Canada: 'CA' };
const marketplaceCode = (value: string): string =>
  MARKETPLACE_CODES[value as ExclusivesMarketplace] ?? value;

const alertTypeLabel = (value: string): string =>
  EXCLUSIVES_ALERT_TYPE_LABELS[value as ExclusivesAlertType] ?? value;

/**
 * The Alert Log download. Takes the same filters as the log screen, so what is
 * downloaded is what is on screen, not the whole table.
 */
export async function exportAlertsCsv(
  input: AlertQueryInput & { timeZone?: string },
): Promise<string> {
  const rows = await prisma.alertLog.findMany({
    where: buildAlertWhere(input),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: EXCLUSIVES_EXPORT_MAX_ROWS,
  });

  return toCsv(
    [
      'Date',
      'ASIN',
      'Marketplace',
      'Product',
      'Group',
      'Alert type',
      'What changed',
      'Previous',
      'New',
    ],
    rows.map((r) => [
      csvDate(r.createdAt, input.timeZone),
      r.asin,
      marketplaceLabel(r.marketplace),
      r.title,
      r.groupName,
      alertTypeLabel(r.alertType),
      r.message,
      r.previousValue,
      r.newValue,
    ]),
  );
}

/**
 * A group's ASIN list, in exactly the shape the bulk importer reads back: two
 * columns, ASIN then marketplace code, and no heading row. Exporting a group,
 * editing the sheet and re-importing it is the round trip this serves, so the
 * extra columns a reader might like (SKU, product, last checked) are left out.
 */
export async function exportGroupCsv(id: number, timeZone?: string): Promise<string> {
  const group = await prisma.alertGroup.findUnique({
    where: { id },
    include: {
      listings: {
        orderBy: [{ marketplace: 'asc' }, { asin: 'asc' }],
        take: EXCLUSIVES_EXPORT_MAX_ROWS,
        include: { snapshots: { select: { title: true, capturedAt: true } } },
      },
    },
  });
  if (!group) throw HttpError.notFound('Alert group not found.');

  return toCsv(
    [],
    group.listings.map((l) => [l.asin, marketplaceCode(l.marketplace)]),
  );
}

/** The filename a download should arrive under. */
export function csvFileName(base: string, now: Date = new Date()): string {
  return `${base}-${now.toISOString().slice(0, 10)}.csv`;
}
