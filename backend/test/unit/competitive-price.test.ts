import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCompetitive,
  type ListingOffersPayload,
} from '../../src/services/exclusives/sp-api/pricing.js';
import { offersWeHold } from '../fixtures/exclusives.js';

const OUR_ID = 'A1UWLDVGZSXGKG';

// Shaped like Amazon's answer for B005FU457Y on 23 Oct 2026: a competitive price
// well under ours, and no Buy Box.
const belowOurs: ListingOffersPayload = {
  ASIN: 'B005FU457Y',
  Summary: {
    TotalOfferCount: 1,
    BuyBoxPrices: [],
    CompetitivePriceThreshold: { Amount: 6.04, CurrencyCode: 'USD' },
  },
  Offers: [{ SellerId: OUR_ID, ListingPrice: { Amount: 9.49 }, Shipping: { Amount: 0 } }],
};

describe("resolveCompetitive (HLAI-124: Amazon's competitive price vs ours)", () => {
  it("reads Amazon's competitive price and our price + shipping", () => {
    assert.deepEqual(resolveCompetitive(belowOurs, OUR_ID), {
      competitivePrice: 6.04,
      ourLandedPrice: 9.49,
    });
  });

  it('adds shipping to our price, and finds our offer among others by seller id', () => {
    // Ours is 19.99 + 5.00; the competitor's offer comes second.
    const payload = {
      ...offersWeHold,
      Summary: { ...offersWeHold.Summary, CompetitivePriceThreshold: { Amount: 22 } },
    };
    const competitive = resolveCompetitive(payload, OUR_ID);
    assert.equal(competitive.competitivePrice, 22);
    assert.equal(competitive.ourLandedPrice?.toFixed(2), '24.99');
  });

  it('counts missing shipping as free', () => {
    const payload = {
      ...belowOurs,
      Offers: [{ SellerId: OUR_ID, ListingPrice: { Amount: 9.49 } }],
    };
    assert.equal(resolveCompetitive(payload, OUR_ID).ourLandedPrice, 9.49);
  });

  it('has no competitive price when Amazon gives none, and still reads ours', () => {
    assert.deepEqual(resolveCompetitive(offersWeHold, OUR_ID), {
      competitivePrice: null,
      ourLandedPrice: 19.99 + 5,
    });
  });

  it('has no price of ours when our offer is not in the answer', () => {
    const payload = {
      ...belowOurs,
      Offers: [{ SellerId: 'AXXXCOMP', ListingPrice: { Amount: 7 }, Shipping: { Amount: 0 } }],
    };
    assert.deepEqual(resolveCompetitive(payload, OUR_ID), {
      competitivePrice: 6.04,
      ourLandedPrice: null,
    });
  });

  it('has no price of ours when our offer carries no price', () => {
    const payload = { ...belowOurs, Offers: [{ SellerId: OUR_ID, Shipping: { Amount: 2 } }] };
    assert.equal(resolveCompetitive(payload, OUR_ID).ourLandedPrice, null);
  });

  it('matches no offer without our seller id', () => {
    assert.equal(resolveCompetitive(belowOurs, undefined).ourLandedPrice, null);
    assert.equal(resolveCompetitive(belowOurs, '').ourLandedPrice, null);
  });

  it('has nothing when there is no answer (e.g. a not-buyable listing)', () => {
    assert.deepEqual(resolveCompetitive(undefined, OUR_ID), {
      competitivePrice: null,
      ourLandedPrice: null,
    });
  });
});
