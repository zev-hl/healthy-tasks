import type { DetectedAlert } from './alert-detection.js';
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

function describeBullets(category: string | null): string {
  if (!category) return 'Bullet points changed.';
  const nums = category.split(',').map((c) => c.replace('bullet_', '')).filter(Boolean);
  return nums.length === 1 ? `Bullet ${nums[0]} rewritten.` : `Bullets ${nums.join(', ')} rewritten.`;
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
        prev.listedPrice && current.listedPrice ? ` (${pricePct(prev.listedPrice, current.listedPrice)})` : ''
      }.`;
    case 'NumberOfSellersChanged':
      return `Offer count went from ${prev.offerCount} to ${current.offerCount}.`;
    case 'ListingSuppressed':
      return current.suppressionReason ? `Listing suppressed — ${current.suppressionReason}` : 'Listing suppressed.';
    case 'CategoryChanged':
      return `Category changed from ${quote(prev.category)} to ${quote(current.category)}.`;
    case 'BrandChanged':
      return `Brand changed from ${quote(prev.brand)} to ${quote(current.brand)}.`;
    case 'DimensionsChanged':
      return `Dimensions changed from ${quote(prev.dimensions)} to ${quote(current.dimensions)}.`;
    case 'TitleChanged':
      return 'Title changed.';
    case 'MainImageChanged':
      return 'Main image replaced.';
    case 'DescriptionChanged':
      return 'Description changed.';
    case 'BulletPointsChanged':
      return describeBullets(alert.category);
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
