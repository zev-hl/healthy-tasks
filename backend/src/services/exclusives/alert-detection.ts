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

// HLAI-124: money compares to the half cent, as in snapshot-diff.ts.
const differ = (a: number, b: number): boolean => Math.abs(a - b) >= 0.005;
const under = (a: number, b: number): boolean => b - a >= 0.005;

/**
 * HLAI-124: Amazon's competitive price for the client's rules, where a missing
 * one (Amazon gave none, or took it away) counts as -1.
 */
export const competitiveOrMinusOne = (v: Pick<SnapshotView, 'competitivePrice'>): number =>
  v.competitivePrice ?? -1;

/**
 * HLAI-124: whether a check can compare the two prices: our price + shipping is
 * known and not equal to Amazon's competitive price. Otherwise the check is
 * skipped and the saved pair kept (the client's rule for equal prices; the same
 * for our offer missing), so a saved, recorded pair is never equal.
 */
export const comparablePrices = (
  v: Pick<SnapshotView, 'competitivePrice' | 'ourLandedPrice'>,
): boolean => v.ourLandedPrice != null && differ(v.ourLandedPrice, competitiveOrMinusOne(v));

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
    alerts.push({
      alertType: 'ListingSuppressed',
      category: null,
      previousValue: 'false',
      newValue: 'true',
    });
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
  } else if (
    heldBefore &&
    !heldNow &&
    current.buyboxPrice != null &&
    current.buyboxWinnerSellerId != null
  ) {
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

  // Every change of a cent or more is an alert — the client asked for no
  // minimum (HLAI-71 §8 #12). Sub-cent float noise is already filtered out by
  // `moneyEq` in snapshot-diff.ts, so anything reaching here is a real move.
  if (changed.has('listedPrice') && prev.listedPrice != null && current.listedPrice != null) {
    alerts.push({
      alertType: 'PriceChanged',
      category: null,
      previousValue: str(prev.listedPrice),
      newValue: str(current.listedPrice),
    });
  }

  for (const [field, alertType] of Object.entries(CONTENT_ALERTS)) {
    const c = changed.get(field);
    if (c)
      alerts.push({
        alertType,
        category: null,
        previousValue: str(c.previous),
        newValue: str(c.current),
      });
  }

  if (changed.has('bulletPoints')) {
    const idx = changedBulletIndices(prev.bulletPoints, current.bulletPoints);
    // The WORDING, not a count. Snapshots are one row per listing and are
    // overwritten each sweep, so this is the only moment the old text still
    // exists — a count can be recomputed later, the words cannot.
    //
    // Only the bullets that actually moved: a listing where four of five
    // changed would otherwise carry ten versions, and the difference would be
    // harder to find rather than easier.
    const numbered = (list: string[]) =>
      idx.map((i) => `${i + 1}. ${list[i] ?? '(none)'}`).join('\n') || null;
    alerts.push({
      alertType: 'BulletPointsChanged',
      category: idx.map((i) => `bullet_${i + 1}`).join(',') || null,
      previousValue: numbered(prev.bulletPoints),
      newValue: numbered(current.bulletPoints),
    });
  }

  // Competitive price (HLAI-124): the client's five rules (28 Oct), as written.
  // HL = our price + shipping, CP = Amazon's competitive price (-1 when missing).
  // Nothing fires until a comparable pair is recorded (a row saved before the
  // release starts quietly), nor on a check that can't compare (our offer
  // missing, or the two equal): that check's pair is not saved, so the next one
  // compares with the last pair that could.
  if (!prev.competitiveRecorded || prev.ourLandedPrice == null || !comparablePrices(current)) {
    return alerts;
  }
  const hlPrev = prev.ourLandedPrice;
  const hlCurr = current.ourLandedPrice as number;
  const cpPrev = competitiveOrMinusOne(prev);
  const cpCurr = competitiveOrMinusOne(current);
  const wasUnder = under(hlPrev, cpPrev); // HL Prev < CP Prev
  const wasOver = under(cpPrev, hlPrev); // HL Prev > CP Prev
  const isUnder = under(hlCurr, cpCurr);
  const isOver = under(cpCurr, hlCurr);
  const cpMoved = differ(cpPrev, cpCurr);
  const hlMoved = differ(hlPrev, hlCurr);
  // CB, CA, CH carry the competitive price before and now; HA, HB ours.
  const push = (alertType: ExclusivesAlertType, previous: number | null, now: number | null) =>
    alerts.push({ alertType, category: null, previousValue: str(previous), newValue: str(now) });
  const cp = (alertType: ExclusivesAlertType) =>
    push(alertType, prev.competitivePrice, current.competitivePrice);
  const hl = (alertType: ExclusivesAlertType) => push(alertType, hlPrev, hlCurr);

  if (wasUnder && isOver && cpMoved) cp('CompetitivePriceBelowOurs');
  if (wasOver && isUnder && cpMoved) cp('CompetitivePriceAboveOurs');
  if (cpMoved && ((wasUnder && isUnder) || (wasOver && isOver))) cp('CompetitivePriceChanged');
  if (wasUnder && isOver && hlMoved) hl('OurPriceAboveCompetitive');
  if (wasOver && isUnder && hlMoved) hl('OurPriceBelowCompetitive');

  return alerts;
}
