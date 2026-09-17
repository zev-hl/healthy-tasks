import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gateAlerts, isAlertOn, type AlertSettingsMap } from '../../src/services/exclusives/alert-gating.js';
import type { ExclusivesAlertType } from '@healthy-tasks/shared';

const a = (alertType: ExclusivesAlertType) => ({ alertType });

describe('isAlertOn', () => {
  it('treats daily and immediate as on; off/missing as off', () => {
    assert.equal(isAlertOn('daily'), true);
    assert.equal(isAlertOn('immediate'), true);
    assert.equal(isAlertOn('off'), false);
    assert.equal(isAlertOn(undefined), false);
  });
});

describe('gateAlerts', () => {
  it('keeps only alert types switched on for the group', () => {
    const settings: AlertSettingsMap = {
      PriceChanged: 'immediate',
      BuyBoxLost: 'daily',
      TitleChanged: 'off',
    };
    const kept = gateAlerts(
      [a('PriceChanged'), a('BuyBoxLost'), a('TitleChanged'), a('BrandChanged')],
      settings,
    ).map((x) => x.alertType);
    assert.deepEqual(kept.sort(), ['BuyBoxLost', 'PriceChanged']);
  });

  it('drops everything when the group has no settings', () => {
    assert.deepEqual(gateAlerts([a('PriceChanged'), a('BuyBoxWon')], {}), []);
  });
});
