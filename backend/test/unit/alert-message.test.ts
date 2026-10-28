import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeAlert } from '../../src/services/exclusives/alert-message.js';
import type { DetectedAlert } from '../../src/services/exclusives/alert-detection.js';
import type { SnapshotView } from '../../src/services/exclusives/snapshot-diff.js';

const base: SnapshotView = {
  title: 'Widget',
  mainImageUrl: 'http://img/a.jpg',
  category: 'Vitamins',
  brand: 'Acme',
  bulletPoints: ['one', 'two', 'three'],
  description: 'A widget.',
  dimensions: '3in',
  listedPrice: 34.99,
  currency: 'USD',
  buyboxWinnerSellerId: 'A1UWLDVGZSXGKG',
  buyboxPrice: 34.99,
  offerCount: 3,
  competitivePrice: null,
  ourLandedPrice: null,
  competitiveRecorded: true,
  isSuppressed: false,
  suppressionReason: null,
};
const s = (o: Partial<SnapshotView>): SnapshotView => ({ ...base, ...o });
const ctx = { storeName: 'Health Life' };
const msg = (a: DetectedAlert, prev: SnapshotView, cur: SnapshotView) =>
  describeAlert(a, prev, cur, ctx);

const alert = (o: Partial<DetectedAlert> & Pick<DetectedAlert, 'alertType'>): DetectedAlert => ({
  category: null,
  previousValue: null,
  newValue: null,
  ...o,
});

describe('describeAlert', () => {
  it('Buy Box won names our store and the price', () => {
    assert.equal(
      msg(alert({ alertType: 'BuyBoxWon' }), s({ buyboxWinnerSellerId: 'X' }), base),
      'Buy Box won — now held by Health Life at $34.99.',
    );
  });

  it('Buy Box lost shows both prices', () => {
    const cur = s({ buyboxPrice: 31.49, buyboxWinnerSellerId: 'X' });
    assert.equal(
      msg(alert({ alertType: 'BuyBoxLost' }), base, cur),
      'Buy Box lost to a competitor at $31.49 (we were at $34.99).',
    );
  });

  it('Price changed includes the percentage', () => {
    assert.equal(
      msg(alert({ alertType: 'PriceChanged' }), base, s({ listedPrice: 31.49 })),
      'List price changed from $34.99 to $31.49 (-10.0%).',
    );
  });

  it('Offer count reads naturally', () => {
    assert.equal(
      msg(alert({ alertType: 'NumberOfSellersChanged' }), base, s({ offerCount: 6 })),
      'Offer count went from 3 to 6.',
    );
  });

  it('Listing suppressed uses the reason when present', () => {
    assert.equal(msg(alert({ alertType: 'ListingSuppressed' }), base, base), 'Listing suppressed.');
    assert.equal(
      msg(
        alert({ alertType: 'ListingSuppressed' }),
        base,
        s({ suppressionReason: 'Image missing' }),
      ),
      'Listing suppressed — Image missing',
    );
  });

  it('Category/Brand/Dimensions show from → to', () => {
    assert.equal(
      msg(alert({ alertType: 'CategoryChanged' }), base, s({ category: 'Sports Nutrition' })),
      'Category changed from "Vitamins" to "Sports Nutrition".',
    );
    assert.equal(
      msg(alert({ alertType: 'BrandChanged' }), base, s({ brand: 'Acme Pro' })),
      'Brand changed from "Acme" to "Acme Pro".',
    );
  });

  it('Title names both titles; Image and Description stay short fixed lines', () => {
    assert.equal(
      msg(alert({ alertType: 'TitleChanged' }), base, s({ title: 'Widget Pro' })),
      'Title changed from "Widget" to "Widget Pro".',
    );
    assert.equal(
      msg(alert({ alertType: 'MainImageChanged' }), base, s({ mainImageUrl: 'http://img/b.jpg' })),
      'Main image changed from "http://img/a.jpg" to "http://img/b.jpg".',
    );
    assert.equal(
      msg(alert({ alertType: 'DescriptionChanged' }), base, base),
      'Description changed.',
    );
  });

  it('Bullets quote what changed, not just which number', () => {
    const after = s({ bulletPoints: ['one', 'TWO', 'three'] });
    assert.equal(
      msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_2' }), base, after),
      'Bullet 2 changed from "two" to "TWO".',
    );
  });

  it('Bullets name every one that changed, in one line', () => {
    const after = s({ bulletPoints: ['one', 'TWO', 'THREE'] });
    assert.equal(
      msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_2,bullet_3' }), base, after),
      'Bullet 2 changed from "two" to "TWO". Bullet 3 changed from "three" to "THREE".',
    );
  });

  it('Bullets say whether one was added or removed, rather than quoting nothing', () => {
    const added = s({ bulletPoints: ['one', 'two', 'three', 'four'] });
    assert.equal(
      msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_4' }), base, added),
      'Bullet 4 added: "four".',
    );

    const removed = s({ bulletPoints: ['one', 'two'] });
    assert.equal(
      msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_3' }), base, removed),
      'Bullet 3 removed (was "three").',
    );
  });
});

