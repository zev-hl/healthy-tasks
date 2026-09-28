import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapCatalogContent } from '../../src/services/exclusives/snapshot.mapper.js';
import { catalogItem } from '../fixtures/exclusives.js';

describe('mapCatalogContent', () => {
  it('extracts brand, bullets, description, dimensions and image', () => {
    const c = mapCatalogContent(catalogItem);
    assert.equal(c.brand, 'Walden Farms');
    assert.equal(c.bulletPoints?.length, 2);
    assert.ok(c.description?.startsWith('A calorie-free'));
    assert.equal(c.dimensions, '3inches x 3inches x 5inches');
    assert.equal(c.mainImageUrl, 'https://m.media-amazon.com/images/I/51chypizJCL.jpg');
  });

  it('returns undefined bullets when none are present', () => {
    const c = mapCatalogContent({ asin: 'X', summaries: [{ brand: 'B' }], attributes: {} });
    assert.equal(c.bulletPoints, undefined);
    assert.equal(c.brand, 'B');
  });
});
