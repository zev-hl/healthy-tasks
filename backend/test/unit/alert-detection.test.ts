import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { comparablePrices, detectAlerts } from '../../src/services/exclusives/alert-detection.js';
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

describe("detectAlerts — competitive price (HLAI-124, the client's rules of 28 Oct)", () => {
  // P = our price + shipping ("HL price"), T = Amazon's competitive price.
  const at = (p: number | null, t: number | null, o: Partial<SnapshotView> = {}) =>
    s({ ourLandedPrice: p, competitivePrice: t, ...o });
  type Pair = [number | null, number | null];
  /** One check: P before → now, T before → now. */
  const check = (p: Pair, t: Pair) => types(at(p[0], t[0]), at(p[1], t[1]));
  const BELOW = 'CompetitivePriceBelowOurs';
  const ABOVE = 'CompetitivePriceAboveOurs';
  const CHANGE = 'CompetitivePriceChanged';
  const HL_ABOVE = 'OurPriceAboveCompetitive';
  const HL_BELOW = 'OurPriceBelowCompetitive';

  it("matches the client's chart, row for row", () => {
    const chart: [Pair, Pair, string[]][] = [
      [[10, 10], [11, 9], [BELOW]],
      [[10, 10], [9, 11], [ABOVE]],
      [[10, 10], [11, 12], [CHANGE]],
      [[10, 10], [12, 11], [CHANGE]],
      [[10, 10], [8, 9], [CHANGE]],
      [[10, 10], [9, 8], [CHANGE]],
      [[10, 12], [11, 11], [HL_ABOVE]],
      [[12, 10], [11, 11], [HL_BELOW]],
      [
        [10, 12],
        [11, 9],
        [BELOW, HL_ABOVE],
      ],
      [
        [9, 12],
        [10, 9],
        [BELOW, HL_ABOVE],
      ],
      [[9, 10], [10, 11], [CHANGE]],
    ];
    for (const [p, t, expected] of chart) {
      assert.deepEqual(check(p, t), [...expected].sort(), `P ${p.join(' → ')}, T ${t.join(' → ')}`);
    }
  });

  it('fires both of ours when both prices cross the other way', () => {
    assert.deepEqual(check([11, 9], [10, 10.5]), [ABOVE, HL_BELOW].sort());
  });

  it('fires nothing when our price moves without crossing, or nothing moves', () => {
    assert.deepEqual(check([9, 9.5], [10, 10]), []);
    assert.deepEqual(check([11, 11], [10, 10]), []);
  });

  it('ignores a move under half a cent', () => {
    assert.deepEqual(check([10, 10], [11, 11.004]), []);
    assert.deepEqual(check([10, 10.004], [11, 11]), []);
  });

  describe('equal prices (the check is skipped; the saved pair is kept)', () => {
    it('fires nothing when the two are equal now', () => {
      assert.deepEqual(check([10, 10], [11, 10]), []);
      assert.deepEqual(check([10, 11], [11, 11]), []);
      assert.deepEqual(check([10, 10], [11, 10.004]), [], 'equal to the half cent');
    });

    it('then compares with the last unequal pair, so a crossing through equal is caught', () => {
      // The saved pair stayed 10 / 11 (snapshot.repository keeps it).
      assert.deepEqual(check([10, 10], [11, 9]), [BELOW]);
      assert.deepEqual(check([10, 10], [11, 12]), [CHANGE]);
      assert.deepEqual(check([10, 12], [11, 11]), [HL_ABOVE]);
    });

    it('can compare only with our price known and different from theirs', () => {
      assert.equal(comparablePrices(at(10, 9)), true);
      assert.equal(comparablePrices(at(10, null)), true, 'a missing T is -1');
      assert.equal(comparablePrices(at(10, 10)), false);
      assert.equal(comparablePrices(at(10, 10.004)), false);
      assert.equal(comparablePrices(at(null, 9)), false);
    });
  });

  describe('a missing competitive price counts as -1', () => {
    it('removed while above ours: Below (red); while below ours: Change', () => {
      assert.deepEqual(check([10, 10], [11, null]), [BELOW]);
      assert.deepEqual(check([10, 10], [9, null]), [CHANGE]);
    });

    it('back above ours: Above; back below ours: Change', () => {
      assert.deepEqual(check([10, 10], [null, 11]), [ABOVE]);
      assert.deepEqual(check([10, 10], [null, 9]), [CHANGE]);
    });

    it('never had one: nothing, whatever our price does', () => {
      assert.deepEqual(check([10, 12], [null, null]), []);
      assert.deepEqual(check([12, 10], [null, null]), []);
    });

    it('removed while our price rises over it: both', () => {
      assert.deepEqual(check([10, 12], [11, null]), [BELOW, HL_ABOVE].sort());
    });
  });

  it('fires nothing with our price missing now (skipped, like equal prices)', () => {
    assert.deepEqual(check([10, null], [9, 11]), []);
    assert.deepEqual(check([null, 10], [9, 11]), [], 'nor without a saved price of ours');
  });

  it('carries the competitive price before and now, or ours for HL Price alerts', () => {
    const values = (p: Pair, t: Pair) =>
      detectAlerts(at(p[0], t[0]), at(p[1], t[1]), US).map((a) => [
        a.alertType,
        a.previousValue,
        a.newValue,
        a.category,
      ]);
    assert.deepEqual(values([10, 12], [11, 9]), [
      [BELOW, '11', '9', null],
      [HL_ABOVE, '10', '12', null],
    ]);
    assert.deepEqual(values([10, 10], [11, null]), [[BELOW, '11', null, null]]);
    assert.deepEqual(values([10, 10], [null, 11]), [[ABOVE, null, '11', null]]);
  });

  describe('the first check after the release (row saved before it)', () => {
    const old = s({ competitiveRecorded: false });

    it('fires none of the five: it starts quietly', () => {
      assert.deepEqual(types(old, at(10, 9)), []);
      assert.deepEqual(types(old, at(10, 11)), []);
      assert.deepEqual(types(old, at(10, null)), []);
    });

    it('still logs the other changes', () => {
      assert.deepEqual(types(old, at(10, 9, { title: 'New' })), ['TitleChanged']);
    });
  });
});
