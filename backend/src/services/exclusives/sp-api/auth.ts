import { env } from '../../../config/env.js';
import { SpApiAuthError } from './errors.js';
import { fetchWithRetry, parseBody } from './http.js';

const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
// Refresh a little before the 1h expiry so calls never race a stale token.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cache: CachedToken | null = null;

function credentials() {
  const { clientId, clientSecret, refreshToken } = env.amazon;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new SpApiAuthError(
      'SP-API credentials are not configured. Set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET and SP_API_REFRESH_TOKEN.',
    );
  }
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt - REFRESH_SKEW_MS > now) {
    return cache.accessToken;
  }

  const { clientId, clientSecret, refreshToken } = credentials();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  // Same timeout + transient retry as SP-API calls; a 4xx here (e.g. a revoked
  // refresh token) is final.
  const res = await fetchWithRetry('LWA token refresh', TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new SpApiAuthError(`LWA token refresh failed (${res.status}): ${res.text.slice(0, 300)}`);
  }

  const json = parseBody(res.text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new SpApiAuthError('LWA token response did not include an access_token.');
  }

  cache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cache.accessToken;
}

export function clearTokenCache(): void {
  cache = null;
}
