/**
 * Shared contract between the backend API and the frontend SPA.
 *
 * Keep this package free of runtime dependencies — it should be safe to import
 * from both a Node server and a browser bundle. As later phases add tasks,
 * notifications, etc., their shared DTOs belong here too.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * User roles, ordered from most to least privileged.
 * This is the single source of truth; the Prisma enum mirrors these values.
 */
export const ROLES = ['Admin', 'Manager', 'Member'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that are permitted to be a supervisor of another user. */
export const SUPERVISOR_ROLES: readonly Role[] = ['Admin', 'Manager'];

export function isSupervisorRole(role: Role): boolean {
  return SUPERVISOR_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// User DTOs (what the API returns — never includes passwordHash)
// ---------------------------------------------------------------------------

export interface UserDto {
  id: string;
  email: string;
  title: string | null;
  jobDescription: string | null;
  role: Role;
  supervisorId: string | null;
  isActive: boolean;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Auth request/response shapes
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserDto;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

// ---------------------------------------------------------------------------
// Admin user-management request shapes
// ---------------------------------------------------------------------------

export interface CreateUserRequest {
  email: string;
  role: Role;
  title?: string | null;
  jobDescription?: string | null;
  supervisorId?: string | null;
}

export interface UpdateUserRequest {
  title?: string | null;
  jobDescription?: string | null;
  role?: Role;
  supervisorId?: string | null;
}

/**
 * Returned when an admin creates a user or triggers a reset. In dev the link is
 * also printed to the server console via the mailer; it is surfaced here so the
 * admin UI can display/copy it while no real email provider is configured.
 */
export interface AdminResetLinkResponse {
  user: UserDto;
  resetLink: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Generic API error shape
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Tasks (Phase 2)
// ---------------------------------------------------------------------------

export const TASK_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'Medium';

// Enum keys are space-free (Prisma/Postgres enum requirement); use
// TASK_STATUS_LABELS for display.
export const TASK_STATUSES = [
  'Open',
  'InProgress',
  'OnHold',
  'Review',
  'Completed',
  'Canceled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DEFAULT_TASK_STATUS: TaskStatus = 'Open';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  Open: 'Open',
  InProgress: 'In Progress',
  OnHold: 'On Hold',
  Review: 'Review',
  Completed: 'Completed',
  Canceled: 'Canceled',
};

export const TASK_NAME_MIN_LENGTH = 2;

// Statuses that count as "done" for the blocked-status rule (Phase 3).
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['Completed', 'Canceled'];
// Statuses a task may NOT be set to while it has an incomplete predecessor.
export const BLOCKED_RESTRICTED_STATUSES: readonly TaskStatus[] = ['Review', 'Completed'];

/** Minimal user reference embedded in a task for display (creator/assignee). */
export interface TaskUserRef {
  id: string;
  email: string;
  title: string | null;
}

export interface TaskDto {
  id: number;
  name: string;
  description: string | null;
  creatorId: string;
  creator: TaskUserRef;
  assigneeId: string | null;
  assignee: TaskUserRef | null;
  parentId: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  statusChangedAt: string | null; // ISO-8601, null until first status change
  tags: string[];
  startAt: string | null; // ISO-8601
  dueAt: string | null; // ISO-8601
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Compact task reference for relationship display (id + name + status). */
export interface TaskRef {
  id: number;
  name: string;
  status: TaskStatus;
}

/**
 * Full task view returned by GET /api/tasks/:id, including its relationships.
 * `children` is derived (tasks whose parent is this one). `blocks` /
 * `isBlockedBy` come from the separate dependency graph.
 */
export interface TaskDetailDto extends TaskDto {
  parent: TaskRef | null;
  children: TaskRef[];
  blocks: TaskRef[];
  isBlockedBy: TaskRef[];
}

// --- Relationship request shapes (Phase 3) ---------------------------------

export type DependencyType = 'blocks' | 'blockedBy';

export interface SetParentRequest {
  parentId: number;
}

export interface DependencyRequest {
  type: DependencyType;
  otherTaskId: number;
}

export interface CreateTaskRequest {
  name: string;
  description?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  tags?: string[];
  startAt?: string | null;
  dueAt?: string | null;
}

/** All fields optional; id, creator, and createdAt are immutable and omitted. */
export interface UpdateTaskRequest {
  name?: string;
  description?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  tags?: string[];
  startAt?: string | null;
  dueAt?: string | null;
}
