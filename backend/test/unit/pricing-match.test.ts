import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchAnswersToSkus,
  type BatchAnswer,
} from '../../src/services/exclusives/sp-api/pricing.js';

// An answer as Amazon sends it: status, price data, and its copy of our request.
function answer(sku: string, offerCount: number, opts: { echo?: boolean } = {}): BatchAnswer {
  return {
    status: { statusCode: 200 },
    body: { payload: { SKU: sku, Summary: { TotalOfferCount: offerCount } } },
    ...(opts.echo === false ? {} : { request: { SellerSKU: sku } }),
  };
}
const invalidSku = (sku: string): BatchAnswer => ({
  status: { statusCode: 400 },
  body: { errors: [{ code: 'InvalidInput', message: `${sku} is an invalid SKU` }] },
  request: { SellerSKU: sku },
});

const offerCounts = (
  results: { sku: string; payload?: { Summary?: { TotalOfferCount?: number } } }[],
) => Object.fromEntries(results.map((r) => [r.sku, r.payload?.Summary?.TotalOfferCount]));

describe('matchAnswersToSkus', () => {
  it('pairs answers by SKU when they come back in the order asked', () => {
    const { results, warnings } = matchAnswersToSkus(['A', 'B'], [answer('A', 1), answer('B', 2)]);
    assert.deepEqual(offerCounts(results), { A: 1, B: 2 });
    assert.deepEqual(warnings, []);
  });

  it('still gives each SKU its own answer when Amazon shuffles them', () => {
    const answers = [answer('C', 3), answer('A', 1), answer('B', 2)];
    const { results, warnings } = matchAnswersToSkus(['A', 'B', 'C'], answers);
    assert.deepEqual(offerCounts(results), { A: 1, B: 2, C: 3 });
    assert.match(warnings.join('\n'), /different order than asked/);
  });

  it('matches an error answer by the SKU in Amazon’s copy of our request', () => {
    const { results } = matchAnswersToSkus(['A', 'BAD'], [invalidSku('BAD'), answer('A', 1)]);
    assert.equal(results.find((r) => r.sku === 'BAD')?.statusCode, 400);
    assert.equal(results.find((r) => r.sku === 'A')?.payload?.Summary?.TotalOfferCount, 1);
  });

  it('uses the SKU in the price data when the request copy is missing', () => {
    const answers = [answer('B', 2, { echo: false }), answer('A', 1, { echo: false })];
    const { results } = matchAnswersToSkus(['A', 'B'], answers);
    assert.deepEqual(offerCounts(results), { A: 1, B: 2 });
  });

  it('falls back to position only for an answer that names no SKU, and says so', () => {
    const nameless: BatchAnswer = { status: { statusCode: 500 } };
    const { results, warnings } = matchAnswersToSkus(['A', 'B'], [answer('A', 1), nameless]);
    assert.equal(results.find((r) => r.sku === 'B')?.statusCode, 500);
    assert.match(warnings.join('\n'), /answer #2 names no SKU — matched to B by position/);
  });

  it('never lets a position guess displace an answer that names its SKU', () => {
    const nameless: BatchAnswer = { status: { statusCode: 500 } };
    const { results } = matchAnswersToSkus(['A', 'B'], [nameless, answer('A', 1)]);
    assert.equal(results.find((r) => r.sku === 'A')?.payload?.Summary?.TotalOfferCount, 1);
  });

  it('ignores an answer for a SKU not asked about; the SKU left unanswered gets none', () => {
    const { results, warnings } = matchAnswersToSkus(['A', 'B'], [answer('A', 1), answer('Z', 9)]);
    assert.equal(results.find((r) => r.sku === 'B')?.statusCode, undefined);
    assert.match(warnings.join('\n'), /answer for Z, which was not asked about — ignored/);
  });
});
