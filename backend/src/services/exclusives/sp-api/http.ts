import { SpApiNetworkError } from './errors.js';

// Transport for every Amazon call (SP-API and the LWA token endpoint): a
// per-attempt timeout, plus bounded retry with backoff for TRANSIENT failures
// only — throttling (429), server errors (5xx) and network drops/timeouts. Any
// other status goes straight back to the caller, so a 400/403 is never retried
// here. Once retries are spent the sweep skips that batch and the next
// scheduled sweep is the outer retry (HLAI-71 Chunk 6).

export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT_MS = 30_000;
// At least the slowest endpoint's pacing interval (pricing, 0.5/s), so a retry
// never goes out sooner than the pacer would have allowed.
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export const isRetryableStatus = (status: number): boolean => RETRYABLE_STATUS.has(status);

// fetch rejects with a TypeError when the connection fails or drops, and with a
// TimeoutError (or AbortError) when the per-attempt timeout fires.
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// Exponential backoff with jitter. A numeric Retry-After (seconds) wins when it
// is longer; any other form of the header is ignored.
export function backoffMs(
  attempt: number,
  retryAfter: string | null,
  random = Math.random,
): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const header = retryAfter ? Number(retryAfter) * 1000 : 0;
  const wait = Number.isFinite(header) ? Math.max(header, base) : base;
  return Math.min(BACKOFF_CAP_MS, wait + Math.floor(random() * 400));
}

// Error bodies are not always JSON (a gateway can answer with HTML), so a parse
// failure must never hide the real HTTP status.
export function parseBody(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

type FetchFn = (input: URL | string, init: RequestInit) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

const defaultHooks: { fetch: FetchFn; sleep: SleepFn } = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
};
let hooks = { ...defaultHooks };

/** Test seam: swap the network and the backoff wait (unit tests run instantly, never reach Amazon). */
export function __setHttpHooks(overrides: Partial<typeof defaultHooks>): void {
  hooks = { ...hooks, ...overrides };
}

/** Test seam: restore the real network and timers. */
export function __resetHttpHooks(): void {
  hooks = { ...defaultHooks };
}

export interface RetryOptions {
  /** Awaited before EVERY attempt, retries included — the sweep's rate pacer, so a
   * retry can never go out faster than the endpoint's limit allows. */
  beforeAttempt?: () => Promise<void>;
}

/**
 * One logical request. Returns the first response that is not worth retrying
 * (whatever its status — the caller decides what a 4xx means), or the last
 * retryable one once retries are spent. Throws SpApiNetworkError only when no
 * attempt got a response at all.
 */
export async function fetchWithRetry(
  label: string,
  url: URL | string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<HttpResponse> {
  for (let attempt = 0; ; attempt++) {
    const retriesLeft = attempt < MAX_RETRIES;
    await options.beforeAttempt?.();

    let response: HttpResponse;
    try {
      const res = await hooks.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Read the body inside the try: the connection can drop mid-body, and the
      // timeout covers the body as well as the headers.
      response = { status: res.status, headers: res.headers, text: await res.text() };
    } catch (err) {
      if (!isTransientNetworkError(err)) throw err;
      if (!retriesLeft) throw new SpApiNetworkError(label, err);
      await hooks.sleep(backoffMs(attempt, null));
      continue;
    }

    if (retriesLeft && isRetryableStatus(response.status)) {
      await hooks.sleep(backoffMs(attempt, response.headers.get('Retry-After')));
      continue;
    }
    return response;
  }
}
