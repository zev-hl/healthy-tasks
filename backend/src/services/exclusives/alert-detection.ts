import type { ExclusivesAlertType } from '@healthy-tasks/shared';
import { changedBulletIndices, diffSnapshots, type SnapshotView } from './snapshot-diff.js';

export interface DetectedAlert {
  alertType: ExclusivesAlertType;
  category: string | null;
  previousValue: string | null;
  newValue: string | null;
}

// One field change → one alert type, for the straightforward content fields.
const CONTENT_ALERTS: Record<string, ExclusivesAlertType> = {
  category: 'CategoryChanged',
  brand: 'BrandChanged',
  title: 'TitleChanged',
  mainImageUrl: 'MainImageChanged',
  description: 'DescriptionChanged',
  dimensions: 'DimensionsChanged',
};

const str = (v: unknown): string | null => (v == null ? null : String(v));

// Amazon list prices wiggle by a cent between sweeps; without a floor the log
// fills with ±$0.01 "changes". A price move is only alert-worthy when it clears
// an absolute OR a relative floor — whichever it hits first, so both a $0.60 move
// on a cheap item and a 0.6% move on an expensive one register. NOTE: the saved
// snapshot still advances every sweep (see detection.service `sameStoredState`),
// so this is a per-sweep floor: a sub-floor move that repeats each sweep resets
// the baseline and won't accumulate into an alert.
const PRICE_ALERT_MIN_ABS = 0.5; // dollars
const PRICE_ALERT_MIN_PCT = 0.01; // 1% of the previous price

const priceMoveIsAlertWorthy = (prev: number, current: number): boolean => {
  const absDelta = Math.abs(current - prev);
  const pctDelta = prev === 0 ? Infinity : absDelta / Math.abs(prev);
  return absDelta >= PRICE_ALERT_MIN_ABS || pctDelta >= PRICE_ALERT_MIN_PCT;
};

// Map the raw diff (5a) to alert types. Buy Box Won/Lost is derived from the
// resolved winner + Buy Box price + our merchant token, across both snapshots
// (never IsBuyBoxWinner). A suppressed Buy Box (price gone) is NOT "Lost".
export function detectAlerts(
  prev: SnapshotView,
  current: SnapshotView,
  merchantToken: string,
): DetectedAlert[] {
  const changed = new Map(diffSnapshots(prev, current).map((c) => [c.field, c]));
  const alerts: DetectedAlert[] = [];

  if (changed.has('isSuppressed') && current.isSuppressed) {
    alerts.push({ alertType: 'ListingSuppressed', category: null, previousValue: 'false', newValue: 'true' });
  }

  const heldBefore = !!prev.buyboxWinnerSellerId && prev.buyboxWinnerSellerId === merchantToken;
  const heldNow = !!current.buyboxWinnerSellerId && current.buyboxWinnerSellerId === merchantToken;
  if (!heldBefore && heldNow) {
    alerts.push({
      alertType: 'BuyBoxWon',
      category: null,
      previousValue: prev.buyboxWinnerSellerId,
      newValue: current.buyboxWinnerSellerId,
    });
  } else if (heldBefore && !heldNow && current.buyboxPrice != null && current.buyboxWinnerSellerId != null) {
    // Lost to an identified competitor while a Buy Box still exists.
    alerts.push({
      alertType: 'BuyBoxLost',
      category: null,
      previousValue: prev.buyboxWinnerSellerId,
      newValue: current.buyboxWinnerSellerId,
    });
  }

  if (changed.has('offerCount') && prev.offerCount != null && current.offerCount != null) {
    alerts.push({
      alertType: 'NumberOfSellersChanged',
      category: null,
      previousValue: str(prev.offerCount),
      newValue: str(current.offerCount),
    });
  }

  if (
    changed.has('listedPrice') &&
    prev.listedPrice != null &&
    current.listedPrice != null &&
    priceMoveIsAlertWorthy(prev.listedPrice, current.listedPrice)
  ) {
    alerts.push({
      alertType: 'PriceChanged',
      category: null,
      previousValue: str(prev.listedPrice),
      newValue: str(current.listedPrice),
    });
  }

  for (const [field, alertType] of Object.entries(CONTENT_ALERTS)) {
    const c = changed.get(field);
    if (c) alerts.push({ alertType, category: null, previousValue: str(c.previous), newValue: str(c.current) });
  }

  if (changed.has('bulletPoints')) {
    const idx = changedBulletIndices(prev.bulletPoints, current.bulletPoints);
    alerts.push({
      alertType: 'BulletPointsChanged',
      category: idx.map((i) => `bullet_${i + 1}`).join(',') || null,
      previousValue: `${prev.bulletPoints.length} bullets`,
      newValue: `${current.bulletPoints.length} bullets`,
    });
  }

  return alerts;
}
