import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuyBox } from '../../src/services/exclusives/sp-api/pricing.js';
import { offersCompetitor, offersSuppressed, offersWeHold } from '../fixtures/exclusives.js';

const OUR_ID = 'A1UWLDVGZSXGKG';

describe('resolveBuyBox (ignores IsBuyBoxWinner, matches landed price)', () => {
  it('picks the winner by landed price, not IsBuyBoxWinner', () => {
    const bb = resolveBuyBox(offersCompetitor);
    // IsBuyBoxWinner=true is on our offer, but the Buy Box price matches the competitor.
    assert.equal(bb.winnerSellerId, 'A3GRC7XH38FJ6S');
    assert.equal(bb.price, 89.98);
    assert.equal(bb.offerCount, 26);
    assert.notEqual(bb.winnerSellerId, OUR_ID);
  });

  it('matches an offer using listing price + shipping', () => {
    const bb = resolveBuyBox(offersWeHold); // 19.99 + 5.00 = 24.99 landed
    assert.equal(bb.winnerSellerId, OUR_ID);
    assert.equal(bb.price, 24.99);
    assert.equal(bb.offerCount, 3);
  });

  it('reports a suppressed Buy Box when there is no Buy Box price', () => {
    const bb = resolveBuyBox(offersSuppressed);
    assert.equal(bb.winnerSellerId, null);
    assert.equal(bb.price, null);
    assert.equal(bb.offerCount, 0);
  });

  it('handles an undefined payload', () => {
    const bb = resolveBuyBox(undefined);
    assert.equal(bb.winnerSellerId, null);
    assert.equal(bb.price, null);
    assert.equal(bb.offerCount, null);
  });
});
