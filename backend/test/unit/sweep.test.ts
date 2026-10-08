import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __resetHttpHooks } from '../../src/services/exclusives/sp-api/http.js';
import {
  catalogItem,
  offersWeHold,
  ownedListing,
  resellerListing,
} from '../fixtures/exclusives.js';
import { fakeAmazon, plainListing, resoldListing } from '../fixtures/fake-amazon.js';

// env.ts reads its config once, at import: pin fake credentials first. Every
// request below goes to the fake Amazon, never the network.
process.env.SP_API_CLIENT_ID = 'test-client';
process.env.SP_API_CLIENT_SECRET = 'test-secret';
process.env.SP_API_REFRESH_TOKEN = 'test-refresh';
process.env.SP_API_MERCHANT_TOKEN = 'A1UWLDVGZSXGKG';
process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.JWT_SECRET ??= 'unused';
const sweepModule = await import('../../src/services/exclusives/sweep.service.js');
const { MAX_CONSECUTIVE_FAILURES } = sweepModule;
const { isTransientOfferResult } = await import('../../src/services/exclusives/sp-api/pricing.js');
const { clearTokenCache } = await import('../../src/services/exclusives/sp-api/auth.js');

// Real pacing (0.5 pricing calls/s) would make multi-batch tests take seconds.
const FAST = { listings: 1000, pricing: 1000, catalog: 1000 };
const sweepListings = (listings: Parameters<typeof sweepModule.sweepListings>[0]) =>
  sweepModule.sweepListings(listings, () => {}, FAST);

const US = 'ATVPDKIKX0DER';

const us = (...skus: string[]) => skus.map((sku) => ({ sku, marketplace: 'USA' as const }));
const reasons = (skipped: { sku: string; reason: string }[]) =>
  Object.fromEntries(skipped.map((s) => [s.sku, s.reason]));
const countBy = <T>(items: T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[key(item)] = (acc[key(item)] ?? 0) + 1;
    return acc;
  }, {});

beforeEach(() => clearTokenCache());
afterEach(() => __resetHttpHooks());

