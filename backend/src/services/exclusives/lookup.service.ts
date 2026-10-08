import {
  EXCLUSIVES_LOOKUP_MAX_ASINS,
  EXCLUSIVES_MARKETPLACES,
  type ExclusivesLookupListingDto,
  type ExclusivesLookupResponseDto,
  type ExclusivesLookupResultDto,
  type ExclusivesLookupStatus,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { discoverListings } from './listing-discovery.js';
import {
  lookupKey,
  readLookupCache,
  writeLookupCache,
  type CachedListing,
} from './lookup-cache.js';

/** A well-formed ASIN: ten letters or digits. */
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * How many lookups may run at once. Each one can send a burst of listings
 * requests, and the sweep may be running too; two is enough for a person
 * typing while an import runs, and keeps the queue at Amazon short.
 */
export const MAX_CONCURRENT_LOOKUPS = 2;

let running = 0;

export interface LookupInput {
  asins: string[];
  /** Which marketplaces to check. Both, when the caller does not say. */
  marketplaces?: ExclusivesMarketplace[];
}

interface Monitored {
  sku: string;
  title: string | null;
  groupId: number;
  groupName: string;
  addedAt: string;
  addedBy: string | null;
}

/** A person as the editor should name them; falls back to their email. */
function displayName(user: { firstName: string; lastName: string; email: string }): string {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name || user.email;
}

/** Upper-case, well-formed and unique, keeping the caller's order. */
export function normalizeAsins(raw: string[]): { asins: string[]; invalid: string[] } {
  const asins: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const asin = entry.trim().toUpperCase();
    if (!asin) continue;
    if (!ASIN_PATTERN.test(asin)) {
      if (!invalid.includes(asin)) invalid.push(asin);
      continue;
    }
    if (seen.has(asin)) continue;
    seen.add(asin);
    asins.push(asin);
  }
  return { asins, invalid };
}

