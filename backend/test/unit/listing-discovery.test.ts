import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ListingItem } from '../../src/services/exclusives/sp-api/listings.js';
import { __resetHttpHooks } from '../../src/services/exclusives/sp-api/http.js';
import { fakeAmazon } from '../fixtures/fake-amazon.js';

// env.ts reads its config once, at import: pin fake credentials first.
process.env.SP_API_CLIENT_ID = 'test-client';
process.env.SP_API_CLIENT_SECRET = 'test-secret';
process.env.SP_API_REFRESH_TOKEN = 'test-refresh';
process.env.SP_API_MERCHANT_TOKEN = 'A1UWLDVGZSXGKG';
process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.JWT_SECRET ??= 'unused';
const { discoverListings, pickSku } =
  await import('../../src/services/exclusives/listing-discovery.js');
const { clearTokenCache } = await import('../../src/services/exclusives/sp-api/auth.js');

const listing = (asin: string, sku: string): ListingItem => ({
  sku,
  summaries: [{ asin, itemName: `Item ${asin}`, status: ['BUYABLE'] }],
});

const asin = (n: number) => `B${String(n).padStart(9, '0')}`;

afterEach(() => {
  __resetHttpHooks();
  clearTokenCache();
});

describe('pickSku', () => {
  it('keeps the only SKU there is', () => {
    assert.equal(pickSku(['SOM-4004']), 'SOM-4004');
  });

  it('prefers a real SKU over a fulfilment leftover', () => {
    assert.equal(pickSku(['FBA1963N2SPT.missing1', 'SOM-4004']), 'SOM-4004');
    assert.equal(pickSku(['SOM-4004', 'FBA1963N2SPT.missing1']), 'SOM-4004');
    assert.equal(pickSku(['FBA18ZT2CSN0.missing.1', 'AM-6820']), 'AM-6820');
  });

  it('prefers a real SKU over a test listing', () => {
    assert.equal(pickSku(['B005XLF6KK-TEST', 'SOM-8008']), 'SOM-8008');
    assert.equal(pickSku(['TEST-1', 'RA-2902']), 'RA-2902');
  });

  it('prefers a test listing over a leftover, when those are the only choices', () => {
    assert.equal(pickSku(['FBA1963N2SPT.missing1', 'X-TEST']), 'X-TEST');
  });

  it("keeps Amazon's order among equally good SKUs", () => {
    assert.equal(pickSku(['WF-3118-A', 'WF-3118']), 'WF-3118-A');
    assert.equal(pickSku(['BTZ-0117', 'BTZ-0117-SL']), 'BTZ-0117');
  });

  it('does not mistake a SKU that merely contains the letters for a test listing', () => {
    assert.equal(pickSku(['PROTEST-9', 'ZZ-1']), 'PROTEST-9');
    assert.equal(pickSku(['LATEST-2', 'ZZ-1']), 'LATEST-2');
  });
});

describe('discoverListings', () => {
  it('follows nextToken, so listings past the first page are never lost', async () => {
    // 20 ASINs in one batch, but 6 of them carry a second SKU: 26 items, and a
    // page holds 20. Reading only the first page loses 6 ASINs — the bug that
    // left 11 listings unmonitored after the first seeding run.
    const asins = Array.from({ length: 20 }, (_, i) => asin(i));
    const items = [
      ...asins.map((a, i) => listing(a, `SKU-${i}`)),
      ...asins.slice(14).map((a, i) => listing(a, `SKU-${i + 14}-B`)),
    ];
    assert.equal(items.length, 26);

    const { requests } = fakeAmazon({ items });
    const found = await discoverListings(asins, 'USA');

    assert.equal(requests.filter((p) => p.startsWith('/listings/')).length, 2);
    assert.equal(found.pages, 2);
    assert.equal(found.skuByAsin.size, 20);
    for (const a of asins) assert.ok(found.skuByAsin.has(a), `${a} missing`);
  });

  it('stops after one page when everything fits', async () => {
    const asins = [asin(1), asin(2)];
    const { requests } = fakeAmazon({
      items: asins.map((a, i) => listing(a, `SKU-${i}`)),
    });
    const found = await discoverListings(asins, 'USA');

    assert.equal(requests.filter((p) => p.startsWith('/listings/')).length, 1);
    assert.equal(found.pages, 1);
    assert.equal(found.skuByAsin.size, 2);
  });

  it('splits more than 20 ASINs into batches', async () => {
    const asins = Array.from({ length: 41 }, (_, i) => asin(i));
    const { requests } = fakeAmazon({
      items: asins.map((a, i) => listing(a, `SKU-${i}`)),
    });
    const found = await discoverListings(asins, 'USA');

    assert.equal(requests.filter((p) => p.startsWith('/listings/')).length, 3);
    assert.equal(found.skuByAsin.size, 41);
  });

  it('reports every SKU but monitors the best one, across pages', async () => {
    const asins = Array.from({ length: 20 }, (_, i) => asin(i));
    const target = asins[19]!;
    const items = [
      // The leftover comes first and lands on page 1; the real SKU is on page 2.
      ...asins.map((a, i) =>
        a === target ? listing(a, 'FBA19BKPVK2L.missing1') : listing(a, `SKU-${i}`),
      ),
      listing(target, 'SOM-0078'),
    ];

    fakeAmazon({ items });
    const found = await discoverListings(asins, 'USA');

    assert.deepEqual(found.allSkusByAsin.get(target), ['FBA19BKPVK2L.missing1', 'SOM-0078']);
    assert.equal(found.skuByAsin.get(target), 'SOM-0078');
  });

  it('returns nothing for ASINs the account does not list', async () => {
    const { requests } = fakeAmazon({ items: [] });
    const found = await discoverListings([asin(1), asin(2)], 'Canada');

    assert.equal(found.skuByAsin.size, 0);
    assert.equal(requests.filter((p) => p.startsWith('/listings/')).length, 1);
  });
});
