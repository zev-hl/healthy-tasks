import type { User } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { signAccessToken } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateResetToken, hashToken, durationToMs } from '../utils/tokens.js';
import { verifyGoogleIdToken } from './google-auth.service.js';
import { assertCanSignInWithGoogle } from '../utils/allowed-domain.js';

/** Authenticate by email + password; returns the user and a signed JWT. */
export async function login(
  email: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Uniform failure for both "no such user" and "wrong password" to avoid
  // leaking which emails exist. Still run a hash comparison to reduce timing
  // signal when the user is missing.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await verifyPassword(password, hash);

  if (!user || !ok) {
    throw HttpError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    throw HttpError.forbidden('This account has been deactivated');
  }
  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    tv: user.tokenVersion,
  });
  return { user, token };
}

/**
 * Sign in with a Google ID token.
 *
 * Google answers one question — is this really that person — and nothing more.
 * Being allowed IN is still ours to decide: the account must already exist here
 * and be active. Signing in with Google never creates an account, which is what
 * keeps "admins create users, there is no self-registration" true.
 *
 * Matching is by Google's permanent subject id first, email second. The first
 * successful sign-in records that id, so a reused email address can never give
 * a new hire a leaver's account.
 */
export async function loginWithGoogle(idToken: string): Promise<{ user: User; token: string }> {
  const identity = await verifyGoogleIdToken(idToken);

  // An unverified address proves nothing about who holds it.
  if (!identity.emailVerified) {
    throw HttpError.unauthorized('That Google account has no verified email address.');
  }
  // Checked on the address Google reported, before any lookup: an outside
  // Google account is turned away without so much as a query. Note this guards
  // the Google door ONLY — the same person may still have a password account.
  assertCanSignInWithGoogle(identity.email);

  const bySub = await prisma.user.findUnique({
    where: { googleSub: identity.googleSub },
  });
  const user = bySub ?? (await prisma.user.findUnique({ where: { email: identity.email } }));

  if (!user) {
    throw HttpError.unauthorized(
      'There is no HL Central account for that Google address. Ask an administrator to add you.',
    );
  }
  if (!user.isActive) {
    throw HttpError.forbidden('This account has been deactivated');
  }
  // Found by email, but already tied to a DIFFERENT Google account: the address
  // has been reused. Refuse rather than hand over the previous holder's account.
  if (user.googleSub && user.googleSub !== identity.googleSub) {
    throw HttpError.unauthorized(
      'That email address belongs to a different Google account here. Ask an administrator.',
    );
  }

  // First sign-in: link this account to the Google identity from now on.
  if (!user.googleSub) {
    await prisma.user.update({
      where: { id: user.id },
      data: { googleSub: identity.googleSub },
    });
  }

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    tv: user.tokenVersion,
  });
  return { user, token };
}

export interface ResetTicket {
  rawToken: string;
  resetLink: string;
  expiresAt: Date;
}

/**
 * Create a password-reset token for a user and return the raw link. The caller
 * decides whether to email it (forgot-password flow) and/or surface it to an
 * admin. Only the token hash is stored.
 */
export async function createPasswordReset(userId: string): Promise<ResetTicket> {
  const { raw, hash } = generateResetToken();
  const expiresAt = new Date(Date.now() + durationToMs(env.passwordResetExpiresIn));

  // Invalidate any previously-issued, still-valid tokens for this user.
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hash, expiresAt },
  });

  const resetLink = `${env.frontendUrl}/reset-password?token=${raw}`;
  return { rawToken: raw, resetLink, expiresAt };
}

/**
 * Look up a user by email for the forgot-password flow. Returns null when the
 * email is unknown or inactive — callers must NOT reveal which case occurred.
 */
export async function findResettableUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;
  return user;
}

/**
 * Consume a reset token and set a new password. Bumps tokenVersion so any
 * existing sessions are invalidated once the password changes.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw HttpError.badRequest('This reset link is invalid or has expired');
  }
  if (!record.user.isActive) {
    throw HttpError.forbidden('This account has been deactivated');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
}
