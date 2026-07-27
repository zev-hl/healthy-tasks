import type { User } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { signAccessToken } from '../utils/jwt.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateResetToken, hashToken, durationToMs } from '../utils/tokens.js';

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
