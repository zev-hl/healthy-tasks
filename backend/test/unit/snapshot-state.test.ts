import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftView,
  replacementView,
  sameStoredState,
  snapshotFields,
} from '../../src/services/exclusives/snapshot.repository.js';
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
  competitivePrice: 17.5,
  ourLandedPrice: 24.99,
  competitiveRecorded: true,
  isSuppressed: false,
  suppressionReason: null,
};

// The same data as a fresh sweep brings it.
const draft = (changes: Partial<ListingSnapshotDraft> = {}): ListingSnapshotDraft => ({
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
  competitivePrice: 17.5,
  ourLandedPrice: 19.99 + 5,
  isSuppressed: false,
  ...changes,
});
const fresh = (changes: Partial<ListingSnapshotDraft> = {}): SnapshotView =>
  draftView(draft(changes));

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

  it('rewrites a row saved before the competitive price was read, once a pair is comparable', () => {
    const old = {
      ...saved,
      competitivePrice: null,
      ourLandedPrice: null,
      competitiveRecorded: false,
    };
    // Amazon gave no competitive price (-1), ours is known: comparable.
    const now = fresh({ competitivePrice: null, ourLandedPrice: 9.49 });
    assert.equal(now.competitiveRecorded, true);
    assert.equal(sameStoredState(old, now), false);
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
      { competitivePrice: 18 },
      { competitivePrice: null },
      { ourLandedPrice: 25.99 },
      { ourLandedPrice: null },
      { isSuppressed: true },
    ];
    for (const change of changes) {
      assert.equal(sameStoredState(saved, fresh(change)), false, JSON.stringify(change));
    }
  });
});

describe('the competitive pair as stored (HLAI-124)', () => {
  it("records a new listing's pair only when it is comparable", () => {
    assert.equal(snapshotFields(draft()).competitiveRecorded, true);
    assert.equal(snapshotFields(draft({ competitivePrice: null })).competitiveRecorded, true);
    assert.equal(snapshotFields(draft({ ourLandedPrice: null })).competitiveRecorded, false);
    assert.equal(snapshotFields(draft({ competitivePrice: 24.99 })).competitiveRecorded, false);
  });

  it('takes the fresh pair when the check can compare', () => {
    const now = replacementView(saved, draft({ competitivePrice: 18 }));
    assert.deepEqual(
      [now.competitivePrice, now.ourLandedPrice, now.competitiveRecorded],
      [18, 24.99, true],
    );
  });

  it('keeps the saved pair on a check with equal prices, or without our price', () => {
    for (const change of [{ competitivePrice: 24.99 }, { ourLandedPrice: null }]) {
      const now = replacementView(saved, draft(change));
      assert.deepEqual(
        [now.competitivePrice, now.ourLandedPrice, now.competitiveRecorded],
        [17.5, 24.99, true],
        JSON.stringify(change),
      );
      assert.equal(sameStoredState(saved, now), true, 'nothing to rewrite');
    }
  });

  it('still stores the other fields on such a check', () => {
    const now = replacementView(saved, draft({ ourLandedPrice: null, title: 'Widget XL' }));
    assert.equal(now.title, 'Widget XL');
    assert.equal(now.ourLandedPrice, 24.99);
  });

  it('leaves a row not yet recorded unrecorded until a pair is comparable', () => {
    const old = {
      ...saved,
      competitivePrice: null,
      ourLandedPrice: null,
      competitiveRecorded: false,
    };
    const equal = replacementView(old, draft({ competitivePrice: 24.99 }));
    assert.equal(equal.competitiveRecorded, false);
    assert.equal(replacementView(old, draft()).competitiveRecorded, true);
  });
});