/** Everything we already watch among these ASINs, keyed marketplace:asin. */
async function loadMonitored(
  asins: string[],
  marketplaces: ExclusivesMarketplace[],
): Promise<Map<string, Monitored>> {
  const out = new Map<string, Monitored>();
  if (asins.length === 0) return out;

  const rows = await prisma.listing.findMany({
    where: { asin: { in: asins }, marketplace: { in: marketplaces } },
    include: {
      group: { select: { id: true, name: true } },
      snapshots: { select: { title: true } },
      // Who put this product under watch, and when — the editor shows both
      // when it has to ask about taking one from another group.
      createdBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  for (const row of rows) {
    out.set(lookupKey(row.marketplace as ExclusivesMarketplace, row.asin), {
      sku: row.sku,
      title: row.snapshots[0]?.title ?? null,
      groupId: row.group.id,
      groupName: row.group.name,
      addedAt: row.createdAt.toISOString(),
      addedBy: row.createdBy ? displayName(row.createdBy) : null,
    });
  }
  return out;
}

function statusOf(
  listings: ExclusivesLookupListingDto[],
  unavailable: boolean,
): ExclusivesLookupStatus {
  if (listings.length === 0) return unavailable ? 'unavailable' : 'not-listed';
  // A move is only offered when every listing we found is already taken; if one
  // marketplace is free, the ASIN can still be added.
  return listings.every((l) => l.groupId !== null) ? 'already-monitored' : 'found';
}

/**
 * Resolve ASINs against the seller account, in four passes that each cut work
 * from the next: tidy up, answer from our own database, answer from the short
 * cache, and only then ask Amazon.
 *
 * Note one deliberate shortcut: an ASIN we already monitor is answered entirely
 * from the database and never reaches Amazon. Re-opening an existing group is
 * the common case, and it would otherwise look up every product in it. The cost
 * is that a product monitored in one marketplace will not have its other
 * marketplace discovered here.
 */
export async function lookupAsins(input: LookupInput): Promise<ExclusivesLookupResponseDto> {
  const marketplaces = input.marketplaces?.length
    ? input.marketplaces
    : [...EXCLUSIVES_MARKETPLACES];

  // 1. Tidy up.
  const { asins, invalid } = normalizeAsins(input.asins);
  if (asins.length > EXCLUSIVES_LOOKUP_MAX_ASINS) {
    throw HttpError.badRequest(
      `Too many ASINs in one request: ${asins.length}. Send at most ${EXCLUSIVES_LOOKUP_MAX_ASINS} at a time.`,
    );
  }
  if (asins.length === 0) return { results: [], invalid, amazonCalls: 0 };

  if (running >= MAX_CONCURRENT_LOOKUPS) {
    throw new HttpError(429, 'Amazon lookups are busy right now. Try again in a moment.', {
      code: 'LOOKUP_BUSY',
    });
  }
  running += 1;
  try {
    return await resolve(asins, invalid, marketplaces);
  } finally {
    running -= 1;
  }
}

async function resolve(
  asins: string[],
  invalid: string[],
  marketplaces: ExclusivesMarketplace[],
): Promise<ExclusivesLookupResponseDto> {
  // 2. Our own database. An ASIN found here is settled for every marketplace.
  const monitored = await loadMonitored(asins, marketplaces);
  const settled = new Set(
    asins.filter((asin) => marketplaces.some((m) => monitored.has(lookupKey(m, asin)))),
  );

  // 3. The short cache, per marketplace.
  const fromCache = new Map<string, CachedListing>();
  const toAsk = new Map<ExclusivesMarketplace, string[]>();
  for (const marketplace of marketplaces) {
    const ask: string[] = [];
    for (const asin of asins) {
      if (settled.has(asin)) continue;
      const key = lookupKey(marketplace, asin);
      const cached = readLookupCache(key);
      if (cached === undefined) ask.push(asin);
      else fromCache.set(key, cached);
    }
    if (ask.length > 0) toAsk.set(marketplace, ask);
  }

  // 4. Amazon, for whatever is left.
  const fresh = new Map<string, CachedListing>();
  const unavailable = new Set<string>();
  let amazonCalls = 0;

  for (const [marketplace, ask] of toAsk) {
    const found = await discoverListings(ask, marketplace, { tolerateFailures: true });
    amazonCalls += found.pages;
    const failed = new Set(found.failed);

    for (const asin of ask) {
      const key = lookupKey(marketplace, asin);
      if (failed.has(asin)) {
        // Never cached and never reported as "not listed": this is temporary.
        unavailable.add(asin);
        continue;
      }
      const sku = found.skuByAsin.get(asin);
      const value: CachedListing = sku ? { sku, title: found.titleByAsin.get(asin) ?? null } : null;
      fresh.set(key, value);
      writeLookupCache(key, value);
    }
  }

  const answer = (key: string): CachedListing | undefined =>
    fresh.has(key) ? fresh.get(key) : fromCache.get(key);

  const results: ExclusivesLookupResultDto[] = asins.map((asin) => {
    const listings: ExclusivesLookupListingDto[] = [];
    for (const marketplace of marketplaces) {
      const key = lookupKey(marketplace, asin);
      const mine = monitored.get(key);
      if (mine) {
        listings.push({
          marketplace,
          sku: mine.sku,
          title: mine.title,
          groupId: mine.groupId,
          groupName: mine.groupName,
          addedAt: mine.addedAt,
          addedBy: mine.addedBy,
        });
        continue;
      }
      const found = answer(key);
      if (found) {
        listings.push({
          marketplace,
          sku: found.sku,
          title: found.title,
          groupId: null,
          groupName: null,
          // Not watched yet, so there is nothing to date or attribute.
          addedAt: null,
          addedBy: null,
        });
      }
    }
    return { asin, status: statusOf(listings, unavailable.has(asin)), listings };
  });

  return { results, invalid, amazonCalls };
}
