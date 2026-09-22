import { Prisma } from '@prisma/client';
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesAlertMode,
  type ExclusivesAlertType,
  type ExclusivesGroupDto,
  type ExclusivesGroupType,
  type ExclusivesListingClashDto,
  type ExclusivesListingProblemDto,
  type ExclusivesListingsMode,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { assertNotStale } from '../../utils/optimistic.js';
import { GROUP_DETAIL_INCLUDE, toExclusivesGroupDto } from './group.mapper.js';
import { lookupAsins } from './lookup.service.js';

export interface GroupListingInput {
  asin: string;
  marketplace: ExclusivesMarketplace;
}

export interface GroupWriteInput {
  name?: string;
  groupType: ExclusivesGroupType;
  listings: GroupListingInput[];
  listingsMode?: ExclusivesListingsMode;
  /** Take an ASIN that another group watches, keeping its history. */
  moveExisting?: boolean;
  settings?: Partial<Record<ExclusivesAlertType, ExclusivesAlertMode>>;
  expectedUpdatedAt?: string;
}

/** One submitted ASIN, once Amazon and our own records have been consulted. */
interface Resolved extends GroupListingInput {
  sku: string | null;
  title: string | null;
  /** The group that already watches it, if any. */
  ownerId: number | null;
  ownerName: string | null;
  problem: 'not-listed' | 'unavailable' | null;
}

/**
 * Resolve every submitted ASIN before any writing starts, so no Amazon call is
 * ever held open inside a database transaction.
 */
async function resolveSubmitted(listings: GroupListingInput[]): Promise<Resolved[]> {
  if (listings.length === 0) return [];

  const asins = [...new Set(listings.map((l) => l.asin.trim().toUpperCase()))];
  const marketplaces = [...new Set(listings.map((l) => l.marketplace))];
  const { results } = await lookupAsins({ asins, marketplaces });
  const byAsin = new Map(results.map((r) => [r.asin, r]));

  return listings.map((entry) => {
    const asin = entry.asin.trim().toUpperCase();
    const result = byAsin.get(asin);
    const match = result?.listings.find((l) => l.marketplace === entry.marketplace);
    if (!match) {
      return {
        asin,
        marketplace: entry.marketplace,
        sku: null,
        title: null,
        ownerId: null,
        ownerName: null,
        problem: result?.status === 'unavailable' ? 'unavailable' : 'not-listed',
      };
    }
    return {
      asin,
      marketplace: entry.marketplace,
      sku: match.sku,
      title: match.title,
      ownerId: match.groupId,
      ownerName: match.groupName,
      problem: null,
    };
  });
}

/**
 * Refuse the whole save when anything did not resolve. Two different failures,
 * deliberately answered differently: "not on the seller account" is final and
 * the person must fix their input, while "Amazon did not answer" is temporary
 * and the right advice is to try again. Conflating them is what would let an
 * Amazon outage delete monitored listings on a replace.
 */
function assertAllResolved(resolved: Resolved[]): void {
  const problems = resolved.filter((r) => r.problem !== null);
  if (problems.length === 0) return;

  const listings: ExclusivesListingProblemDto[] = problems.map((r) => ({
    asin: r.asin,
    marketplace: r.marketplace,
    reason: r.problem as 'not-listed' | 'unavailable',
  }));

  if (listings.some((l) => l.reason === 'unavailable')) {
    throw new HttpError(
      409,
      'Amazon did not answer for some ASINs. Nothing was saved — try again.',
      {
        code: 'AMAZON_UNAVAILABLE',
        listings,
      },
    );
  }
  throw HttpError.badRequest('Some ASINs are not listed on the seller account.', { listings });
}

/** ASINs another group holds. Moving one is allowed, but only when asked for. */
function assertNoClashes(
  resolved: Resolved[],
  groupId: number | null,
  moveExisting: boolean,
): void {
  const clashes: ExclusivesListingClashDto[] = resolved
    .filter((r) => r.ownerId !== null && r.ownerId !== groupId)
    .map((r) => ({
      asin: r.asin,
      marketplace: r.marketplace,
      groupId: r.ownerId as number,
      groupName: r.ownerName ?? '',
    }));
  if (clashes.length === 0 || moveExisting) return;

  throw new HttpError(409, 'Some ASINs are already watched by another group.', {
    code: 'LISTING_IN_ANOTHER_GROUP',
    clashes,
  });
}

/** An individual is one product; its name comes from the Amazon title. */
function assertShape(input: GroupWriteInput, resolved: Resolved[]): string {
  if (input.groupType === 'INDIVIDUAL') {
    if (resolved.length !== 1) {
      throw HttpError.badRequest('An individual listing must have exactly one ASIN.', {
        listings: ['An individual listing must have exactly one ASIN.'],
      });
    }
    const only = resolved[0] as Resolved;
    return (input.name?.trim() || only.title || only.asin).slice(0, 200);
  }
  const name = input.name?.trim();
  if (!name)
    throw HttpError.badRequest('A group needs a name.', { name: ['A group needs a name.'] });
  return name;
}

/** A duplicate name is a field error, not the bare 409 Prisma would raise. */
async function assertNameFree(name: string, exceptId: number | null): Promise<void> {
  const existing = await prisma.alertGroup.findUnique({ where: { name }, select: { id: true } });
  if (!existing || existing.id === exceptId) return;
  throw new HttpError(409, 'Another group already has that name.', {
    code: 'DUPLICATE_NAME',
    name: ['Another group already has that name.'],
  });
}