describe("describeAlert — competitive price (HLAI-124, the client's rules of 28 Oct)", () => {
  // P = our price + shipping ("HL price"), T = Amazon's competitive price.
  const at = (p: number | null, t: number | null) => s({ ourLandedPrice: p, competitivePrice: t });
  const of = (alertType: DetectedAlert['alertType']) => alert({ alertType });

  it('Competitive Price Below HL Price: both prices and the risk, or that Amazon removed it', () => {
    assert.equal(
      msg(of('CompetitivePriceBelowOurs'), at(10, 11), at(10, 9)),
      "Amazon's competitive price went from $11.00 to $9.00, now below our HL price of $10.00 " +
        '(price + shipping): the Buy Box is at risk.',
    );
    assert.equal(
      msg(of('CompetitivePriceBelowOurs'), at(10, 11), at(10, null)),
      'Amazon removed its competitive price (was $11.00, above our HL price of $10.00).',
    );
  });

  it('Competitive Price Above HL Price: a rise over ours, or Amazon setting one', () => {
    assert.equal(
      msg(of('CompetitivePriceAboveOurs'), at(10, 9), at(10, 11)),
      "Amazon's competitive price went from $9.00 to $11.00, now above our HL price of $10.00.",
    );
    assert.equal(
      msg(of('CompetitivePriceAboveOurs'), at(10, null), at(10, 11)),
      'Amazon set a competitive price of $11.00, above our HL price of $10.00.',
    );
  });

  it('Competitive Price Change: a move, a new one and a removed one', () => {
    assert.equal(
      msg(of('CompetitivePriceChanged'), at(10, 12), at(10, 11)),
      "Amazon's competitive price changed from $12.00 to $11.00 (our HL price: $10.00).",
    );
    assert.equal(
      msg(of('CompetitivePriceChanged'), at(10, null), at(10, 9)),
      'Amazon set a competitive price of $9.00 (our HL price: $10.00).',
    );
    assert.equal(
      msg(of('CompetitivePriceChanged'), at(10, 9), at(10, null)),
      'Amazon removed its competitive price (was $9.00; our HL price: $10.00).',
    );
  });

  it('HL Price Above Competitive Price: our move and the risk', () => {
    assert.equal(
      msg(of('OurPriceAboveCompetitive'), at(10, 11), at(12, 11)),
      'Our HL price (price + shipping) went from $10.00 to $12.00, now above ' +
        "Amazon's competitive price of $11.00: the Buy Box is at risk.",
    );
    assert.equal(
      msg(of('OurPriceAboveCompetitive'), at(10, 11), at(12, null)),
      'Our HL price (price + shipping) went from $10.00 to $12.00, and Amazon removed ' +
        'its competitive price (was $11.00).',
    );
  });

  it('HL Price Below Competitive Price: our move', () => {
    assert.equal(
      msg(of('OurPriceBelowCompetitive'), at(12, 11), at(10, 11)),
      'Our HL price (price + shipping) went from $12.00 to $10.00, now below ' +
        "Amazon's competitive price of $11.00.",
    );
  });

  it('never shows the -1 that stands for a missing competitive price', () => {
    const cases: [DetectedAlert['alertType'], number | null, number | null][] = [
      ['CompetitivePriceBelowOurs', 11, null],
      ['CompetitivePriceAboveOurs', null, 11],
      ['CompetitivePriceChanged', null, 9],
      ['CompetitivePriceChanged', 9, null],
      ['OurPriceAboveCompetitive', 11, null],
    ];
    for (const [type, before, now] of cases) {
      const text = msg(of(type), at(10, before), at(12, now));
      assert.doesNotMatch(text, /-1|n\/a/, `${type}: ${text}`);
    }
  });
});
