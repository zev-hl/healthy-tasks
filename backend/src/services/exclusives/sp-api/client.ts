import { getAccessToken } from './auth.js';
import { SpApiError, SpApiWriteBlockedError } from './errors.js';
import { fetchWithRetry, parseBody } from './http.js';

export const SP_API_HOST = 'https://sellingpartnerapi-na.amazon.com';

// The only non-GET path this app is allowed to call: the read-only pricing
// batch. Everything else must be GET. Any other method or path is refused
// before a request leaves the process, so production listings can never be
// modified from here.
const ALLOWED_POST_PATHS = ['/batches/products/pricing/v0/listingOffers'];

export function assertReadOnly(method: string, path: string): void {
  if (method === 'GET') return;
  if (method === 'POST' && ALLOWED_POST_PATHS.some((p) => path.startsWith(p))) return;
  throw new SpApiWriteBlockedError(
    `Refusing non-read-only SP-API call: ${method} ${path}. This application is read-only.`,
  );
}

export interface SpApiResult<T> {
  status: number;
  data: T;
  rateLimit: number | null;
}

interface SpApiErrorBody {
  errors?: Array<{ code?: unknown; message?: unknown; details?: unknown }>;
}

// Amazon rejected the access token itself (expired, revoked or malformed).
// SP-API usually reports that as a 403 "Unauthorized" whose text names the
// access token rather than as a 401; a 403 for any other reason (e.g. a
// missing role) is final.
export function isTokenRejected(status: number, body: unknown): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const errors = (body as SpApiErrorBody | null)?.errors ?? [];
  return errors.some(
    (e) =>
      e.code === 'Unauthorized' && /access token/i.test(`${e.message ?? ''} ${e.details ?? ''}`),
  );
}

export async function spApiRequest<T>(opts: {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Rate pacer for this endpoint, awaited before every attempt (retries too). */
  pace?: () => Promise<void>;
}): Promise<SpApiResult<T>> {
  assertReadOnly(opts.method, opts.path);

  const url = new URL(opts.path, SP_API_HOST);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const body =
    opts.method === 'POST' && opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const init = (token: string): RequestInit => ({
    method: opts.method,
    headers: {
      'x-amz-access-token': token,
      accept: 'application/json',
      ...(opts.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
  const label = `${opts.method} ${opts.path}`;
  const retry = { beforeAttempt: opts.pace };

  let res = await fetchWithRetry(label, url, init(await getAccessToken()), retry);
  let data = parseBody(res.text);
  // The cached token can be rejected before its expiry (rotated or revoked):
  // mint a fresh one and try exactly once more.
  if (isTokenRejected(res.status, data)) {
    res = await fetchWithRetry(label, url, init(await getAccessToken(true)), retry);
    data = parseBody(res.text);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new SpApiError(res.status, opts.method, opts.path, data);
  }
  const rateLimit = res.headers.get('x-amzn-RateLimit-Limit');
  return { status: res.status, data: data as T, rateLimit: rateLimit ? Number(rateLimit) : null };
}
