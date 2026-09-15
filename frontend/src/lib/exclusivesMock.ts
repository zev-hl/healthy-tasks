/**
 * Static mock data for the Exclusives screens (HLAI-71).
 *
 * Mirrors the reference design's sample content so the dashboard, log and
 * editor render exactly like the mockup while the backend (Chunks 2–7) does not
 * exist yet. Everything here is throwaway and gets replaced by real API data.
 * The clock is pinned to the design's reference "now" so relative/absolute
 * times match the mockup verbatim.
 */
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesAlertType,
  type ExclusivesGroupType,
} from '@healthy-tasks/shared';

export type Marketplace = 'USA' | 'Canada';

export interface AsinRow {
  asin: string;
  title: string;
  platform: Marketplace;
}

export interface MockGroup {
  id: string;
  name: string;
  kind: ExclusivesGroupType; // GROUP | INDIVIDUAL
  asins: AsinRow[];
  /** Alerts in the past 24h. */
  notif: number;
  /** How many of the 12 alert types are switched on. */
  onCount: number;
  updated: string; // e.g. "Aug 24"
  /** Hours before NOW that the latest alert fired. */
  latestHrs: number;
}

/** Design reference clock — Wednesday, Aug 26 2026, 2:42 PM. */
export const NOW = new Date('2026-08-26T14:42:00');
export const RUN_HEADER = 'Wednesday, Aug 26 · last run 2:30 PM · next run 3:00 PM';

const us = (asin: string, title: string): AsinRow => ({ asin, title, platform: 'USA' });
const ca = (asin: string, title: string): AsinRow => ({ asin, title, platform: 'Canada' });

export const MOCK_GROUPS: MockGroup[] = [
  {
    id: 'g1',
    name: 'Nordic Vitality — Omega line',
    kind: 'GROUP',
    notif: 23,
    onCount: 11,
    updated: 'Aug 24',
    latestHrs: 0.4,
    asins: [
      us('B08KQ2M4T7', 'Nordic Vitality Triple Strength Omega-3 1200mg, 180 Softgels'),
      us('B08KQ2M9LX', 'Nordic Vitality Omega-3 Fish Oil 1000mg, 90 Softgels'),
      ca('B09J4TTR21', 'Nordic Vitality Krill Oil 500mg, 120 Softgels'),
      us('B09J4TVB08', 'Nordic Vitality Algae Omega-3 Vegan, 60 Capsules'),
      ca('B0B3M7QK4D', 'Nordic Vitality Omega-3 Gummies Lemon, 90 Count'),
      us('B0B3M7RN9F', 'Nordic Vitality Cod Liver Oil Liquid 8 fl oz'),
      us('B0C7QMV3RK', 'Nordic Vitality Omega 3-6-9 Complex, 120 Softgels'),
      us('B0C7QMWX2P', 'Nordic Vitality Omega-3 Kids Chewables, 60 Count'),
    ],
  },
  {
    id: 'g2',
    name: 'Clearview Collagen',
    kind: 'GROUP',
    notif: 14,
    onCount: 8,
    updated: 'Aug 19',
    latestHrs: 1.6,
    asins: [
      us('B07YHM4K2V', 'Clearview Marine Collagen Peptides Unflavored, 16 oz'),
      us('B07YHM6RT8', 'Clearview Collagen + Vitamin C Powder, 10.6 oz'),
      us('B08LN3PP7Q', 'Clearview Collagen Capsules 1500mg, 180 Count'),
      ca('B08LN3QW1S', 'Clearview Bovine Collagen Peptides, 32 oz'),
      us('B0BF6CJ4XM', 'Clearview Collagen Coffee Creamer Vanilla, 12 oz'),
    ],
  },
  {
    id: 'g3',
    name: 'Aster & Oak Magnesium Glycinate 400mg, 120 Capsules',
    kind: 'INDIVIDUAL',
    notif: 9,
    onCount: 12,
    updated: 'Aug 26',
    latestHrs: 2.9,
    asins: [us('B09TT4X6HD', 'Aster & Oak Magnesium Glycinate 400mg, 120 Capsules')],
  },
  {
    id: 'g4',
    name: 'Sunridge Kids Multivitamin',
    kind: 'GROUP',
    notif: 7,
    onCount: 9,
    updated: 'Aug 12',
    latestHrs: 5.2,
    asins: [
      us('B08D7GG9QN', 'Sunridge Kids Multivitamin Gummies Mixed Berry, 120 Count'),
      us('B08D7GHK3T', 'Sunridge Kids Multivitamin Gummies Grape, 60 Count'),
      us('B0C21WLT4B', 'Sunridge Kids Immune Support Elderberry Gummies, 90 Count'),
      us('B0C21WMM7J', 'Sunridge Toddler Multivitamin Drops 2 fl oz'),
    ],
  },
  {
    id: 'g5',
    name: 'Ridgeline Sports Hydration',
    kind: 'GROUP',
    notif: 6,
    onCount: 6,
    updated: 'Aug 21',
    latestHrs: 8.5,
    asins: [
      us('B0BM9L2VDS', 'Ridgeline Electrolyte Powder Sticks Citrus, 30 Count'),
      us('B0BM9L4KQR', 'Ridgeline Electrolyte Powder Sticks Berry, 30 Count'),
      us('B0DK5S8TW2', 'Ridgeline Hydration Tablets Lemon Lime, 10 Tubes'),
      us('B0DK5S9YHV', 'Ridgeline Zero Sugar Sports Drink Mix, 60 Servings'),
    ],
  },
  {
    id: 'g6',
    name: 'Meadowlark Ashwagandha KSM-66 600mg, 90 Capsules',
    kind: 'INDIVIDUAL',
    notif: 3,
    onCount: 5,
    updated: 'Jul 30',
    latestHrs: 13,
    asins: [us('B07QK9FDL3', 'Meadowlark Ashwagandha KSM-66 600mg, 90 Capsules')],
  },
  {
    id: 'g7',
    name: 'Meadowlark Botanicals',
    kind: 'GROUP',
    notif: 2,
    onCount: 4,
    updated: 'Aug 03',
    latestHrs: 20,
    asins: [
      us('B07QK9G2WW', 'Meadowlark Turmeric Curcumin with BioPerine, 120 Capsules'),
      us('B0932XPLNC', 'Meadowlark Milk Thistle Extract 1000mg, 120 Capsules'),
      us('B0932XQ7RF', 'Meadowlark Elderberry Extract Liquid 4 fl oz'),
    ],
  },
];

