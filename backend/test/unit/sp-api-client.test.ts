import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __resetHttpHooks, __setHttpHooks } from '../../src/services/exclusives/sp-api/http.js';
import { SpApiError, SpApiWriteBlockedError } from '../../src/services/exclusives/sp-api/errors.js';

// env.ts reads its config once, at import. Pin fake credentials BEFORE loading
// the client so these tests never depend on (or send) real ones — every request
// below goes to the stubbed network anyway.
process.env.SP_API_CLIENT_ID = 'test-client';
process.env.SP_API_CLIENT_SECRET = 'test-secret';
process.env.SP_API_REFRESH_TOKEN = 'test-refresh';
process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.JWT_SECRET ??= 'unused';
const { spApiRequest, isTokenRejected } =
  await import('../../src/services/exclusives/sp-api/client.js');
const { clearTokenCache } = await import('../../src/services/exclusives/sp-api/auth.js');

const LWA_HOST = 'api.amazon.com';

interface Call {
  host: string;
  token: string | undefined;
}

// Separate reply queues for the LWA token endpoint and SP-API itself.
function stubAmazon(replies: { lwa?: Response[]; api?: Response[] }) {
  const lwa = [...(replies.lwa ?? [])];
  const api = [...(replies.api ?? [])];
  const calls: Call[] = [];
  __setHttpHooks({
    fetch: async (url, init) => {
      const host = new URL(String(url)).host;
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ host, token: headers['x-amz-access-token'] });
      const next = host === LWA_HOST ? lwa.shift() : api.shift();
      if (!next) throw new Error(`unexpected extra request to ${host}`);
      return next;
    },
    sleep: async () => {},
  });
  return {
    calls,
    apiCalls: () => calls.filter((c) => c.host !== LWA_HOST),
    lwaCalls: () => calls.filter((c) => c.host === LWA_HOST),
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const token = (value: string) => json(200, { access_token: value, expires_in: 3600 });
const expiredToken = () =>
  json(403, {
    errors: [
      {
        code: 'Unauthorized',
        message: 'Access to requested resource is denied.',
        details: 'The access token you provided has expired.',
      },
    ],
  });
const roleDenied = () =>
  json(403, {
    errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }],
  });

beforeEach(() => clearTokenCache());
afterEach(() => __resetHttpHooks());

describe('spApiRequest', () => {
  it('sends the LWA token and returns data with the reported rate limit', async () => {
    const amazon = stubAmazon({
      lwa: [token('token-1')],
      api: [json(200, { payload: [] }, { 'x-amzn-RateLimit-Limit': '0.5' })],
    });
    const res = await spApiRequest<{ payload: unknown[] }>({
      method: 'GET',
      path: '/sellers/v1/x',
    });
    assert.deepEqual(res.data, { payload: [] });
    assert.equal(res.rateLimit, 0.5);
    assert.equal(amazon.apiCalls()[0]!.token, 'token-1');
  });

  it('mints a fresh token and retries once when Amazon rejects the cached one', async () => {
    const amazon = stubAmazon({
      lwa: [token('stale'), token('fresh')],
      api: [expiredToken(), json(200, { ok: true })],
    });
    const res = await spApiRequest({ method: 'GET', path: '/sellers/v1/x' });
    assert.deepEqual(res.data, { ok: true });
    assert.deepEqual(
      amazon.apiCalls().map((c) => c.token),
      ['stale', 'fresh'],
    );
  });

  it('refreshes the token only once per request', async () => {
    const amazon = stubAmazon({
      lwa: [token('t1'), token('t2')],
      api: [expiredToken(), expiredToken()],
    });
    await assert.rejects(
      spApiRequest({ method: 'GET', path: '/sellers/v1/x' }),
      (err: unknown) => err instanceof SpApiError && err.status === 403,
    );
    assert.equal(amazon.lwaCalls().length, 2);
    assert.equal(amazon.apiCalls().length, 2);
  });

  it('treats a 403 that is not about the token as final', async () => {
    const amazon = stubAmazon({ lwa: [token('t1')], api: [roleDenied()] });
    await assert.rejects(
      spApiRequest({ method: 'GET', path: '/sellers/v1/x' }),
      (err: unknown) => err instanceof SpApiError && err.status === 403,
    );
    assert.equal(amazon.lwaCalls().length, 1);
    assert.equal(amazon.apiCalls().length, 1);
  });

  it('reports a non-JSON server error by its status, not as a parse failure', async () => {
    const gateway = () => new Response('<html>Bad Gateway</html>', { status: 502 });
    stubAmazon({ lwa: [token('t1')], api: [gateway(), gateway(), gateway(), gateway()] });
    await assert.rejects(
      spApiRequest({ method: 'GET', path: '/sellers/v1/x' }),
      (err: unknown) => err instanceof SpApiError && err.status === 502,
    );
  });

  it('retries a transient LWA failure before giving up on the token', async () => {
    const amazon = stubAmazon({
      lwa: [new Response('', { status: 500 }), token('t1')],
      api: [json(200, {})],
    });
    await spApiRequest({ method: 'GET', path: '/sellers/v1/x' });
    assert.equal(amazon.lwaCalls().length, 2);
  });

  it('blocks a write before anything reaches the network', async () => {
    const amazon = stubAmazon({});
    await assert.rejects(
      spApiRequest({ method: 'POST', path: '/feeds/2021-06-30/documents', body: {} }),
      SpApiWriteBlockedError,
    );
    assert.equal(amazon.calls.length, 0);
  });
});

describe('isTokenRejected', () => {
  it('matches 401 and a 403 about the access token, nothing else', () => {
    assert.equal(isTokenRejected(401, {}), true);
    assert.equal(
      isTokenRejected(403, {
        errors: [
          {
            code: 'Unauthorized',
            details: 'The access token you provided is revoked, malformed or invalid.',
          },
        ],
      }),
      true,
    );
    assert.equal(
      isTokenRejected(403, { errors: [{ code: 'Unauthorized', message: 'Access denied.' }] }),
      false,
    );
    assert.equal(isTokenRejected(403, { raw: '<html>' }), false);
    assert.equal(isTokenRejected(400, {}), false);
  });
});
