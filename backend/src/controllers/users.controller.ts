import type { Request, Response } from 'express';
import type {
  ActiveUserDto,
  AdminResetLinkResponse,
  OrgHierarchyNode,
  PaginatedResult,
  TaskUserRef,
  UserCountsDto,
  UserDto,
  UserFilterOptions,
} from '@healthy-tasks/shared';
import { getScopedHierarchy } from '../services/access-control.service.js';
import {
  listUsers,
  searchUsers,
  getUserCounts,
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
import {
  sendGoogleWelcomeEmail,
  sendInBackground,
  sendNewAccountEmail,
  sendPasswordResetEmail,
} from '../utils/mailer.js';
import { isCompanyAccount } from '../utils/allowed-domain.js';
import { env } from '../config/env.js';
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

/** Roster-wide active/inactive tallies for the Users header. */
export async function userCountsController(_req: Request, res: Response): Promise<void> {
  res.json((await getUserCounts()) satisfies UserCountsDto);
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

/**
 * Phase 13: the org hierarchy the caller may see/select (their own downline;
 * Admin sees everyone). Drives the Due Date report's Team Hierarchy filter.
 */
export async function userHierarchyController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const tree = await getScopedHierarchy({ id: req.user.id, role: req.user.role });
  res.json(tree satisfies OrgHierarchyNode[]);
}

/** Eligible supervisors (active Managers + Admins) for the create/edit UI. */
export async function listSupervisorsController(_req: Request, res: Response): Promise<void> {
  const users = await listEligibleSupervisors();
  res.json(users.map(toUserDto) satisfies UserDto[]);
}

/**
 * Create a user and tell them how to get in.
 *
 * Which message they get depends on whether they can use Sign in with Google:
 *
 *   • A company-domain address gets a WELCOME email. No password is set, no
 *     reset link is minted, and nothing is handed over — they sign in with the
 *     Google account they already have. Issuing a reset link here would create
 *     a credential nobody asked for and nobody needs.
 *   • Any other address gets the reset link as before, because the Google door
 *     is closed to them and a password is their only way in.
 */
export async function createUserController(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateUserInput;
  const user = await createUser(input);

  // The emails go out in the background: the user is saved either way, and the
  // admin should not wait on the mail provider to hear so.
  if (isCompanyAccount(user.email) && env.google.clientId) {
    sendInBackground(`welcome to ${user.email}`, () =>
      sendGoogleWelcomeEmail(user.email, env.frontendUrl),
    );
    const body: AdminResetLinkResponse = { user: toUserDto(user), signInMethod: 'google' };
    res.status(201).json(body);
    return;
  }

  const ticket = await createPasswordReset(user.id);
  sendInBackground(`welcome to ${user.email}`, () =>
    sendNewAccountEmail(user.email, ticket.resetLink, ticket.expiresAt),
  );
  const body: AdminResetLinkResponse = {
    user: toUserDto(user),
    resetLink: ticket.resetLink,
    expiresAt: ticket.expiresAt.toISOString(),
    signInMethod: 'password',
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

/**
 * Admin-triggered password reset — no current password required.
 *
 * Open for EVERY account, company ones included. A company account has no
 * password by default, but an admin may deliberately give it one: that is the
 * way back in if Google is unreachable or someone's Google account is locked.
 * The difference from an outside account is only what happens automatically.
 */
export async function adminResetPasswordController(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const user = await getUserById(id);
  const ticket = await createPasswordReset(user.id);
  sendInBackground(`password reset to ${user.email}`, () =>
    sendPasswordResetEmail(user.email, ticket.resetLink),
  );

  const body: AdminResetLinkResponse = {
    user: toUserDto(user),
    resetLink: ticket.resetLink,
    expiresAt: ticket.expiresAt.toISOString(),
    signInMethod: 'password',
  };
  res.json(body);
}