/** One-line change descriptions per alert type (from the design's DETAILS map). */
export const ALERT_DETAILS: Record<ExclusivesAlertType, string> = {
  ListingSuppressed:
    'Amazon suppressed the listing — image requirement not met. Detected during the 2:30 PM run.',
  BuyBoxLost: 'Buy Box moved to Prime Deals Direct at $31.49. We were at $34.99.',
  BuyBoxWon: 'Buy Box returned to Health Life at $34.99.',
  NumberOfSellersChanged: 'Offer count went from 3 to 6. Three new FBA sellers on the listing.',
  PriceChanged: 'List price changed from $34.99 to $31.49 (−10.0%).',
  CategoryChanged:
    'Browse node moved from Health & Household › Vitamins to Health & Household › Sports Nutrition.',
  BrandChanged: 'Brand field changed from Nordic Vitality to Nordic Vitality Health.',
  TitleChanged: 'Title edited — “Triple Strength” removed, count moved to the front.',
  MainImageChanged: 'Main image replaced. New image hash differs from the last snapshot.',
  DescriptionChanged: 'A+ description block edited — 3 paragraphs changed.',
  BulletPointsChanged: 'Bullet 2 and bullet 4 rewritten.',
  DimensionsChanged: 'Package dimensions changed from 3.5 × 3.5 × 5.2 in to 3.5 × 3.5 × 4.8 in.',
};

// --- Time formatting (matches the mockup) ---------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Absolute label, e.g. "Aug 26, 2:18 PM". */
export function fmtAbs(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${m} ${ampm}`;
}

/** Relative label from NOW, e.g. "24m ago" / "3h ago" / "1d ago". */
export function fmtRel(d: Date): string {
  const mins = Math.max(0, Math.round((NOW.getTime() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Date of a group's latest alert. */
export const latestDate = (g: MockGroup): Date =>
  new Date(NOW.getTime() - g.latestHrs * 3600_000);

// --- Alert log (deterministic generation, mirrors the design's seedLog) ----

export interface LogEntry {
  gid: string;
  group: string; // group name, or "Individual" for single-ASIN groups
  asin: string;
  title: string;
  platform: Marketplace;
  type: ExclusivesAlertType;
  date: Date;
}

/** Seeded LCG so the log is stable across renders (design seeds with 7). */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export function buildLog(): LogEntry[] {
  const rnd = makeRng(7);
  const out: LogEntry[] = [];
  for (const g of MOCK_GROUPS) {
    for (let i = 0; i < g.notif; i++) {
      const a = g.asins[Math.floor(rnd() * g.asins.length)]!;
      const type = EXCLUSIVES_ALERT_TYPES[Math.floor(rnd() * g.onCount)]!;
      const hrs = g.latestHrs + i * (1.1 + rnd() * 3.4);
      out.push({
        gid: g.id,
        group: g.kind === 'INDIVIDUAL' ? 'Individual' : g.name,
        asin: a.asin,
        title: a.title,
        platform: a.platform,
        type,
        date: new Date(NOW.getTime() - hrs * 3600_000),
      });
    }
  }
  out.sort((x, y) => y.date.getTime() - x.date.getTime());
  return out;
}

export const totalAsins = (): number =>
  MOCK_GROUPS.reduce((n, g) => n + g.asins.length, 0);

/** Headline "ASINs monitored" figure shown on the dashboard (design value). */
export const MONITORED_ASINS = 126;

export const total24h = (): number => MOCK_GROUPS.reduce((n, g) => n + g.notif, 0);