describe('sweepListings', () => {
  it('merges listing + pricing into one complete snapshot per SKU', async () => {
    fakeAmazon({ items: [ownedListing] });
    const res = await sweepListings(us(ownedListing.sku));
    assert.equal(res.snapshots.length, 1);
    assert.equal(res.snapshots[0]!.buyboxWinnerSellerId, 'A1UWLDVGZSXGKG');
    assert.equal(res.snapshots[0]!.buyboxPrice, 24.99);
    assert.deepEqual(res.skipped, []);
    assert.equal(res.aborted, false);
  });

  it('skips a SKU whose own pricing answer was throttled or failed', async () => {
    fakeAmazon({
      items: [plainListing('A'), plainListing('B'), plainListing('C')],
      pricing: { A: { statusCode: 429 }, B: { statusCode: 503 } },
    });
    const res = await sweepListings(us('A', 'B', 'C'));
    assert.deepEqual(
      res.snapshots.map((s) => s.sku),
      ['C'],
    );
    assert.deepEqual(reasons(res.skipped), { A: 'pricing-unavailable', B: 'pricing-unavailable' });
  });

  it('keeps a not-buyable SKU ("invalid SKU" 400) as a real no-Buy-Box answer', async () => {
    fakeAmazon({ items: [plainListing('A')], pricing: { A: { statusCode: 400 } } });
    const res = await sweepListings(us('A'));
    assert.equal(res.snapshots.length, 1);
    assert.equal(res.snapshots[0]!.buyboxPrice, null);
    assert.equal(res.snapshots[0]!.buyboxWinnerSellerId, null);
  });

  it('reports a SKU Amazon did not return', async () => {
    fakeAmazon({ items: [plainListing('A')] });
    const res = await sweepListings(us('A', 'GONE'));
    assert.deepEqual(
      res.snapshots.map((s) => s.sku),
      ['A'],
    );
    assert.deepEqual(reasons(res.skipped), { GONE: 'not-returned' });
  });

  it('fills a resold listing from the catalog', async () => {
    fakeAmazon({
      items: [resellerListing],
      catalog: [{ ...catalogItem, asin: resellerListing.summaries![0]!.asin }],
    });
    const res = await sweepListings(us(resellerListing.sku));
    assert.equal(res.snapshots[0]!.brand, 'Walden Farms');
    assert.equal(res.snapshots[0]!.bulletPoints.length, 2);
  });

  it('skips only the listings that needed a catalog fill when it fails', async () => {
    fakeAmazon({ items: [resellerListing, ownedListing], failCatalog: true });
    const res = await sweepListings(us(resellerListing.sku, ownedListing.sku));
    assert.deepEqual(
      res.snapshots.map((s) => s.sku),
      [ownedListing.sku],
    );
    assert.deepEqual(reasons(res.skipped), { [resellerListing.sku]: 'catalog-unavailable' });
  });

  it('isolates a failed batch: other marketplaces still get snapshots', async () => {
    fakeAmazon({
      items: [plainListing('US-1'), plainListing('CA-1')],
      failListings: (marketplaceId) => marketplaceId === US,
    });
    const res = await sweepListings([
      { sku: 'US-1', marketplace: 'USA' },
      { sku: 'CA-1', marketplace: 'Canada' },
    ]);
    assert.deepEqual(
      res.snapshots.map((s) => s.sku),
      ['CA-1'],
    );
    assert.deepEqual(reasons(res.skipped), { 'US-1': 'batch-failed' });
    assert.equal(res.aborted, false);
  });

  it('stops after repeated batch failures and makes no further calls', async () => {
    // Four batches of 20; every listings call is rejected.
    const skus = Array.from({ length: 80 }, (_, i) => `S${i}`);
    const amazon = fakeAmazon({ items: skus.map(plainListing), failListings: () => true });
    const res = await sweepListings(us(...skus));
    assert.equal(res.aborted, true);
    assert.equal(amazon.requests.length, MAX_CONSECUTIVE_FAILURES);
    assert.deepEqual(
      countBy(res.skipped, (s) => s.reason),
      { 'batch-failed': 60, 'sweep-aborted': 20 },
    );
  });

  it('stops catalog fills after repeated catalog failures but keeps monitoring prices', async () => {
    // Four batches; every one has resold listings, the last also a plain one.
    const resold = Array.from({ length: 79 }, (_, i) => `R${i}`);
    const amazon = fakeAmazon({
      items: [...resold.map(resoldListing), plainListing('P')],
      failCatalog: true,
    });
    const res = await sweepListings(us(...resold, 'P'));
    assert.equal(res.aborted, false);
    assert.deepEqual(
      countBy(amazon.requests, (path) => path.split('/')[1]!),
      { listings: 4, batches: 4, catalog: MAX_CONSECUTIVE_FAILURES },
    );
    assert.deepEqual(
      res.snapshots.map((s) => s.sku),
      ['P'],
    );
    assert.deepEqual(
      countBy(res.skipped, (s) => s.reason),
      { 'catalog-unavailable': 79 },
    );
  });

  it('never throws for an SP-API failure', async () => {
    fakeAmazon({ items: [], failListings: () => true });
    const res = await sweepListings(us('A'));
    assert.deepEqual(res.snapshots, []);
    assert.deepEqual(reasons(res.skipped), { A: 'batch-failed' });
  });

  it('gives each listing its own pricing when Amazon answers out of order', async () => {
    const sellers = (count: number) => ({
      statusCode: 200,
      payload: { ...offersWeHold, Summary: { ...offersWeHold.Summary, TotalOfferCount: count } },
    });
    fakeAmazon({
      items: [plainListing('A'), plainListing('B'), plainListing('C')],
      pricing: { A: sellers(3), B: sellers(5), C: sellers(7) },
      reversePricing: true,
    });
    const log: string[] = [];
    const res = await sweepModule.sweepListings(us('A', 'B', 'C'), (m) => log.push(m), FAST);
    const offerCounts = Object.fromEntries(res.snapshots.map((s) => [s.sku, s.offerCount]));
    assert.deepEqual(offerCounts, { A: 3, B: 5, C: 7 });
    assert.match(log.join('\n'), /USA: pricing answers came back in a different order/);
  });
});

describe('isTransientOfferResult', () => {
  it('distrusts a missing, throttled or 5xx answer, but not a real 4xx', () => {
    assert.equal(isTransientOfferResult(undefined), true);
    assert.equal(isTransientOfferResult({ sku: 'A' }), true);
    assert.equal(isTransientOfferResult({ sku: 'A', statusCode: 429 }), true);
    assert.equal(isTransientOfferResult({ sku: 'A', statusCode: 500 }), true);
    assert.equal(isTransientOfferResult({ sku: 'A', statusCode: 200 }), false);
    assert.equal(isTransientOfferResult({ sku: 'A', statusCode: 400 }), false);
    assert.equal(isTransientOfferResult({ sku: 'A', statusCode: 404 }), false);
  });
});
