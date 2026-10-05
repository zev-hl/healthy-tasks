/**
 * Verifying a Google ID token (HLAI "Sign in with Google", Chunk 1).
 *
 * The browser signs in against Google and receives an ID token — a short-lived,
 * signed statement of who the person is. It posts that to us, and this module
 * establishes that the statement is genuine before anyone is let in.
 *
 * Four things are checked, all by `verifyIdToken`:
 *   • the signature really is Google's (against their published keys)
 *   • the token has not expired
 *   • it was issued BY Google (the issuer claim)
 *   • it was issued FOR our client id (the audience claim) — without this, a
 *     token Google minted for some entirely different app would be accepted
 *
 * Nothing else is taken from the token. We do not request, receive or store an
 * access token or a refresh token, because we never act on the user's behalf
 * against Google's APIs — we only need to know who they are.
 */
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

/** What a verified token tells us about the person. */
export interface GoogleIdentity {
  /** Google's permanent, never-reissued id for this account (the `sub` claim). */
  googleSub: string;
  email: string;
  emailVerified: boolean;
  /** Hosted-domain claim: the Workspace domain, absent for a personal account. */
  hostedDomain: string | null;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

/**
 * The real thing. Lazy, so importing this module reaches no network and needs
 * no configuration — which matters because the test suite imports the app.
 */
let client: OAuth2Client | undefined;

const realVerifier: GoogleVerifier = async (idToken) => {
  if (!env.google.clientId) {
    throw HttpError.badRequest(
      'Google sign-in is not configured on this server. Use your email and password.',
    );
  }
  client ??= new OAuth2Client(env.google.clientId);

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });
    payload = ticket.getPayload();
  } catch {
    // Expired, tampered with, or minted for another app. The reason is not
    // repeated back: it would help someone probing far more than a real user.
    throw HttpError.unauthorized('Google sign-in failed. Please try again.');
  }

  if (!payload?.sub || !payload.email) {
    throw HttpError.unauthorized('Google sign-in failed. Please try again.');
  }

  return {
    googleSub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true,
    hostedDomain: payload.hd ?? null,
  };
};

/**
 * The verifier in use. Swappable the same way `storage/index.ts` swaps S3 for
 * an in-memory fake, so no test ever reaches Google — which would make the
 * suite need network access, real credentials, and a live token it cannot mint.
 */
let verifier: GoogleVerifier = realVerifier;

export function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  return verifier(idToken);
}

/** Test seam: install a fake verifier. Returns a function that restores the real one. */
export function __setGoogleVerifier(fake: GoogleVerifier): () => void {
  verifier = fake;
  return () => {
    verifier = realVerifier;
  };
}
