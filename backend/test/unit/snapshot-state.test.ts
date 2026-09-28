import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { draftView, sameStoredState } from '../../src/services/exclusives/snapshot.repository.js';
import type { SnapshotView } from '../../src/services/exclusives/snapshot-diff.js';
import type { ListingSnapshotDraft } from '../../src/services/exclusives/snapshot.mapper.js';

// A saved snapshot, as read back from the DB (stored form).
const saved: SnapshotView = {
  title: 'Widget',
  mainImageUrl: 'https://img/1.jpg',
  category: 'VITAMIN',
  brand: 'Acme',
  bulletPoints: ['one', 'two'],
  description: 'A widget.',
  dimensions: '2in x 2in x 1in',
  listedPrice: 19.99,
  currency: 'USD',
  buyboxWinnerSellerId: 'A1UWLDVGZSXGKG',
  buyboxPrice: 19.99,
  offerCount: 4,
  isSuppressed: false,
  suppressionReason: null,
};

// The same data as a fresh sweep brings it.
const fresh = (changes: Partial<ListingSnapshotDraft> = {}): SnapshotView =>
  draftView({
    sku: 'W-1',
    marketplace: 'USA',
    title: 'Widget',
    mainImageUrl: 'https://img/1.jpg',
    category: 'VITAMIN',
    brand: 'Acme',
    bulletPoints: ['one', 'two'],
    description: 'A widget.',
    dimensions: '2in x 2in x 1in',
    listedPrice: 19.99,
    currency: 'USD',
    buyboxWinnerSellerId: 'A1UWLDVGZSXGKG',
    buyboxPrice: 19.99,
    offerCount: 4,
    isSuppressed: false,
    ...changes,
  });

describe('sameStoredState', () => {
  it('is true when fresh data would store exactly what is saved', () => {
    assert.equal(sameStoredState(saved, fresh()), true);
  });

  it('compares money as stored (to the cent), so float noise is not a change', () => {
    assert.equal(sameStoredState(saved, fresh({ listedPrice: 19.9900001 })), true);
    assert.equal(sameStoredState(saved, fresh({ listedPrice: 19.98 })), false);
  });

  it('counts a change in a field no alert watches (currency, suppression reason)', () => {
    assert.equal(sameStoredState(saved, fresh({ currency: 'CAD' })), false);
    assert.equal(sameStoredState(saved, fresh({ suppressionReason: 'Image missing' })), false);
  });

  it('counts bullet edits, reordering and additions', () => {
    assert.equal(sameStoredState(saved, fresh({ bulletPoints: ['one', 'TWO'] })), false);
    assert.equal(sameStoredState(saved, fresh({ bulletPoints: ['two', 'one'] })), false);
    assert.equal(sameStoredState(saved, fresh({ bulletPoints: ['one', 'two', 'three'] })), false);
  });

  it('treats a missing value in fresh data the same as a saved null', () => {
    const noReason = { ...saved, suppressionReason: null };
    assert.equal(sameStoredState(noReason, fresh({ suppressionReason: undefined })), true);
  });

  it('counts every other field too', () => {
    const changes: Partial<ListingSnapshotDraft>[] = [
      { title: 'Widget XL' },
      { mainImageUrl: 'https://img/2.jpg' },
      { category: 'TOPICALS' },
      { brand: 'Other' },
      { description: 'New text.' },
      { dimensions: '3in x 2in x 1in' },
      { buyboxWinnerSellerId: 'A9COMPETITOR0' },
      { buyboxPrice: 18.5 },
      { offerCount: 5 },
      { isSuppressed: true },
    ];
    for (const change of changes) {
      assert.equal(sameStoredState(saved, fresh(change)), false, JSON.stringify(change));
    }
  });
});
