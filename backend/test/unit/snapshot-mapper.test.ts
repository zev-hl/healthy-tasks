import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapListingSnapshot } from '../../src/services/exclusives/snapshot.mapper.js';
import {
  buyableWithErrorListing,
  errorSeverityListing,
  ownedListing,
  resellerListing,
  suppressedListing,
} from '../fixtures/exclusives.js';

describe('mapListingSnapshot', () => {
  it('maps a brand-owned listing with all fields', () => {
    const s = mapListingSnapshot(ownedListing, 'USA');
    assert.equal(s.asin, 'B0HD28Z5TX');
    assert.equal(s.brand, 'SOMBRA');
    assert.equal(s.category, 'MEDICATION');
    assert.equal(s.mainImageUrl, 'https://m.media-amazon.com/images/I/71fIlObcgPL.jpg');
    assert.equal(s.listedPrice, 14.49);
    assert.equal(s.currency, 'USD');
    assert.equal(s.dimensions, '2.5inches x 2.5inches x 2inches');
    assert.equal(s.bulletPoints.length, 2);
    assert.ok(s.description?.startsWith('Sombra MAX'));
    assert.equal(s.isSuppressed, false);
  });

  it('maps a reseller listing (image from summary, price from schedule, no brand content)', () => {
    const s = mapListingSnapshot(resellerListing, 'USA');
    assert.equal(s.mainImageUrl, 'https://m.media-amazon.com/images/I/31-0q9nwTsL.jpg');
    assert.equal(s.listedPrice, 6.19);
    assert.equal(s.currency, 'USD');
    assert.equal(s.brand, undefined);
    assert.deepEqual(s.bulletPoints, []);
    assert.equal(s.description, undefined);
    assert.equal(s.dimensions, undefined);
    assert.equal(s.isSuppressed, false);
  });

  it('flags suppression on a suppression enforcement action', () => {
    const s = mapListingSnapshot(suppressedListing, 'USA');
    assert.equal(s.isSuppressed, true);
    assert.equal(s.suppressionReason, 'Image requirement not met.');
  });

  it('flags suppression on an ERROR-severity issue when not BUYABLE', () => {
    assert.equal(mapListingSnapshot(errorSeverityListing, 'USA').isSuppressed, true);
  });

  it('does NOT suppress a BUYABLE listing even with an ERROR issue', () => {
    assert.equal(mapListingSnapshot(buyableWithErrorListing, 'USA').isSuppressed, false);
  });

  it('does NOT treat empty issues + no BUYABLE as suppression (brief §6.5)', () => {
    // resellerListing is DISCOVERABLE-only with an empty issues array.
    assert.equal(mapListingSnapshot(resellerListing, 'USA').isSuppressed, false);
  });
});
