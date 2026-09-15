import { getAccessToken } from './auth.js';
import { SpApiError, SpApiWriteBlockedError } from './errors.js';

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

export async function spApiRequest<T>(opts: {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}): Promise<SpApiResult<T>> {
  assertReadOnly(opts.method, opts.path);

  const token = await getAccessToken();
  const url = new URL(opts.path, SP_API_HOST);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    method: opts.method,
    headers: {
      'x-amz-access-token': token,
      accept: 'application/json',
      ...(opts.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.method === 'POST' && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const rateLimit = res.headers.get('x-amzn-RateLimit-Limit');
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new SpApiError(res.status, opts.method, opts.path, data);
  }

  return { status: res.status, data: data as T, rateLimit: rateLimit ? Number(rateLimit) : null };
}
