import type { Request, Response } from 'express';
import type {
  ActiveUserDto,
  AdminResetLinkResponse,
  PaginatedResult,
  TaskUserRef,
  UserDto,
  UserFilterOptions,
} from '@healthy-tasks/shared';
import {
  listUsers,
  searchUsers,
  getUserFilterOptions,
  listActiveUsers,
  listEligibleSupervisors,
  createUser,
  updateUser,
  deactivateUser,
  mergeUsers,
  getUserById,
} from '../services/user.service.js';
import { createPasswordReset } from '../services/auth.service.js';
import { toActiveUserDto, toUserDto, toUserRef } from '../services/user.mapper.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { HttpError } from '../utils/http-error.js';
import type {
  CreateUserInput,
  MergeUsersInput,
  UpdateUserInput,
  UserSearchInput,
} from '../validation/schemas.js';

export async function listUsersController(_req: Request, res: Response): Promise<void> {
  const users = await listUsers();
  res.json(users.map(toUserDto) satisfies UserDto[]);
}

/** Users screen: filtered/sorted/paged results. */
export async function searchUsersController(req: Request, res: Response): Promise<void> {
  const { rows, total, page, pageSize } = await searchUsers(req.body as UserSearchInput);
  const body: PaginatedResult<UserDto> = { rows: rows.map(toUserDto), total, page, pageSize };
  res.json(body);
}

/** Distinct values for the Users-screen filter checklists. */
export async function userFilterOptionsController(_req: Request, res: Response): Promise<void> {
  const o = await getUserFilterOptions();
  const body: UserFilterOptions = {
    firstName: o.firstName,
    lastName: o.lastName,
    email: o.email,
    title: o.title,
    supervisors: o.supervisors.map(toUserRef),
  };
  res.json(body);
}

/**
 * Active users as minimal refs, for the task assignee picker. Available to any
 * authenticated user (not admin-only), and deliberately excludes role/supervisor
 * details.
 */
export async function listActiveUsersController(_req: Request, res: Response): Promise<void> {
  const users = await listActiveUsers();
  res.json(users.map(toActiveUserDto) satisfies ActiveUserDto[]);
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
