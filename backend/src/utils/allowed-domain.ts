/**
 * The company-domain rule (Chunk 3).
 *
 * Only addresses in `GOOGLE_ALLOWED_DOMAIN` may use SIGN IN WITH GOOGLE.
 *
 * It guards that one door and no other. Email and password sign-in stays open
 * to every account, whatever its address — which is the point of keeping both
 * ways in: someone without a company Google account, such as a contractor, can
 * still be given an HL Central account and a password.
 *
 * On the Google door it sits alongside an Internal consent screen rather than
 * instead of it. Google's own restriction depends on how the Cloud project is
 * configured, and is absent entirely while a project is set to External — this
 * check holds either way.
 *
 * Blank disables it, which is the default.
 */
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Test seam. The rule has to be switchable at RUN time, not read once at
 * import: the integration suite seeds users at @test.local, so a domain fixed
 * for the whole process would fail every other test in the file.
 */
let override: string | null = null;

export function __setAllowedDomain(domain: string): () => void {
  override = domain.trim().toLowerCase();
  return () => {
    override = null;
  };
}

function allowedDomain(): string {
  return override ?? env.google.allowedDomain;
}

export function emailDomainAllowed(email: string): boolean {
  const allowed = allowedDomain();
  if (!allowed) return true; // not configured: no restriction
  return email.trim().toLowerCase().endsWith(`@${allowed}`);
}

/**
 * For the Google door only. The message names the domain on purpose: it tells
 * someone using the wrong account what to do, points them at the other door,
 * and reveals nothing about whether any particular account exists here.
 */
export function assertCanSignInWithGoogle(email: string): void {
  if (emailDomainAllowed(email)) return;
  throw HttpError.forbidden(
    `Only @${allowedDomain()} Google accounts can be used to sign in. ` +
      'Use your email and password instead.',
  );
}
