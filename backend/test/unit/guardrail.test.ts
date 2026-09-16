import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnly } from '../../src/services/exclusives/sp-api/client.js';
import { SpApiWriteBlockedError } from '../../src/services/exclusives/sp-api/errors.js';

describe('SP-API read-only guardrail', () => {
  it('allows GET on any path', () => {
    assert.doesNotThrow(() => assertReadOnly('GET', '/listings/2021-08-01/items/SELLER'));
    assert.doesNotThrow(() => assertReadOnly('GET', '/sellers/v1/marketplaceParticipations'));
  });

  it('allows the whitelisted pricing POST', () => {
    assert.doesNotThrow(() => assertReadOnly('POST', '/batches/products/pricing/v0/listingOffers'));
  });

  it('blocks writes and non-whitelisted POSTs', () => {
    for (const [method, path] of [
      ['PUT', '/listings/2021-08-01/items/SELLER/SKU'],
      ['DELETE', '/listings/2021-08-01/items/SELLER/SKU'],
      ['POST', '/feeds/2021-06-30/documents'],
      ['POST', '/messaging/v1/orders/1/messages'],
      ['PATCH', '/listings/2021-08-01/items/SELLER/SKU'],
    ] as const) {
      assert.throws(() => assertReadOnly(method, path), SpApiWriteBlockedError, `${method} ${path}`);
    }
  });
});
