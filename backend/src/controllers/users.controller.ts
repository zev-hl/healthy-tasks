import type { Request, Response } from 'express';
import type { AdminResetLinkResponse, TaskUserRef, UserDto } from '@healthy-tasks/shared';
import {
  listUsers,
  listActiveUsers,
  listEligibleSupervisors,
  createUser,
  updateUser,
  deactivateUser,
  mergeUsers,
  getUserById,
} from '../services/user.service.js';
import { createPasswordReset } from '../services/auth.service.js';
import { toUserDto, toUserRef } from '../services/user.mapper.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { HttpError } from '../utils/http-error.js';
import type { CreateUserInput, MergeUsersInput, UpdateUserInput } from '../validation/schemas.js';

export async function listUsersController(_req: Request, res: Response): Promise<void> {
  const users = await listUsers();
  res.json(users.map(toUserDto) satisfies UserDto[]);
}

/**
 * Active users as minimal refs, for the task assignee picker. Available to any
 * authenticated user (not admin-only), and deliberately excludes role/supervisor
 * details.
 */
export async function listActiveUsersController(_req: Request, res: Response): Promise<void> {
  const users = await listActiveUsers();
  res.json(users.map(toUserRef) satisfies TaskUserRef[]);
}

/** Eligible supervisors (active Managers + Admins) for the create/edit UI. */
export async function listSupervisorsController(_req: Request, res: Response): Promise<void> {
  const users = await listEligibleSupervisors();
  res.json(users.map(toUserDto) satisfies UserDto[]);
}

/**
 * Create a user, then immediately issue a reset link so they can set their own
 * password. The link is emailed (console in dev) and also returned so the admin
 * UI can display it while no real email provider is configured.
 */
export async function createUserController(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateUserInput;
  const user = await createUser(input);
  const ticket = await createPasswordReset(user.id);
  await sendPasswordResetEmail(user.email, ticket.resetLink);

  const body: AdminResetLinkResponse = {
    user: toUserDto(user),
    resetLink: ticket.resetLink,
    expiresAt: ticket.expiresAt.toISOString(),
  };
  res.status(201).json(body);
}

export async function updateUserController(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as UpdateUserInput;
  const user = await updateUser(id, input);
  res.json(toUserDto(user) satisfies UserDto);
}

export async function deactivateUserController(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const user = await deactivateUser(id);
  res.json(toUserDto(user) satisfies UserDto);
}

export async function mergeUsersController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const survivor = await mergeUsers(req.user.id, req.body as MergeUsersInput);
  res.json(toUserDto(survivor) satisfies UserDto);
}

/** Admin-triggered password reset — no current password required. */
export async function adminResetPasswordController(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const user = await getUserById(id);
  const ticket = await createPasswordReset(user.id);
  await sendPasswordResetEmail(user.email, ticket.resetLink);

  const body: AdminResetLinkResponse = {
    user: toUserDto(user),
    resetLink: ticket.resetLink,
    expiresAt: ticket.expiresAt.toISOString(),
  };
  res.json(body);
}
