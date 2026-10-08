import { spApiRequest } from './client.js';

export interface MarketplaceParticipation {
  marketplace?: { id?: string; countryCode?: string; name?: string };
  participation?: { isParticipating?: boolean };
}

interface Payload {
  payload?: MarketplaceParticipation[];
}

// Lightweight read-only connectivity probe: confirms the credentials, SP-API
// authorization, and which marketplaces the seller is approved for.
export async function getMarketplaceParticipations(): Promise<MarketplaceParticipation[]> {
  const res = await spApiRequest<Payload>({
    method: 'GET',
    path: '/sellers/v1/marketplaceParticipations',
  });
  return res.data.payload ?? [];
}
