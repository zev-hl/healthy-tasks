import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RETRIES,
  __resetHttpHooks,
  __setHttpHooks,
  backoffMs,
  fetchWithRetry,
  parseBody,
} from '../../src/services/exclusives/sp-api/http.js';
import { SpApiNetworkError } from '../../src/services/exclusives/sp-api/errors.js';

// Replies are consumed in order; an Error rejects the way fetch does.
function stubNetwork(replies: Array<Response | Error>) {
  const inits: RequestInit[] = [];
  const sleeps: number[] = [];
  __setHttpHooks({
    fetch: async (_url, init) => {
      inits.push(init);
      const next = replies.shift();
      if (!next) throw new Error('unexpected extra request');
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { inits, sleeps };
}

const reply = (status: number, text = '{}', headers: Record<string, string> = {}) =>
  new Response(text, { status, headers });
const networkDown = () => new TypeError('fetch failed');
const timedOut = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

afterEach(() => __resetHttpHooks());

describe('fetchWithRetry', () => {
  it('returns the first successful response without waiting', async () => {
    const net = stubNetwork([reply(200, '{"ok":true}')]);
    const res = await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"ok":true}');
    assert.equal(net.inits.length, 1);
    assert.deepEqual(net.sleeps, []);
  });

  it('retries a 5xx and returns the recovery', async () => {
    const net = stubNetwork([reply(503), reply(200)]);
    const res = await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(net.inits.length, 2);
    assert.equal(net.sleeps.length, 1);
  });

  it('retries a 429 and honours a longer Retry-After', async () => {
    const net = stubNetwork([reply(429, '{}', { 'Retry-After': '9' }), reply(200)]);
    await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.ok(net.sleeps[0]! >= 9000, `slept ${net.sleeps[0]}ms`);
  });

  it('gives up after the retry budget and hands back the last response', async () => {
    const net = stubNetwork([reply(500), reply(502), reply(503), reply(504)]);
    const res = await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.equal(res.status, 504);
    assert.equal(net.inits.length, MAX_RETRIES + 1);
    assert.equal(net.sleeps.length, MAX_RETRIES);
  });

  it('never retries a 400 or 403', async () => {
    for (const status of [400, 403]) {
      const net = stubNetwork([reply(status)]);
      const res = await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
      assert.equal(res.status, status);
      assert.equal(net.inits.length, 1, `status ${status}`);
    }
  });

  it('retries network drops and timeouts', async () => {
    const net = stubNetwork([networkDown(), timedOut(), reply(200)]);
    const res = await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(net.inits.length, 3);
  });

  it('throws SpApiNetworkError once every attempt failed to connect', async () => {
    stubNetwork([networkDown(), networkDown(), timedOut(), networkDown()]);
    await assert.rejects(
      fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' }),
      SpApiNetworkError,
    );
  });

  it('rethrows an unexpected error without retrying', async () => {
    const net = stubNetwork([new RangeError('bug')]);
    await assert.rejects(
      fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' }),
      RangeError,
    );
    assert.equal(net.inits.length, 1);
  });

  it('puts a timeout signal on every attempt', async () => {
    const net = stubNetwork([reply(503), reply(200)]);
    await fetchWithRetry('GET /x', 'https://example.test/x', { method: 'GET' });
    assert.ok(net.inits.every((init) => init.signal instanceof AbortSignal));
  });

  it('waits on the pacer before every attempt, retries included', async () => {
    const order: string[] = [];
    stubNetwork([reply(503), reply(503), reply(200)]);
    __setHttpHooks({
      sleep: async () => {
        order.push('backoff');
      },
    });
    await fetchWithRetry(
      'GET /x',
      'https://example.test/x',
      { method: 'GET' },
      {
        beforeAttempt: async () => {
          order.push('pace');
        },
      },
    );
    assert.deepEqual(order, ['pace', 'backoff', 'pace', 'backoff', 'pace']);
  });
});

describe('backoffMs', () => {
  const noJitter = () => 0;

  it('doubles per attempt from a 2s base', () => {
    assert.deepEqual(
      [0, 1, 2].map((a) => backoffMs(a, null, noJitter)),
      [2000, 4000, 8000],
    );
  });

  it('is capped at 60s', () => {
    assert.equal(backoffMs(10, null, noJitter), 60_000);
    assert.equal(backoffMs(0, '600', noJitter), 60_000);
  });

  it('uses a numeric Retry-After only when longer, and ignores other forms', () => {
    assert.equal(backoffMs(0, '5', noJitter), 5000);
    assert.equal(backoffMs(2, '1', noJitter), 8000);
    assert.equal(backoffMs(0, 'Wed, 21 Oct 2026 07:28:00 GMT', noJitter), 2000);
  });
});

describe('parseBody', () => {
  it('parses JSON, treats empty as {}, and keeps non-JSON as raw text', () => {
    assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
    assert.deepEqual(parseBody(''), {});
    assert.deepEqual(parseBody('<html>Bad Gateway</html>'), { raw: '<html>Bad Gateway</html>' });
  });
});
