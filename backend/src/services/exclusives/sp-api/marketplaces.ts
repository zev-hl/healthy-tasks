import type { ExclusivesMarketplace } from '@healthy-tasks/shared';

// We monitor US and Canada only. Amazon marketplace ids used for SP-API calls,
// and the country codes SP-API returns for them.
export const AMAZON_MARKETPLACE_ID: Record<ExclusivesMarketplace, string> = {
  USA: 'ATVPDKIKX0DER',
  Canada: 'A2EUQ1WTGCTBG2',
};

export const MARKETPLACE_COUNTRY_CODE: Record<ExclusivesMarketplace, string> = {
  USA: 'US',
  Canada: 'CA',
};

export const MONITORED_MARKETPLACE_IDS = Object.values(AMAZON_MARKETPLACE_ID);
export const MONITORED_COUNTRY_CODES = Object.values(MARKETPLACE_COUNTRY_CODE);
