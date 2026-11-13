import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertCompare,
  alertLogMessage,
  describeAlert,
  describeTextChange,
} from '../../src/services/exclusives/alert-message.js';
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

  it('Title and Image name both versions', () => {
    assert.equal(
      msg(alert({ alertType: 'TitleChanged' }), base, s({ title: 'Widget Pro' })),
      'Title changed from "Widget" to "Widget Pro".',
    );
    assert.equal(
      msg(alert({ alertType: 'MainImageChanged' }), base, s({ mainImageUrl: 'http://img/b.jpg' })),
      'Main image changed from "http://img/a.jpg" to "http://img/b.jpg".',
    );
    assert.equal(
      msg(alert({ alertType: 'DescriptionChanged' }), base, s({ description: 'A gadget.' })),
      'Description changed from "A widget." to "A gadget.".',
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

describe('Description changed: where the text first differs', () => {
  const words = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => `w${i + from}`).join(' ');
  const LONG_TAIL =
    ' and then it keeps going on about the product for quite a while, much longer than a line or two would ever show in the alert log';

  it('starts three same words before the first difference, with "..." around it', () => {
    const before = `${words(10)} old bit${LONG_TAIL}${LONG_TAIL}`;
    const after = `${words(10)} new bit${LONG_TAIL}${LONG_TAIL}`;
    const m = describeTextChange('Description', before, after);
    assert.match(m, /^Description changed from "\.\.\.w8 w9 w10 old bit and then /);
    assert.match(m, /" to "\.\.\.w8 w9 w10 new bit and then /);
    // About a line or two of each, then "..." for the rest.
    assert.match(m, /\.\.\." to "/);
    assert.match(m, /\.\.\."\.$/);
    const [, fromQuote] = /from "(.*?)" to/.exec(m)!;
    assert.ok(fromQuote!.length <= 170, `a line or two, got ${fromQuote!.length}`);
  });

  it('a difference in the first words starts at the start, with no leading "..."', () => {
    assert.equal(
      describeTextChange('Description', 'Great tea for mornings.', 'Fine tea for mornings.'),
      'Description changed from "Great tea for mornings." to "Fine tea for mornings.".',
    );
    // Two same words: shows both, still no "..." before them.
    assert.equal(
      describeTextChange('Description', 'Great tea for mornings.', 'Great tea at night.'),
      'Description changed from "Great tea for mornings." to "Great tea at night.".',
    );
  });

  it('text added at the end shows the last words and what was added', () => {
    assert.equal(
      describeTextChange('Description', words(6), `${words(6)} plus more`),
      'Description changed from "...w4 w5 w6" to "...w4 w5 w6 plus more".',
    );
  });

  it('says added, removed, or only spacing/markup changed', () => {
    assert.equal(
      describeTextChange('Description', null, 'Brand new.'),
      'Description added: "Brand new.".',
    );
    assert.equal(
      describeTextChange('Description', 'Gone now.', ''),
      'Description removed (was "Gone now.").',
    );
    assert.equal(
      describeTextChange('Description', 'Same  words<br>here', 'Same words here'),
      'Description changed (spacing or formatting only).',
    );
  });

  it('rebuilds alerts logged with the old short message; leaves everything else', () => {
    const old = {
      alertType: 'DescriptionChanged',
      message: 'Description changed.',
      previousValue: 'A widget.',
      newValue: 'A gadget.',
    };
    assert.equal(alertLogMessage(old), 'Description changed from "A widget." to "A gadget.".');
    assert.equal(
      alertLogMessage({ ...old, previousValue: null, newValue: null }),
      'Description changed.',
    );
    assert.equal(
      alertLogMessage({ ...old, alertType: 'TitleChanged', message: 'Title changed.' }),
      'Title changed.',
    );
  });
});

describe('alertCompare: what the email puts side by side', () => {
  it('a description gives the excerpts around its first difference', () => {
    assert.deepEqual(
      alertCompare({
        alertType: 'DescriptionChanged',
        previousValue: 'w1 w2 w3 w4 w5 old end',
        newValue: 'w1 w2 w3 w4 w5 new end',
      }),
      { label: 'Description', before: '...w3 w4 w5 old end', after: '...w3 w4 w5 new end' },
    );
  });

  it('a title or bullets give the whole text; other alerts nothing', () => {
    assert.deepEqual(
      alertCompare({ alertType: 'TitleChanged', previousValue: 'Tea', newValue: 'Green Tea' }),
      { label: 'Title', before: 'Tea', after: 'Green Tea' },
    );
    assert.equal(
      alertCompare({ alertType: 'BulletPointsChanged', previousValue: '2. a', newValue: '2. b' })
        ?.label,
      'Bullet points',
    );
    assert.equal(
      alertCompare({ alertType: 'PriceChanged', previousValue: '1', newValue: '2' }),
      null,
    );
    assert.equal(
      alertCompare({ alertType: 'DescriptionChanged', previousValue: 'a  b', newValue: 'a b' }),
      null,
    );
  });
});
