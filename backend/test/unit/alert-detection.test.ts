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
  competitivePrice: null,
  ourLandedPrice: null,
  competitiveRecorded: true,
  isSuppressed: false,
  suppressionReason: null,
};

const s = (o: Partial<SnapshotView>): SnapshotView => ({ ...base, ...o });
const types = (a: SnapshotView, b: SnapshotView) =>
  detectAlerts(a, b, US)
    .map((x) => x.alertType)
    .sort();

describe('detectAlerts — Buy Box', () => {
  it('fires Buy Box Won when it becomes ours', () => {
    assert.deepEqual(types(s({ buyboxWinnerSellerId: COMP }), s({ buyboxWinnerSellerId: US })), [
      'BuyBoxWon',
    ]);
  });

  it('fires Buy Box Lost when a competitor takes it (Buy Box still exists)', () => {
    assert.deepEqual(types(s({ buyboxWinnerSellerId: US }), s({ buyboxWinnerSellerId: COMP })), [
      'BuyBoxLost',
    ]);
  });

  it('does NOT fire Lost when the Buy Box is suppressed (price gone)', () => {
    const after = s({ buyboxWinnerSellerId: null, buyboxPrice: null });
    assert.deepEqual(types(s({ buyboxWinnerSellerId: US }), after), []);
  });

  it('does not fire when the holder is unchanged', () => {
    assert.deepEqual(types(base, s({})), []);
    assert.deepEqual(
      types(s({ buyboxWinnerSellerId: COMP }), s({ buyboxWinnerSellerId: COMP })),
      [],
    );
  });
});

describe('detectAlerts — commercial', () => {
  it('fires Price Changed only when both prices are known', () => {
    assert.deepEqual(types(base, s({ listedPrice: 31.49 })), ['PriceChanged']);
    assert.deepEqual(types(s({ listedPrice: null }), s({ listedPrice: 9.99 })), []);
  });

  // The client asked for no minimum (HLAI-71 §8 #12): a repricer moving a
  // product by a cent is exactly what they want to see.
  it('fires on a one-cent move, however small it is in percentage terms', () => {
    assert.deepEqual(types(base, s({ listedPrice: 34.98 })), ['PriceChanged']); // $0.01
    assert.deepEqual(types(base, s({ listedPrice: 35.0 })), ['PriceChanged']); // $0.01
    assert.deepEqual(types(s({ listedPrice: 10 }), s({ listedPrice: 10.05 })), ['PriceChanged']);
  });

  it('still ignores sub-cent float noise, which is not a real move', () => {
    assert.deepEqual(types(base, s({ listedPrice: 34.990001 })), []);
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

  it('keeps the wording of the changed bullets, which nothing else retains', () => {
    // The snapshot is overwritten on the next sweep, so if the alert does not
    // capture the old text here it is gone for good.
    const alerts = detectAlerts(base, s({ bulletPoints: ['one', 'TWO', 'three', 'four'] }), US);

    assert.equal(alerts[0]?.previousValue, '2. two\n4. (none)');
    assert.equal(alerts[0]?.newValue, '2. TWO\n4. four');
  });
});

describe('detectAlerts — combined', () => {
  it('emits every applicable alert at once', () => {
    const after = s({ listedPrice: 30, offerCount: 5, buyboxWinnerSellerId: COMP, title: 'New' });
    assert.deepEqual(types(base, after), [
      'BuyBoxLost',
      'NumberOfSellersChanged',
      'PriceChanged',
      'TitleChanged',
    ]);
  });
});

describe('detectAlerts — competitive price (HLAI-124)', () => {
  // Our price + shipping $9.49 unless a test says otherwise.
  const at = (competitivePrice: number | null, o: Partial<SnapshotView> = {}) =>
    s({ competitivePrice, ourLandedPrice: 9.49, ...o });
  const BELOW = 'CompetitivePriceBelowOurs';
  const UP = 'CompetitivePriceIncreased';
  const MOVED = 'CompetitivePriceChanged';

  it('fires Below when the competitive price drops under ours', () => {
    assert.deepEqual(types(at(10), at(6.04)), [BELOW, MOVED]);
  });

  it('fires Below when our price rises over it', () => {
    assert.deepEqual(types(at(9.49), at(9.49, { ourLandedPrice: 9.99 })), [BELOW]);
  });

  it('does not count equal to ours as below', () => {
    assert.deepEqual(types(at(10), at(9.49)), [MOVED]);
    assert.deepEqual(types(at(9.49, { ourLandedPrice: 9.99 }), at(9.49)), []);
  });

  it('fires Below once, not again while it stays below', () => {
    assert.deepEqual(types(at(6.04), at(5.8)), [MOVED]);
    assert.deepEqual(types(at(6.04), at(6.04)), []);
  });

  it('fires Below when Amazon sets a competitive price under ours', () => {
    assert.deepEqual(types(at(null), at(6.04)), [BELOW, MOVED]);
  });

  it('fires Increased on every rise, back to our price or not', () => {
    assert.deepEqual(types(at(5), at(6)), [MOVED, UP]);
    assert.deepEqual(types(at(6.04), at(9.99)), [MOVED, UP]);
    assert.deepEqual(types(at(12), at(13)), [MOVED, UP]);
  });

  it('logs a drop above ours as Changed only', () => {
    assert.deepEqual(types(at(13), at(12)), [MOVED]);
  });

  it('ignores a move under a cent', () => {
    assert.deepEqual(types(at(6.04), at(6.042)), []);
  });

  it('logs Amazon setting or removing one as Changed, never Increased', () => {
    assert.deepEqual(types(at(null), at(12)), [MOVED]);
    assert.deepEqual(types(at(6.04), at(null)), [MOVED]);
    assert.deepEqual(types(at(null), at(null)), []);
  });

  it('without our offer: no Below, but Increased and Changed still work', () => {
    const noOffer = (t: number) => at(t, { ourLandedPrice: null });
    assert.deepEqual(types(noOffer(10), noOffer(6)), [MOVED]);
    assert.deepEqual(types(noOffer(6), noOffer(7)), [MOVED, UP]);
  });

  it('fires Below when our offer comes back under a lower competitive price', () => {
    assert.deepEqual(types(at(6.04, { ourLandedPrice: null }), at(6.04)), [BELOW]);
  });

  it('carries the competitive price before and now', () => {
    const [below, moved] = detectAlerts(at(10), at(6.04), US);
    assert.deepEqual(
      [below?.alertType, below?.previousValue, below?.newValue, below?.category],
      [BELOW, '10', '6.04', null],
    );
    assert.deepEqual([moved?.previousValue, moved?.newValue], ['10', '6.04']);
  });

  describe('the first check after the release (row saved before it)', () => {
    const old = s({ competitiveRecorded: false });

    it('lists a listing already below ours, with no earlier price', () => {
      const alerts = detectAlerts(old, at(6.04), US);
      assert.deepEqual(
        alerts.map((a) => [a.alertType, a.previousValue, a.newValue]),
        [[BELOW, null, '6.04']],
      );
    });

    it('logs nothing for one at or above ours, or with none', () => {
      assert.deepEqual(types(old, at(12)), []);
      assert.deepEqual(types(old, at(9.49)), []);
      assert.deepEqual(types(old, at(null)), []);
      assert.deepEqual(types(old, at(6.04, { ourLandedPrice: null })), []);
    });

    it('still logs the other changes', () => {
      assert.deepEqual(types(old, at(6.04, { title: 'New' })), [BELOW, 'TitleChanged']);
    });
  });
});
