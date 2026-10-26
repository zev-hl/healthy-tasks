import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedBulletIndices,
  diffSnapshots,
  type SnapshotView,
} from '../../src/services/exclusives/snapshot-diff.js';

const base: SnapshotView = {
  title: 'Widget',
  mainImageUrl: 'http://img/a.jpg',
  category: 'FOOD',
  brand: 'Acme',
  bulletPoints: ['one', 'two', 'three'],
  description: 'A widget.',
  dimensions: '3in x 3in x 5in',
  listedPrice: 34.99,
  currency: 'USD',
  buyboxWinnerSellerId: 'A1UWLDVGZSXGKG',
  buyboxPrice: 34.99,
  offerCount: 3,
  isSuppressed: false,
  suppressionReason: null,
};

const clone = (o: Partial<SnapshotView>): SnapshotView => ({ ...base, ...o });
const fields = (v: SnapshotView, w: SnapshotView) => diffSnapshots(v, w).map((c) => c.field).sort();

describe('diffSnapshots', () => {
  it('returns nothing when identical', () => {
    assert.deepEqual(diffSnapshots(base, clone({})), []);
  });

  it('ignores sub-cent price noise but flags a real price change', () => {
    assert.deepEqual(diffSnapshots(base, clone({ listedPrice: 34.992 })), []);
    const d = diffSnapshots(base, clone({ listedPrice: 31.49 }));
    assert.equal(d.length, 1);
    assert.equal(d[0]?.field, 'listedPrice');
    assert.equal(d[0]?.previous, 34.99);
    assert.equal(d[0]?.current, 31.49);
  });

  it('detects a Buy Box winner change', () => {
    assert.deepEqual(fields(base, clone({ buyboxWinnerSellerId: 'A9COMPETITOR' })), ['buyboxWinnerSellerId']);
  });

  it('detects offer count, suppression and content changes', () => {
    assert.deepEqual(fields(base, clone({ offerCount: 6 })), ['offerCount']);
    assert.deepEqual(fields(base, clone({ isSuppressed: true })), ['isSuppressed']);
    assert.deepEqual(fields(base, clone({ title: 'Widget XL' })), ['title']);
    assert.deepEqual(fields(base, clone({ brand: 'Acme Pro' })), ['brand']);
    assert.deepEqual(fields(base, clone({ mainImageUrl: 'http://img/b.jpg' })), ['mainImageUrl']);
  });

  it('detects bullet edits (order-sensitive, length change)', () => {
    assert.deepEqual(fields(base, clone({ bulletPoints: ['one', 'TWO', 'three'] })), ['bulletPoints']);
    assert.deepEqual(fields(base, clone({ bulletPoints: ['one', 'two'] })), ['bulletPoints']);
  });

  it('treats null <-> value as a change but null <-> null as none', () => {
    assert.deepEqual(fields(base, clone({ buyboxPrice: null })), ['buyboxPrice']);
    const bothNull = clone({ buyboxPrice: null, buyboxWinnerSellerId: null, offerCount: null });
    assert.deepEqual(diffSnapshots(bothNull, clone({ buyboxPrice: null, buyboxWinnerSellerId: null, offerCount: null })), []);
  });

  it('reports multiple simultaneous changes', () => {
    assert.deepEqual(
      fields(base, clone({ listedPrice: 30, offerCount: 5, title: 'New' })),
      ['listedPrice', 'offerCount', 'title'],
    );
  });
});

describe('changedBulletIndices', () => {
  it('returns the indices that differ, including added/removed', () => {
    assert.deepEqual(changedBulletIndices(['a', 'b', 'c'], ['a', 'B', 'c']), [1]);
    assert.deepEqual(changedBulletIndices(['a', 'b'], ['a', 'b', 'c']), [2]);
    assert.deepEqual(changedBulletIndices(['a', 'b', 'c'], ['a', 'b']), [2]);
  });
});
