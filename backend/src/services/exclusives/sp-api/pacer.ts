// Amazon's documented per-endpoint request rates (requests/second).
export const SP_API_RATES = {
  listings: 5,
  pricing: 0.5,
  catalog: 2,
} as const;

export function batch<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('batch size must be a positive number');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Proactive per-endpoint pacer. Keeps calls at least 1/rate seconds apart so we
// stay under the SP-API limit, and slows further if Amazon reports a stricter
// limit. Deliberately no burst — strict spacing keeps us always under.
export class Pacer {
  private minIntervalMs: number;
  private nextAt = 0;

  constructor(ratePerSecond: number) {
    if (ratePerSecond <= 0) throw new Error('rate must be a positive number');
    this.minIntervalMs = 1000 / ratePerSecond;
  }

  get intervalMs(): number {
    return this.minIntervalMs;
  }

  // Adopt Amazon's reported limit when it is stricter than ours; never speed up.
  observeLimit(ratePerSecond: number | null | undefined): void {
    if (ratePerSecond && ratePerSecond > 0) {
      this.minIntervalMs = Math.max(this.minIntervalMs, 1000 / ratePerSecond);
    }
  }

  // Pure: the wait a call reserved at `now` needs; advances the schedule.
  reserve(now: number): number {
    const start = Math.max(now, this.nextAt);
    this.nextAt = start + this.minIntervalMs;
    return start - now;
  }

  async acquire(
    clock: () => number = Date.now,
    sleep: (ms: number) => Promise<void> = defaultSleep,
  ): Promise<void> {
    const delay = this.reserve(clock());
    if (delay > 0) await sleep(delay);
  }
}
