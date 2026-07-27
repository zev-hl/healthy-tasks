import crypto from 'node:crypto';

/**
 * Generate a cryptographically random, URL-safe reset token plus its SHA-256
 * hash. The raw token goes only into the emailed link; the hash is what we
 * persist, so a database leak never exposes usable tokens.
 */
export function generateResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse a duration string like "60m", "15m", "24h", "3600s" (or a bare number
 * of seconds) into milliseconds.
 */
export function durationToMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${duration}`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const factors: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (factors[unit] ?? 1000);
}
