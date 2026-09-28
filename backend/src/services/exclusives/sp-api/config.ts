// The settings every SP-API call needs. The app boots without them (Amazon is
// only wired up where Exclusives runs), so work that calls Amazon checks first.
export interface SpApiConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  merchantToken?: string;
}

const REQUIRED: Array<[keyof SpApiConfig, string]> = [
  ['clientId', 'SP_API_CLIENT_ID'],
  ['clientSecret', 'SP_API_CLIENT_SECRET'],
  ['refreshToken', 'SP_API_REFRESH_TOKEN'],
  ['merchantToken', 'SP_API_MERCHANT_TOKEN'],
];

/** Env var names of the SP-API settings that are missing (empty = ready). */
export function missingSpApiConfig(cfg: SpApiConfig): string[] {
  return REQUIRED.filter(([key]) => !cfg[key]).map(([, name]) => name);
}
