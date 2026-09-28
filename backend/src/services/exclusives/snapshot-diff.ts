// A snapshot reduced to plain comparable values (Prisma Decimal/Json already
// normalized). Both the persisted row and a fresh draft map to this shape.
export interface SnapshotView {
  title: string | null;
  mainImageUrl: string | null;
  category: string | null;
  brand: string | null;
  bulletPoints: string[];
  description: string | null;
  dimensions: string | null;
  listedPrice: number | null;
  currency: string | null;
  buyboxWinnerSellerId: string | null;
  buyboxPrice: number | null;
  offerCount: number | null;
  isSuppressed: boolean;
  suppressionReason: string | null;
}

export interface FieldChange {
  field: string;
  previous: unknown;
  current: unknown;
}

const eq = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

// Money compares to the cent; either side missing means "changed" only if the
// other side is present.
const moneyEq = (a: number | null, b: number | null): boolean =>
  a == null || b == null ? a === b : Math.abs(a - b) < 0.005;

const bulletsEq = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function change(field: string, previous: unknown, current: unknown, equal: boolean): FieldChange | null {
  return equal ? null : { field, previous, current };
}

// Raw field-level diff between two snapshots. No interpretation — mapping to
// alert types (Buy Box won/lost, etc.) happens in 5b.
export function diffSnapshots(prev: SnapshotView, current: SnapshotView): FieldChange[] {
  return [
    change('title', prev.title, current.title, eq(prev.title, current.title)),
    change('mainImageUrl', prev.mainImageUrl, current.mainImageUrl, eq(prev.mainImageUrl, current.mainImageUrl)),
    change('category', prev.category, current.category, eq(prev.category, current.category)),
    change('brand', prev.brand, current.brand, eq(prev.brand, current.brand)),
    change('description', prev.description, current.description, eq(prev.description, current.description)),
    change('dimensions', prev.dimensions, current.dimensions, eq(prev.dimensions, current.dimensions)),
    change('listedPrice', prev.listedPrice, current.listedPrice, moneyEq(prev.listedPrice, current.listedPrice)),
    change('buyboxPrice', prev.buyboxPrice, current.buyboxPrice, moneyEq(prev.buyboxPrice, current.buyboxPrice)),
    change('offerCount', prev.offerCount, current.offerCount, eq(prev.offerCount, current.offerCount)),
    change(
      'buyboxWinnerSellerId',
      prev.buyboxWinnerSellerId,
      current.buyboxWinnerSellerId,
      eq(prev.buyboxWinnerSellerId, current.buyboxWinnerSellerId),
    ),
    change('isSuppressed', prev.isSuppressed, current.isSuppressed, eq(prev.isSuppressed, current.isSuppressed)),
    change('bulletPoints', prev.bulletPoints, current.bulletPoints, bulletsEq(prev.bulletPoints, current.bulletPoints)),
  ].filter((c): c is FieldChange => c !== null);
}

/** Indices of bullets that differ between two lists (for the alert category). */
export function changedBulletIndices(prev: string[], current: string[]): number[] {
  const max = Math.max(prev.length, current.length);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    if (prev[i] !== current[i]) out.push(i);
  }
  return out;
}
