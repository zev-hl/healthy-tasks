/* eslint-disable no-console */
import { getAccessToken } from '../src/services/exclusives/sp-api/auth.js';
import { assertReadOnly } from '../src/services/exclusives/sp-api/client.js';
import { getMarketplaceParticipations } from '../src/services/exclusives/sp-api/sellers.js';
import { MONITORED_COUNTRY_CODES } from '../src/services/exclusives/sp-api/marketplaces.js';
import { SpApiWriteBlockedError } from '../src/services/exclusives/sp-api/errors.js';

async function checkAuth(): Promise<boolean> {
  console.log('1) Refreshing LWA access token…');
  try {
    const token = await getAccessToken(true);
    console.log(`   OK — access token acquired (${token.slice(0, 6)}…, length ${token.length})`);
    return true;
  } catch (err) {
    console.error(`   FAILED — ${(err as Error).message}`);
    return false;
  }
}

function checkGuardrail(): boolean {
  console.log('2) Verifying the read-only guardrail…');
  const writes = [
    ['PUT', '/listings/2021-08-01/items/SELLER/SKU'],
    ['DELETE', '/listings/2021-08-01/items/SELLER/SKU'],
    ['POST', '/feeds/2021-06-30/documents'],
    ['POST', '/messaging/v1/orders/123/messages'],
  ] as const;

  let blocked = 0;
  for (const [method, path] of writes) {
    try {
      assertReadOnly(method, path);
      console.error(`   FAILED — ${method} ${path} was NOT blocked`);
    } catch (err) {
      if (err instanceof SpApiWriteBlockedError) blocked += 1;
      else throw err;
    }
  }
  // The one allowed read-only POST must pass.
  let allowedOk = true;
  try {
    assertReadOnly('POST', '/batches/products/pricing/v0/listingOffers');
  } catch {
    allowedOk = false;
  }
  const ok = blocked === writes.length && allowedOk;
  console.log(
    `   ${ok ? 'OK' : 'FAILED'} — blocked ${blocked}/${writes.length} writes; allowed pricing POST: ${allowedOk}`,
  );
  return ok;
}

async function checkParticipations(): Promise<boolean> {
  console.log('3) Probing marketplace participations (read-only)…');
  try {
    const parts = await getMarketplaceParticipations();
    const active = new Set(
      parts.filter((p) => p.participation?.isParticipating).map((p) => p.marketplace?.countryCode),
    );
    const monitored = MONITORED_COUNTRY_CODES.filter((c) => active.has(c));
    console.log(`   OK — monitored marketplaces available: ${monitored.join(', ') || 'none'}`);
    return true;
  } catch (err) {
    console.error(`   FAILED — ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const guardOk = checkGuardrail();
  const authOk = await checkAuth();
  const partsOk = authOk ? await checkParticipations() : false;
  console.log(
    `\nresult: guardrail ${guardOk ? 'PASS' : 'FAIL'}, auth ${authOk ? 'PASS' : 'FAIL'}, participations ${partsOk ? 'PASS' : 'FAIL'}`,
  );
  process.exitCode = guardOk && authOk && partsOk ? 0 : 1;
}

void main();
