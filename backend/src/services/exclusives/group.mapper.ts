import type { Prisma } from '@prisma/client';
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesAlertMode,
  type ExclusivesAlertType,
  type ExclusivesGroupDto,
  type ExclusivesGroupType,
  type ExclusivesListingDto,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';

// A listing keeps exactly one snapshot, updated in place (HLAI-71 §8 #14), so
// the editor only ever needs the first row here.
export const GROUP_DETAIL_INCLUDE = {
  settings: true,
  listings: {
    orderBy: [{ marketplace: 'asc' }, { asin: 'asc' }],
    include: { snapshots: { select: { title: true, capturedAt: true } } },
  },
} satisfies Prisma.AlertGroupInclude;

export type GroupDetailRow = Prisma.AlertGroupGetPayload<{ include: typeof GROUP_DETAIL_INCLUDE }>;
type ListingRow = GroupDetailRow['listings'][number];

/**
 * All 12 alert types, always. A group may hold fewer setting rows — one written
 * before a type existed, or none at all — and a missing row means off
 * (see alert-gating.ts), so the screen must not have to guess.
 */
export function normalizeSettings(
  settings: { alertType: string; mode: string }[],
): Record<ExclusivesAlertType, ExclusivesAlertMode> {
  const saved = new Map(settings.map((s) => [s.alertType, s.mode as ExclusivesAlertMode]));
  const out = {} as Record<ExclusivesAlertType, ExclusivesAlertMode>;
  for (const type of EXCLUSIVES_ALERT_TYPES) out[type] = saved.get(type) ?? 'off';
  return out;
}

export function toExclusivesListingDto(listing: ListingRow): ExclusivesListingDto {
  const snapshot = listing.snapshots[0];
  return {
    id: listing.id,
    asin: listing.asin,
    marketplace: listing.marketplace as ExclusivesMarketplace,
    sku: listing.sku,
    title: snapshot?.title ?? null,
    lastCheckedAt: snapshot?.capturedAt.toISOString() ?? null,
  };
}

export function toExclusivesGroupDto(group: GroupDetailRow): ExclusivesGroupDto {
  return {
    id: group.id,
    name: group.name,
    groupType: group.groupType as ExclusivesGroupType,
    listings: group.listings.map(toExclusivesListingDto),
    settings: normalizeSettings(group.settings),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}
