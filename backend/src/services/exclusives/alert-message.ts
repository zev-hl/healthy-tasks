import { isBelowOurs, type DetectedAlert } from './alert-detection.js';
import type { SnapshotView } from './snapshot-diff.js';

export interface MessageContext {
  /** Our store's display name, e.g. "Health Life". */
  storeName: string;
}

export interface AlertWithMessage extends DetectedAlert {
  message: string;
}

const money = (n: number | null): string => (n == null ? 'n/a' : `$${n.toFixed(2)}`);
const quote = (s: string | null): string => `"${s ?? '—'}"`;

function pricePct(prev: number, current: number): string {
  const pct = ((current - prev) / prev) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// Our price + shipping beside a competitive price, when Amazon showed our offer.
const weAreAt = (v: SnapshotView): string =>
  v.ourLandedPrice == null ? '' : ` (we are at ${money(v.ourLandedPrice)})`;

// HLAI-124: Amazon's competitive price against ours.
function describeCompetitive(
  alert: DetectedAlert,
  prev: SnapshotView,
  current: SnapshotView,
): string {
  const before = money(prev.competitivePrice);
  const now = money(current.competitivePrice);
  switch (alert.alertType) {
    case 'CompetitivePriceBelowOurs':
      return (
        `Amazon's competitive price is ${now}, below our ${money(current.ourLandedPrice)} ` +
        '(price + shipping): the Buy Box is at risk.'
      );
    case 'CompetitivePriceIncreased': {
      const backUp =
        isBelowOurs(prev) && current.ourLandedPrice != null && !isBelowOurs(current)
          ? ', now at or above our price'
          : '';
      return `Amazon's competitive price rose from ${before} to ${now}${weAreAt(current)}${backUp}.`;
    }
    default:
      if (prev.competitivePrice == null) {
        return `Amazon set a competitive price of ${now}${weAreAt(current)}.`;
      }
      if (current.competitivePrice == null) {
        return `Amazon removed its competitive price (was ${before}).`;
      }
      return `Amazon's competitive price changed from ${before} to ${now}${weAreAt(current)}.`;
  }
}

/**
 * What the changed bullets used to say, and what they say now.
 *
 * Named rather than merely counted: "Bullet 2 rewritten" tells a reader which
 * one moved but nothing about what moved, and by the time anyone reads the
 * alert the old wording no longer exists anywhere to look it up.
 *
 * Only the bullets that changed appear. The numbers come from the alert's own
 * category, which the detector filled in from the same comparison.
 */
function describeBullets(
  category: string | null,
  prev: SnapshotView,
  current: SnapshotView,
): string {
  if (!category) return 'Bullet points changed.';
  const nums = category
    .split(',')
    .map((c) => Number(c.replace('bullet_', '')))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length === 0) return 'Bullet points changed.';

  return nums
    .map((n) => {
      const before = prev.bulletPoints[n - 1] ?? null;
      const after = current.bulletPoints[n - 1] ?? null;
      // A bullet that was added has no "before", and one that was removed has
      // no "after" — say which happened rather than quoting an em dash.
      if (before == null) return `Bullet ${n} added: ${quote(after)}.`;
      if (after == null) return `Bullet ${n} removed (was ${quote(before)}).`;
      return `Bullet ${n} changed from ${quote(before)} to ${quote(after)}.`;
    })
    .join(' ');
}

// Short human line for one detected alert. Pure — no I/O.
export function describeAlert(
  alert: DetectedAlert,
  prev: SnapshotView,
  current: SnapshotView,
  ctx: MessageContext,
): string {
  switch (alert.alertType) {
    case 'BuyBoxWon':
      return `Buy Box won — now held by ${ctx.storeName} at ${money(current.buyboxPrice)}.`;
    case 'BuyBoxLost':
      return `Buy Box lost to a competitor at ${money(current.buyboxPrice)} (we were at ${money(prev.buyboxPrice)}).`;
    case 'PriceChanged':
      return `List price changed from ${money(prev.listedPrice)} to ${money(current.listedPrice)}${
        prev.listedPrice && current.listedPrice
          ? ` (${pricePct(prev.listedPrice, current.listedPrice)})`
          : ''
      }.`;
    case 'NumberOfSellersChanged':
      return `Offer count went from ${prev.offerCount} to ${current.offerCount}.`;
    case 'ListingSuppressed':
      return current.suppressionReason
        ? `Listing suppressed — ${current.suppressionReason}`
        : 'Listing suppressed.';
    case 'CategoryChanged':
      return `Category changed from ${quote(prev.category)} to ${quote(current.category)}.`;
    case 'BrandChanged':
      return `Brand changed from ${quote(prev.brand)} to ${quote(current.brand)}.`;
    case 'DimensionsChanged':
      return `Dimensions changed from ${quote(prev.dimensions)} to ${quote(current.dimensions)}.`;
    case 'TitleChanged':
      // Reads like the other change messages, and is the ONLY place the two
      // titles appear now that the Alert Type column shows just the badge.
      return `Title changed from ${quote(prev.title)} to ${quote(current.title)}.`;
    case 'MainImageChanged':
      // Named rather than just announced, so the two can be compared or
      // opened. Reads like the other change messages — brand, category,
      // dimensions all use the same "from X to Y" shape.
      return `Main image changed from ${quote(prev.mainImageUrl)} to ${quote(
        current.mainImageUrl,
      )}.`;
    case 'DescriptionChanged':
      return 'Description changed.';
    case 'BulletPointsChanged':
      return describeBullets(alert.category, prev, current);
    case 'CompetitivePriceBelowOurs':
    case 'CompetitivePriceIncreased':
    case 'CompetitivePriceChanged':
      return describeCompetitive(alert, prev, current);
    default:
      return 'Changed.';
  }
}

export function describeAlerts(
  alerts: DetectedAlert[],
  prev: SnapshotView,
  current: SnapshotView,
  ctx: MessageContext,
): AlertWithMessage[] {
  return alerts.map((a) => ({ ...a, message: describeAlert(a, prev, current, ctx) }));
}
