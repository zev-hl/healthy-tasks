/**
 * The company-domain rule (Chunk 3).
 *
 * `GOOGLE_ALLOWED_DOMAIN` decides who may use SIGN IN WITH GOOGLE: only
 * addresses inside the domain. Everyone else is refused at that door and uses
 * email and password.
 *
 * Company accounts are Google-FIRST, not Google-only:
 *
 *   • Created with no password, and told so in a welcome message rather than
 *     being sent a reset link nobody needs.
 *   • "Forgot password" is refused for them — there is nothing to forget, and
 *     it would quietly mint a credential the policy did not ask for.
 *   • But an ADMIN may still send them a reset link deliberately, and once they
 *     have a password it works at the form like anyone else's. That is the way
 *     back in when Google is unreachable or an account is locked out there.
 *
 * So the difference between the two groups is what happens by DEFAULT, not what
 * is possible: nobody is left without a route in.
 *
 * On the Google side this sits alongside an Internal consent screen rather than
 * instead of it. Google's own restriction depends on how the Cloud project is
 * configured, and is absent entirely while a project is set to External — this
 * check holds either way.
 *
 * Blank disables the split, and then every account uses a password.
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

/**
 * May this address use the GOOGLE door? True for everyone when the rule is off.
 *
 * Note the asymmetry with `isCompanyAccount` below, which is the thing to get
 * right: "allowed to use Google" and "is a company account" are the same
 * question only while a domain is configured. With the rule off, everyone may
 * use Google and NOBODY is a company account — so everyone keeps their
 * password. Collapsing the two into one helper refused every password login
 * the moment the rule was switched off.
 */
export function emailDomainAllowed(email: string): boolean {
  const allowed = allowedDomain();
  if (!allowed) return true; // not configured: no restriction
  return email.trim().toLowerCase().endsWith(`@${allowed}`);
}

/**
 * Is this one of the company accounts that sign in with Google and have no
 * password? False for everybody when no domain is configured.
 */
export function isCompanyAccount(email: string): boolean {
  const allowed = allowedDomain();
  if (!allowed) return false; // rule off: nobody is Google-only
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

/**
 * Refuses SELF-SERVICE password recovery for a company account.
 *
 * Used by "forgot password" only. Not by sign-in, because an admin may have
 * deliberately issued a password; and not by the admin's own reset button,
 * which is exactly how that happens. The point is that a company account never
 * acquires a password by accident — only because someone decided it should.
 */
export function assertCanRecoverPassword(email: string): void {
  if (!isCompanyAccount(email)) return;
  throw HttpError.forbidden(
    `@${allowedDomain()} accounts sign in with Google. ` +
      'Use the "Sign in with Google" button, or ask an administrator for a password.',
  );
}
