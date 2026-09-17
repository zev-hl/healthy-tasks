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
const msg = (a: DetectedAlert, prev: SnapshotView, cur: SnapshotView) => describeAlert(a, prev, cur, ctx);

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
      msg(alert({ alertType: 'ListingSuppressed' }), base, s({ suppressionReason: 'Image missing' })),
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

  it('Title/Image/Description use short fixed lines', () => {
    assert.equal(msg(alert({ alertType: 'TitleChanged' }), base, base), 'Title changed.');
    assert.equal(msg(alert({ alertType: 'MainImageChanged' }), base, base), 'Main image replaced.');
    assert.equal(msg(alert({ alertType: 'DescriptionChanged' }), base, base), 'Description changed.');
  });

  it('Bullets read from the category', () => {
    assert.equal(msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_2' }), base, base), 'Bullet 2 rewritten.');
    assert.equal(
      msg(alert({ alertType: 'BulletPointsChanged', category: 'bullet_2,bullet_4' }), base, base),
      'Bullets 2, 4 rewritten.',
    );
  });
});
