import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectAlerts } from '../../src/services/exclusives/alert-detection.js';
import type { SnapshotView } from '../../src/services/exclusives/snapshot-diff.js';

const US = 'A1UWLDVGZSXGKG';
const COMP = 'A9COMPETITOR00';

const base: SnapshotView = {
  title: 'Widget',
  mainImageUrl: 'http://img/a.jpg',
  category: 'FOOD',
  brand: 'Acme',
  bulletPoints: ['one', 'two', 'three'],
  description: 'A widget.',
  dimensions: '3in',
  listedPrice: 34.99,
  currency: 'USD',
  buyboxWinnerSellerId: US,
  buyboxPrice: 34.99,
  offerCount: 3,
  isSuppressed: false,
  suppressionReason: null,
};

const s = (o: Partial<SnapshotView>): SnapshotView => ({ ...base, ...o });
const types = (a: SnapshotView, b: SnapshotView) => detectAlerts(a, b, US).map((x) => x.alertType).sort();

describe('detectAlerts — Buy Box', () => {
  it('fires Buy Box Won when it becomes ours', () => {
    assert.deepEqual(types(s({ buyboxWinnerSellerId: COMP }), s({ buyboxWinnerSellerId: US })), ['BuyBoxWon']);
  });

  it('fires Buy Box Lost when a competitor takes it (Buy Box still exists)', () => {
    assert.deepEqual(
      types(s({ buyboxWinnerSellerId: US }), s({ buyboxWinnerSellerId: COMP })),
      ['BuyBoxLost'],
    );
  });

  it('does NOT fire Lost when the Buy Box is suppressed (price gone)', () => {
    const after = s({ buyboxWinnerSellerId: null, buyboxPrice: null });
    assert.deepEqual(types(s({ buyboxWinnerSellerId: US }), after), []);
  });

  it('does not fire when the holder is unchanged', () => {
    assert.deepEqual(types(base, s({})), []);
    assert.deepEqual(types(s({ buyboxWinnerSellerId: COMP }), s({ buyboxWinnerSellerId: COMP })), []);
  });
});

describe('detectAlerts — commercial', () => {
  it('fires Price Changed only when both prices are known', () => {
    assert.deepEqual(types(base, s({ listedPrice: 31.49 })), ['PriceChanged']);
    assert.deepEqual(types(s({ listedPrice: null }), s({ listedPrice: 9.99 })), []);
  });

  it('ignores penny/sub-floor price noise (< 1% and < $0.50)', () => {
    assert.deepEqual(types(base, s({ listedPrice: 34.98 })), []); // $0.01, ~0.03%
    assert.deepEqual(types(base, s({ listedPrice: 35.0 })), []); // $0.01, ~0.03%
    assert.deepEqual(types(s({ listedPrice: 10 }), s({ listedPrice: 10.05 })), []); // $0.05, 0.5%
  });

  it('fires on the absolute floor even when the relative move is under 1%', () => {
    assert.deepEqual(types(s({ listedPrice: 100 }), s({ listedPrice: 100.5 })), ['PriceChanged']); // $0.50, 0.5%
  });

  it('fires on the relative floor even when the absolute move is under $0.50', () => {
    assert.deepEqual(types(s({ listedPrice: 10 }), s({ listedPrice: 10.15 })), ['PriceChanged']); // $0.15, 1.5%
  });

  it('fires Number of Sellers Changed on offer-count change', () => {
    assert.deepEqual(types(base, s({ offerCount: 6 })), ['NumberOfSellersChanged']);
  });

  it('fires Listing Suppressed only on the transition into suppression', () => {
    assert.deepEqual(types(base, s({ isSuppressed: true })), ['ListingSuppressed']);
    assert.deepEqual(types(s({ isSuppressed: true }), s({ isSuppressed: false })), []);
  });
});

describe('detectAlerts — content', () => {
  it('maps each content field to its alert type', () => {
    assert.deepEqual(types(base, s({ title: 'Widget XL' })), ['TitleChanged']);
    assert.deepEqual(types(base, s({ brand: 'Acme Pro' })), ['BrandChanged']);
    assert.deepEqual(types(base, s({ mainImageUrl: 'http://img/b.jpg' })), ['MainImageChanged']);
    assert.deepEqual(types(base, s({ description: 'New.' })), ['DescriptionChanged']);
    assert.deepEqual(types(base, s({ dimensions: '4in' })), ['DimensionsChanged']);
    assert.deepEqual(types(base, s({ category: 'GROCERY' })), ['CategoryChanged']);
  });

  it('records which bullets changed as the category', () => {
    const alerts = detectAlerts(base, s({ bulletPoints: ['one', 'TWO', 'three', 'four'] }), US);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.alertType, 'BulletPointsChanged');
    assert.equal(alerts[0]?.category, 'bullet_2,bullet_4');
  });
});

describe('detectAlerts — combined', () => {
  it('emits every applicable alert at once', () => {
    const after = s({ listedPrice: 30, offerCount: 5, buyboxWinnerSellerId: COMP, title: 'New' });
    assert.deepEqual(types(base, after), ['BuyBoxLost', 'NumberOfSellersChanged', 'PriceChanged', 'TitleChanged']);
  });
});
