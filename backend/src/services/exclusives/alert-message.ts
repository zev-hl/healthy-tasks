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

// HLAI-124: Amazon's competitive price against our price + shipping ("HL
// price"). The rules never fire with our price missing; Amazon's may be (removed,
// or set again), which the wording says rather than showing an amount.
function describeCompetitive(
  alert: DetectedAlert,
  prev: SnapshotView,
  current: SnapshotView,
): string {
  const cpBefore = money(prev.competitivePrice);
  const cpNow = money(current.competitivePrice);
  const hlBefore = money(prev.ourLandedPrice);
  const hlNow = money(current.ourLandedPrice);
  const set = prev.competitivePrice == null;
  const removed = current.competitivePrice == null;
  switch (alert.alertType) {
    case 'CompetitivePriceBelowOurs':
      return removed
        ? `Amazon removed its competitive price (was ${cpBefore}, above our HL price of ${hlNow}).`
        : `Amazon's competitive price went from ${cpBefore} to ${cpNow}, now below our HL price ` +
            `of ${hlNow} (price + shipping): the Buy Box is at risk.`;
    case 'CompetitivePriceAboveOurs':
      return set
        ? `Amazon set a competitive price of ${cpNow}, above our HL price of ${hlNow}.`
        : `Amazon's competitive price went from ${cpBefore} to ${cpNow}, now above our HL price ` +
            `of ${hlNow}.`;
    case 'CompetitivePriceChanged':
      if (set) return `Amazon set a competitive price of ${cpNow} (our HL price: ${hlNow}).`;
      if (removed) {
        return `Amazon removed its competitive price (was ${cpBefore}; our HL price: ${hlNow}).`;
      }
      return `Amazon's competitive price changed from ${cpBefore} to ${cpNow} (our HL price: ${hlNow}).`;
    case 'OurPriceAboveCompetitive':
      return removed
        ? `Our HL price (price + shipping) went from ${hlBefore} to ${hlNow}, and Amazon removed ` +
            `its competitive price (was ${cpBefore}).`
        : `Our HL price (price + shipping) went from ${hlBefore} to ${hlNow}, now above ` +
            `Amazon's competitive price of ${cpNow}: the Buy Box is at risk.`;
    default:
      return (
        `Our HL price (price + shipping) went from ${hlBefore} to ${hlNow}, now below ` +
        `Amazon's competitive price of ${cpNow}.`
      );
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
      return describeTextChange('Description', prev.description, current.description);
    case 'BulletPointsChanged':
      return describeBullets(alert.category, prev, current);
    case 'CompetitivePriceBelowOurs':
    case 'CompetitivePriceAboveOurs':
    case 'CompetitivePriceChanged':
    case 'OurPriceAboveCompetitive':
    case 'OurPriceBelowCompetitive':
      return describeCompetitive(alert, prev, current);
    default:
      return 'Changed.';
  }
}

/** Words shown before the first difference, when there are that many. */
const CONTEXT_WORDS = 3;
/** About a line or two of text in each quote. */
const SNIPPET_CHARS = 160;

/** A long text as words: markup dropped, any run of spaces or lines one space. */
function wordsOf(text: string | null): string[] {
  return (text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Words from `start` up to about a line or two, with "..." where the text goes
 * on before or after them.
 */
function snippet(words: string[], start: number): string {
  let end = start;
  let length = 0;
  while (end < words.length && (end === start || length + words[end]!.length < SNIPPET_CHARS)) {
    length += words[end]!.length + 1;
    end++;
  }
  const lead = start > 0 ? '...' : '';
  const tail = end < words.length ? '...' : '';
  return `${lead}${words.slice(start, end).join(' ')}${tail}`;
}

/**
 * A long text that changed (a description): where it first differs, as
 * "from ... to ..." — up to three unchanged words before the difference (none
 * when it differs from the very start), then a line or two of each version,
 * with "..." where it goes on. Pure; also rebuilds the message of alerts logged
 * before it existed (`alertLogMessage`).
 */
export function describeTextChange(
  label: string,
  before: string | null,
  after: string | null,
): string {
  const a = wordsOf(before);
  const b = wordsOf(after);
  if (a.length === 0 && b.length === 0) return `${label} changed.`;
  if (a.length === 0) return `${label} added: "${snippet(b, 0)}".`;
  if (b.length === 0) return `${label} removed (was "${snippet(a, 0)}").`;
  const x = textChangeExcerpts(before, after);
  // The same words: only spacing or markup changed.
  if (!x) return `${label} changed (spacing or formatting only).`;
  return `${label} changed from "${x.before}" to "${x.after}".`;
}

/**
 * The two excerpts `describeTextChange` quotes: from up to three words before
 * the first difference, a line or two of each version. Null when the words are
 * the same. An empty side is "".
 */
export function textChangeExcerpts(
  before: string | null,
  after: string | null,
): { before: string; after: string } | null {
  const a = wordsOf(before);
  const b = wordsOf(after);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return null;
  const from = Math.max(0, i - CONTEXT_WORDS);
  return {
    before: a.length ? snippet(a, Math.min(from, a.length - 1)) : '',
    after: b.length ? snippet(b, Math.min(from, b.length - 1)) : '',
  };
}

/**
 * A text-change alert's before and now, to show side by side (the assignment
 * email): the whole title, the changed bullets, or a description's excerpts
 * around its first difference. Null for other alerts, or with nothing saved.
 */
export function alertCompare(row: {
  alertType: string;
  previousValue: string | null;
  newValue: string | null;
}): { label: string; before: string; after: string } | null {
  if (row.previousValue == null && row.newValue == null) return null;
  const whole = (label: string) => ({
    label,
    before: row.previousValue ?? '',
    after: row.newValue ?? '',
  });
  switch (row.alertType) {
    case 'TitleChanged':
      return whole('Title');
    case 'BulletPointsChanged':
      return whole('Bullet points');
    case 'DescriptionChanged': {
      const x = textChangeExcerpts(row.previousValue, row.newValue);
      return x ? { label: 'Description', ...x } : null;
    }
    default:
      return null;
  }
}

/**
 * An alert's message as it should read now. Description alerts logged before
 * their message showed the change just said "Description changed."; their
 * before and after are on the row, so it is rebuilt from them.
 */
export function alertLogMessage(row: {
  alertType: string;
  message: string;
  previousValue: string | null;
  newValue: string | null;
}): string {
  if (row.alertType === 'DescriptionChanged' && row.message === 'Description changed.') {
    if (row.previousValue == null && row.newValue == null) return row.message;
    return describeTextChange('Description', row.previousValue, row.newValue);
  }
  return row.message;
}

export function describeAlerts(
  alerts: DetectedAlert[],
  prev: SnapshotView,
  current: SnapshotView,
  ctx: MessageContext,
): AlertWithMessage[] {
  return alerts.map((a) => ({ ...a, message: describeAlert(a, prev, current, ctx) }));
}
