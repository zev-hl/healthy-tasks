import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { missingSpApiConfig } from '../../src/services/exclusives/sp-api/config.js';

describe('missingSpApiConfig', () => {
  const complete = {
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    merchantToken: 'A1UWLDVGZSXGKG',
  };

  it('is empty when everything is set', () => {
    assert.deepEqual(missingSpApiConfig(complete), []);
  });

  it('names each missing or blank setting by its env var', () => {
    const partial = { ...complete, clientSecret: '', merchantToken: undefined };
    assert.deepEqual(missingSpApiConfig(partial), [
      'SP_API_CLIENT_SECRET',
      'SP_API_MERCHANT_TOKEN',
    ]);
    assert.equal(missingSpApiConfig({}).length, 4);
  });
});
