import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import {
  corsOriginOption,
  isAllowedOrigin,
  parseCorsOrigins,
} from '../../src/utils/cors-origins.js';

const STAGING = 'https://hlcentral-staging.onrender.com';
const REDESIGN = 'https://hlcentral-redesign.onrender.com';

/** The API's own cors() set-up, with a stand-in route. */
function appFor(corsOrigin: string) {
  const app = express();
  app.use(
    cors({
      origin: corsOriginOption(parseCorsOrigins(corsOrigin)),
      credentials: true,
      exposedHeaders: ['X-Refreshed-Token'],
    }),
  );
  app.get('/api/ping', (_req, res) => {
    res.setHeader('X-Refreshed-Token', 'fresh');
    res.json({ ok: true });
  });
  return app;
}

describe('CORS_ORIGIN', () => {
  it('reads one origin as before', () => {
    assert.deepEqual(parseCorsOrigins(STAGING), [STAGING]);
    assert.equal(corsOriginOption(parseCorsOrigins(STAGING)), STAGING);
  });

  it('reads several, separated by commas, trimmed, blanks dropped', () => {
    assert.deepEqual(parseCorsOrigins(` ${STAGING} ,${REDESIGN}, `), [STAGING, REDESIGN]);
    assert.deepEqual(corsOriginOption([STAGING, REDESIGN]), [STAGING, REDESIGN]);
  });

  it('knows which request origins are allowed', () => {
    const origins = [STAGING, REDESIGN];
    assert.equal(isAllowedOrigin(STAGING, origins), true);
    assert.equal(isAllowedOrigin(REDESIGN, origins), true);
    assert.equal(isAllowedOrigin('https://elsewhere.example', origins), false);
    assert.equal(isAllowedOrigin(`${STAGING}/`, origins), false);
    assert.equal(isAllowedOrigin(undefined, origins), false);
  });

  it('with one origin, always names it, exactly as before', async () => {
    for (const from of [STAGING, 'https://elsewhere.example']) {
      const res = await request(appFor(STAGING)).get('/api/ping').set('Origin', from);
      assert.equal(res.headers['access-control-allow-origin'], STAGING, from);
    }
  });

  it('with several, names whichever allowed site asked, and exposes the refreshed token', async () => {
    const app = appFor(`${STAGING}, ${REDESIGN}`);
    for (const from of [STAGING, REDESIGN]) {
      const res = await request(app).get('/api/ping').set('Origin', from);
      assert.equal(res.headers['access-control-allow-origin'], from);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
      assert.equal(res.headers['access-control-expose-headers'], 'X-Refreshed-Token');
      assert.match(res.headers.vary ?? '', /Origin/);

      const preflight = await request(app)
        .options('/api/ping')
        .set('Origin', from)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], from);
    }
    const other = await request(app).get('/api/ping').set('Origin', 'https://elsewhere.example');
    assert.equal(other.headers['access-control-allow-origin'], undefined);
  });
});
