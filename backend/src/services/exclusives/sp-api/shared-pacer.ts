import { Pacer, SP_API_RATES } from './pacer.js';

// One pacer per endpoint for the whole process.
//
// The 30-minute sweep and the editor's ASIN lookup both call the listings
// endpoint, which allows 5 requests a second. With a pacer each they would each
// keep to 5/s and together send 10/s, and Amazon would start throttling the
// seller account. Sharing these is what stops that.

export type SpApiPacers = Record<keyof typeof SP_API_RATES, Pacer>;

export function buildPacers(rates: Record<keyof typeof SP_API_RATES, number>): SpApiPacers {
  return {
    listings: new Pacer(rates.listings),
    pricing: new Pacer(rates.pricing),
    catalog: new Pacer(rates.catalog),
  };
}

let pacers = buildPacers(SP_API_RATES);

/** The process-wide pacers. Anything calling Amazon should go through these. */
export function sharedPacers(): SpApiPacers {
  return pacers;
}

/** Test seam: start from unused pacers, optionally at a faster rate. */
export function __resetSharedPacers(
  rates: Record<keyof typeof SP_API_RATES, number> = SP_API_RATES,
): void {
  pacers = buildPacers(rates);
}
