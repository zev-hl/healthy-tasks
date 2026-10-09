import type { Request, Response } from 'express';
import type { LoginResponse, UserDto } from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import {
  login,
  loginWithGoogle,
  createPasswordReset,
  findResettableUserByEmail,
  resetPassword,
} from '../services/auth.service.js';
import { getUserById } from '../services/user.service.js';
import { assertCanRecoverPassword } from '../utils/allowed-domain.js';
import { toUserDto } from '../services/user.mapper.js';
import { sendInBackground, sendPasswordResetEmail } from '../utils/mailer.js';
import type {
  LoginInput,
  GoogleLoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from '../validation/schemas.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  const { user, token } = await login(email, password);
  const body: LoginResponse = { token, user: toUserDto(user) };
  res.json(body);
}

/**
 * With stateless JWTs there is no server session to destroy — the client
 * discards the token. This endpoint exists for symmetry and future-proofing.
 */
export async function googleLoginController(req: Request, res: Response): Promise<void> {
  const { idToken } = req.body as GoogleLoginInput;
  const { user, token } = await loginWithGoogle(idToken);
  res.json({ token, user: toUserDto(user) } satisfies LoginResponse);
}

export async function logoutController(_req: Request, res: Response): Promise<void> {
  res.status(204).send();
}

export async function meController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const user = await getUserById(req.user.id);
  res.json(toUserDto(user) satisfies UserDto);
}

/**
 * Forgot-password: always responds 200 with the same message, whether or not
 * the email exists, to avoid disclosing which addresses are registered.
 */
export async function forgotPasswordController(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;
  // A company address has no password to forget by default, and self-service
  // recovery must not quietly create one. An admin can still issue a reset.
  assertCanRecoverPassword(email);

  const user = await findResettableUserByEmail(email);
  if (user) {
    const ticket = await createPasswordReset(user.id);
    // In the background: the reply never waits on the mail provider, which also
    // keeps a registered address from answering seconds slower than an unknown one.
    sendInBackground(`password reset to ${user.email}`, () =>
      sendPasswordResetEmail(user.email, ticket.resetLink),
    );
  }
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
}

export async function resetPasswordController(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as ResetPasswordInput;
  await resetPassword(token, newPassword);
  res.json({ message: 'Your password has been updated. You can now log in.' });
}