function settingRows(
  groupId: number,
  settings: GroupWriteInput['settings'],
): Prisma.AlertSettingCreateManyInput[] {
  // Always all twelve. A missing row also reads as off, but invisibly, and the
  // screen shows a count of what is on (HLAI-71 §8 #16: off by default).
  return EXCLUSIVES_ALERT_TYPES.map((alertType) => ({
    groupId,
    alertType,
    mode: settings?.[alertType] ?? 'off',
  }));
}

export async function createGroup(
  input: GroupWriteInput,
  actorId: string,
): Promise<ExclusivesGroupDto> {
  const resolved = await resolveSubmitted(input.listings);
  assertAllResolved(resolved);
  assertNoClashes(resolved, null, input.moveExisting ?? false);
  const name = assertShape(input, resolved);
  await assertNameFree(name, null);

  const id = await prisma.$transaction(async (tx) => {
    const group = await tx.alertGroup.create({
      data: { name, groupType: input.groupType, createdById: actorId },
    });
    await tx.alertSetting.createMany({ data: settingRows(group.id, input.settings) });

    const moving = resolved.filter((r) => r.ownerId !== null);
    const fresh = resolved.filter((r) => r.ownerId === null);
    if (fresh.length > 0) {
      await tx.listing.createMany({
        data: fresh.map((r) => ({
          groupId: group.id,
          marketplace: r.marketplace,
          asin: r.asin,
          sku: r.sku as string,
          createdById: actorId,
        })),
      });
    }
    // Moved in place: deleting and recreating would take the product's saved
    // state with it and unlink its past alerts.
    for (const r of moving) {
      await tx.listing.update({
        where: { marketplace_asin: { marketplace: r.marketplace, asin: r.asin } },
        data: { groupId: group.id, sku: r.sku as string },
      });
    }
    return group.id;
  });

  return loadGroup(id);
}

export async function updateGroup(
  id: number,
  input: GroupWriteInput,
  actorId: string,
): Promise<ExclusivesGroupDto> {
  const existing = await prisma.alertGroup.findUnique({
    where: { id },
    include: { listings: { select: { id: true, asin: true, marketplace: true } } },
  });
  if (!existing) throw HttpError.notFound('Alert group not found.');
  // Before anything else, and before Amazon: a stale edit should cost nothing.
  assertNotStale(existing, input.expectedUpdatedAt);

  const resolved = await resolveSubmitted(input.listings);
  assertAllResolved(resolved);
  assertNoClashes(resolved, id, input.moveExisting ?? false);
  const name = assertShape(input, resolved);
  await assertNameFree(name, id);

  const mode: ExclusivesListingsMode = input.listingsMode ?? 'merge';
  const submitted = new Set(resolved.map((r) => `${r.marketplace}:${r.asin}`));
  const dropped =
    mode === 'replace'
      ? existing.listings.filter((l) => !submitted.has(`${l.marketplace}:${l.asin}`))
      : [];

  await prisma.$transaction(async (tx) => {
    // Always touch the group row, so an ASIN-only edit still moves `updatedAt`
    // and the next save's stale check has something to compare against.
    await tx.alertGroup.update({
      where: { id },
      data: { name, groupType: input.groupType, updatedById: actorId },
    });

    if (input.settings) {
      for (const row of settingRows(id, input.settings)) {
        await tx.alertSetting.upsert({
          where: { groupId_alertType: { groupId: id, alertType: row.alertType } },
          create: row,
          update: { mode: row.mode },
        });
      }
    }

    if (dropped.length > 0) {
      await tx.listing.deleteMany({ where: { id: { in: dropped.map((l) => l.id) } } });
    }

    const held = new Set(
      existing.listings
        .filter((l) => !dropped.some((d) => d.id === l.id))
        .map((l) => `${l.marketplace}:${l.asin}`),
    );
    const toAdd = resolved.filter((r) => !held.has(`${r.marketplace}:${r.asin}`));

    for (const r of toAdd) {
      if (r.ownerId !== null) {
        await tx.listing.update({
          where: { marketplace_asin: { marketplace: r.marketplace, asin: r.asin } },
          data: { groupId: id, sku: r.sku as string },
        });
      } else {
        await tx.listing.create({
          data: {
            groupId: id,
            marketplace: r.marketplace,
            asin: r.asin,
            sku: r.sku as string,
            createdById: actorId,
          },
        });
      }
    }
  });

  return loadGroup(id);
}

/**
 * Removes the group, its listings and their saved state. Alerts survive: the
 * database nulls their group link and they keep the group name as text, which
 * is exactly what the delete dialog promises.
 */
export async function deleteGroup(id: number): Promise<void> {
  const existing = await prisma.alertGroup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw HttpError.notFound('Alert group not found.');
  await prisma.alertGroup.delete({ where: { id } });
}

async function loadGroup(id: number): Promise<ExclusivesGroupDto> {
  const group = await prisma.alertGroup.findUniqueOrThrow({
    where: { id },
    include: GROUP_DETAIL_INCLUDE,
  });
  return toExclusivesGroupDto(group);
}
