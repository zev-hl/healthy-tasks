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
