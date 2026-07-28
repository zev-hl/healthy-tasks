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
  firstName: string;
  lastName: string;
  title: string | null;
  jobDescription: string | null;
  role: Role;
  supervisorId: string | null;
  isActive: boolean;
  // Set when this account was merged into another (Phase 5). Non-null ⇒ the
  // account is a deactivated, redirected duplicate.
  mergedIntoId: string | null;
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
  firstName: string;
  lastName: string;
  role: Role;
  title?: string | null;
  jobDescription?: string | null;
  supervisorId?: string | null;
}

/**
 * Admin edit of an existing user. Every field is optional (PATCH semantics);
 * `email` can be changed in place (rejected if already used by another user),
 * and `isActive` toggles the account's active/deactivated status.
 */
export interface UpdateUserRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  jobDescription?: string | null;
  role?: Role;
  supervisorId?: string | null;
  isActive?: boolean;
}

/**
 * Merge two accounts believed to be the same person. `survivingId` keeps its
 * own email/login; `mergedId` is deactivated and redirected. `fieldChoices`
 * carries the admin's field-by-field pick for any differing profile fields.
 * `confirmEmail` must equal the merged (non-surviving) account's email — the
 * explicit type-to-confirm guard for this destructive action.
 */
export interface MergeUsersRequest {
  survivingId: string;
  mergedId: string;
  confirmEmail: string;
  fieldChoices: MergeFieldChoices;
}

/** The profile fields an admin resolves during a merge (the survivor's values). */
export interface MergeFieldChoices {
  firstName: string;
  lastName: string;
  title: string | null;
  jobDescription: string | null;
  role: Role;
  supervisorId: string | null;
}

/** Profile fields compared field-by-field during a merge. */
export const MERGE_FIELDS = [
  'firstName',
  'lastName',
  'title',
  'jobDescription',
  'role',
  'supervisorId',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

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
  // Phase 4: files attached to the task, and its comment thread (newest last).
  attachments: AttachmentDto[];
  comments: CommentDto[];
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

// ---------------------------------------------------------------------------
// Rich text, attachments & comments (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Max length of rich-text CONTENT (tags stripped), applied to task Descriptions
 * and comment bodies. Enforced authoritatively on the server; the editor also
 * shows a live counter.
 */
export const RICH_TEXT_MAX_CHARS = 10000;

/**
 * A retained @mention (one already present before an edit) only produces a new
 * mention event once this many minutes have passed since the last event for the
 * same (user, comment) pair. A brand-new mention always produces one. (Phase 8
 * builds the Mentioned list from these events.)
 */
export const MENTION_EVENT_DEBOUNCE_MINUTES = 15;

/** Per-file attachment size cap: 25 MB. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Allowed attachment categories: images, audio, and video (matched by MIME
 * prefix) plus this explicit document allowlist. Used by both the client
 * pre-check and the authoritative server check.
 */
export const ALLOWED_ATTACHMENT_DOCUMENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/plain',
  'text/csv',
];

/** True if `contentType` is an allowed attachment type (image/audio/video/doc). */
export function isAllowedAttachmentType(contentType: string): boolean {
  const ct = contentType.trim().toLowerCase();
  return (
    ct.startsWith('image/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ALLOWED_ATTACHMENT_DOCUMENT_TYPES.includes(ct)
  );
}

/** Metadata for a file attached to a task or a comment (bytes live in storage). */
export interface AttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: TaskUserRef;
  createdAt: string; // ISO-8601
  // Exactly one of these is set.
  taskId: number | null;
  commentId: string | null;
}

/** A comment on a task: rich-text body, author, timestamps, mentions, files. */
export interface CommentDto {
  id: string;
  taskId: number;
  author: TaskUserRef;
  body: string; // sanitized HTML
  createdAt: string; // ISO-8601
  editedAt: string | null; // non-null ⇒ show "edited"; displayed time = editedAt ?? createdAt
  mentionedUsers: TaskUserRef[];
  attachments: AttachmentDto[];
}

// --- Attachment request/response shapes ------------------------------------

/** Step 1 of an upload: ask the server for a pre-signed PUT URL. */
export interface PresignAttachmentRequest {
  filename: string;
  contentType: string;
  size: number;
}

export interface PresignAttachmentResponse {
  uploadUrl: string;
  storageKey: string;
}

/** Step 2: after PUTting the bytes, persist the attachment metadata. */
export interface ConfirmAttachmentRequest {
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
}

/** A fresh pre-signed GET URL for downloading an attachment. */
export interface AttachmentDownloadResponse {
  url: string;
  filename: string;
}

// --- Comment request shapes ------------------------------------------------

export interface CreateCommentRequest {
  body: string;
}

export interface UpdateCommentRequest {
  body: string;
}

// ---------------------------------------------------------------------------
// Change history (Phase 5)
// ---------------------------------------------------------------------------

export const TASK_HISTORY_CHANGE_TYPES = ['updated', 'added', 'removed'] as const;
export type TaskHistoryChangeType = (typeof TASK_HISTORY_CHANGE_TYPES)[number];

/**
 * Known `field` keys for a history entry. `dependency:*` and `merge` are the
 * non-obvious ones; everything else mirrors a task attribute. The string is
 * open-ended on the wire — these are the values the app produces and formats.
 */
export const TASK_HISTORY_FIELDS = {
  name: 'name',
  description: 'description',
  assignee: 'assignee',
  priority: 'priority',
  status: 'status',
  tags: 'tags',
  startAt: 'startAt',
  dueAt: 'dueAt',
  parentTask: 'parentTask',
  dependencyBlocks: 'dependency:blocks',
  dependencyBlockedBy: 'dependency:isBlockedBy',
  attachment: 'attachment',
  comment: 'comment',
  merge: 'merge',
} as const;

/** Human-readable label for a history `field` key (falls back to the key). */
export const TASK_HISTORY_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  assignee: 'Assignee',
  priority: 'Priority',
  status: 'Status',
  tags: 'Tags',
  startAt: 'Start date',
  dueAt: 'Due date',
  parentTask: 'Parent task',
  'dependency:blocks': 'Blocks',
  'dependency:isBlockedBy': 'Is blocked by',
  attachment: 'Attachment',
  comment: 'Comment',
  merge: 'Account merge',
};

/** A single change-history entry for a task, newest-first in listings. */
export interface TaskHistoryEntryDto {
  id: string;
  taskId: number;
  field: string;
  changeType: TaskHistoryChangeType;
  previousValue: string | null;
  newValue: string | null;
  detail: string | null;
  changedAt: string; // ISO-8601
  // Who made the change (null if that account was hard-deleted; normally set).
  user: TaskUserRef | null;
}
