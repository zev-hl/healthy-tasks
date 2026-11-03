import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_CODES,
  alertGroupLabelPart,
  alertTaskInstanceLabel,
  julianStamp,
  withClashCounter,
} from '@healthy-tasks/shared';

/**
 * HLAI-112: the instance label of tasks made from alerts,
 * `<group part>_<type code>_<YYJJJHHMM>` on the New York clock.
 */

const NY = 'America/New_York';

describe('alert type codes', () => {
  it('are the agreed two letters, one per alert type, all different', () => {
    assert.deepEqual(EXCLUSIVES_ALERT_TYPE_CODES, {
      ListingSuppressed: 'LS',
      BuyBoxLost: 'BL',
      BuyBoxWon: 'BW',
      NumberOfSellersChanged: 'SC',
      PriceChanged: 'PC',
      CategoryChanged: 'CC',
      BrandChanged: 'BC',
      TitleChanged: 'TC',
      MainImageChanged: 'IC',
      DescriptionChanged: 'DC',
      BulletPointsChanged: 'BP',
      DimensionsChanged: 'DM',
      CompetitivePriceBelowOurs: 'CB',
      CompetitivePriceAboveOurs: 'CA',
      CompetitivePriceChanged: 'CH',
      OurPriceAboveCompetitive: 'HA',
      OurPriceBelowCompetitive: 'HB',
    });
    const codes = EXCLUSIVES_ALERT_TYPES.map((t) => EXCLUSIVES_ALERT_TYPE_CODES[t]);
    assert.equal(new Set(codes).size, EXCLUSIVES_ALERT_TYPES.length);
  });
});

describe('the group part', () => {
  it('takes the first 4 letters, then the first letter after each "-"', () => {
    assert.equal(alertGroupLabelPart('Wasif - US'), 'WasiU');
    assert.equal(alertGroupLabelPart('Wasif - CA'), 'WasiC');
    assert.equal(alertGroupLabelPart('Wasif - US - East'), 'WasiUE');
    assert.equal(alertGroupLabelPart('Wasif-US-East'), 'WasiUE');
  });

  it('takes what there is from a short name, and works with no "-" at all', () => {
    assert.equal(alertGroupLabelPart('Abc - US'), 'AbcU');
    assert.equal(alertGroupLabelPart('Versure'), 'Vers');
    assert.equal(alertGroupLabelPart('Versure Exclusives'), 'Vers');
  });

  it('skips spaces and marks, and keeps the letters’ case', () => {
    assert.equal(alertGroupLabelPart('  Hl Co - us'), 'HlCou');
    assert.equal(alertGroupLabelPart("Bob's Shop - (US)"), 'BobsU');
    assert.equal(alertGroupLabelPart('4Life - US'), '4LifU');
    assert.equal(alertGroupLabelPart('Café - FR'), 'CaféF');
  });

  it('treats an en or em dash as a "-", and ignores empty parts', () => {
    assert.equal(alertGroupLabelPart('Wasif – US — East'), 'WasiUE');
    assert.equal(alertGroupLabelPart('Wasif - - US -'), 'WasiU');
  });

  it('falls back to "Group" for a name with no letters', () => {
    assert.equal(alertGroupLabelPart(' - - '), 'Group');
  });
});

describe('the Julian date (YYJJJHHMM, New York clock)', () => {
  it('matches the agreed example', () => {
    // 19 Oct 2026, 08:30 in New York (EDT) is 12:30 UTC; 19 Oct is day 292.
    assert.equal(julianStamp(new Date('2026-10-19T12:30:00Z'), NY), '262920830');
  });

  it('pads the day and time, and writes midnight as 00', () => {
    assert.equal(julianStamp(new Date('2026-01-01T05:05:00Z'), NY), '260010005');
    assert.equal(julianStamp(new Date('2026-10-20T04:00:00Z'), NY), '262930000');
  });

  it('uses New York’s date, not UTC’s, around midnight and New Year', () => {
    // 04:30 UTC on 1 Jan 2027 is still 23:30 on 31 Dec 2026 in New York.
    assert.equal(julianStamp(new Date('2027-01-01T04:30:00Z'), NY), '263652330');
  });

  it('reaches day 366 in a leap year', () => {
    assert.equal(julianStamp(new Date('2029-01-01T04:59:00Z'), NY), '283662359');
  });

  it('follows the clock change in March and November', () => {
    // 8 Mar 2026: 01:59 EST, then the clocks jump to 03:00 EDT.
    assert.equal(julianStamp(new Date('2026-03-08T06:59:00Z'), NY), '260670159');
    assert.equal(julianStamp(new Date('2026-03-08T07:00:00Z'), NY), '260670300');
    // 1 Nov 2026: 01:30 comes twice (EDT, then EST) — the clash counter's case.
    assert.equal(julianStamp(new Date('2026-11-01T05:30:00Z'), NY), '263050130');
    assert.equal(julianStamp(new Date('2026-11-01T06:30:00Z'), NY), '263050130');
  });
});

describe('the whole label', () => {
  it('joins the three parts with "_"', () => {
    const at = new Date('2026-10-19T12:30:00Z');
    assert.equal(alertTaskInstanceLabel('Wasif - US', 'BuyBoxWon', at, NY), 'WasiU_BW_262920830');
    assert.equal(
      alertTaskInstanceLabel('Wasif - US', 'PriceChanged', at, NY),
      'WasiU_PC_262920830',
    );
    assert.equal(
      alertTaskInstanceLabel('Versure Exclusives', 'NumberOfSellersChanged', at, NY),
      'Vers_SC_262920830',
    );
  });

  it('adds a counter when the label is already taken', () => {
    const label = 'WasiU_PC_262920830';
    assert.equal(withClashCounter(label, new Set()), label);
    assert.equal(withClashCounter(label, new Set([label])), `${label}_2`);
    assert.equal(withClashCounter(label, new Set([label, `${label}_2`])), `${label}_3`);
  });
});
