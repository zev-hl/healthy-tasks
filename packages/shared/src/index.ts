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
  firstName: string;
  lastName: string;
  title: string | null;
}

/**
 * Richer directory entry returned by GET /api/users/active. Superset of
 * `TaskUserRef` with the reporting/role fields that power team views (My Day
 * team strip, "reporting to me"). The embedded `TaskUserRef` stays minimal;
 * only this list carries org structure. Visible to any authenticated user.
 */
export interface ActiveUserDto extends TaskUserRef {
  supervisorId: string | null;
  role: Role;
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

// ---------------------------------------------------------------------------
// Search, filtering, sorting, pagination (Phase 6)
// ---------------------------------------------------------------------------

/** Default page size for paged screens (Task Search and Users). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type SortDirection = 'asc' | 'desc';

/** A generic paged response envelope, reused by the Task Search and Users lists. */
export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  page: number; // 1-based
  pageSize: number;
}

/** Per-user persisted screen state lives under one of these keys. */
export const SCREEN_KEYS = ['task-search', 'users'] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

// --- Task Search columns ---------------------------------------------------

/**
 * The result-grid columns. All are reorderable/hideable. `parentChild` is the
 * combined Parent/Child indicator column; `tags` is a display-only chip column.
 */
export const TASK_COLUMN_KEYS = [
  'id',
  'name',
  'status',
  'statusChangedAt',
  'priority',
  'assignee',
  'creator',
  'createdAt',
  'startAt',
  'dueAt',
  'parentChild',
  'tags',
] as const;
export type TaskColumnKey = (typeof TASK_COLUMN_KEYS)[number];

export const TASK_COLUMN_LABELS: Record<TaskColumnKey, string> = {
  id: 'Task Id',
  name: 'Task Name',
  status: 'Status',
  statusChangedAt: 'Status Changed',
  priority: 'Priority',
  assignee: 'Assignee',
  creator: 'Creator',
  createdAt: 'Created',
  startAt: 'Start',
  dueAt: 'Due',
  parentChild: 'Parent / Child',
  tags: 'Tags',
};

/** Default left-to-right column order (mirrors the spec's column order, tags last). */
export const DEFAULT_TASK_COLUMN_ORDER: TaskColumnKey[] = [...TASK_COLUMN_KEYS];
/** All columns visible by default. */
export const DEFAULT_VISIBLE_TASK_COLUMNS: TaskColumnKey[] = [...TASK_COLUMN_KEYS];

/**
 * Sortable task fields. Excludes `tags` (array — not meaningfully sortable) and
 * maps `parentChild` to the underlying `parentId`. Every other column is sortable.
 */
export const TASK_SORT_FIELDS = [
  'id',
  'name',
  'status',
  'statusChangedAt',
  'priority',
  'assignee',
  'creator',
  'createdAt',
  'startAt',
  'dueAt',
  'parentChild',
] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export interface TaskSort {
  field: TaskSortField;
  dir: SortDirection;
}

/**
 * Parent/Child relationship bucket (Phase 7 dashboard). Every task falls into
 * exactly one bucket, matching the Task Search grid's display priority:
 *  - `child`      → has a parent (parentId set), regardless of its own children
 *  - `parent`     → no parent but has at least one child (a hierarchy root)
 *  - `standalone` → no parent and no children
 * These partition the result set, so their counts sum to the total.
 */
export const TASK_RELATION_FILTERS = ['parent', 'child', 'standalone'] as const;
export type TaskRelationFilter = (typeof TASK_RELATION_FILTERS)[number];

export interface TaskSearchFilters {
  /** Selected assignee user ids; empty = no assignee filter. */
  assigneeIds?: string[];
  /** Include tasks with no assignee (the "Unassigned" option). */
  includeUnassigned?: boolean;
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  tags?: string[]; // task must have at least one of these
  statusChangedFrom?: string | null; // ISO
  statusChangedTo?: string | null;
  startFrom?: string | null;
  startTo?: string | null;
  /** Include tasks with no Start Date (default true). */
  includeNoStart?: boolean;
  dueFrom?: string | null;
  dueTo?: string | null;
  /** Include tasks with no Due Date (default true). */
  includeNoDue?: boolean;
  // --- Dashboard quick-filters (Phase 7) -----------------------------------
  // These are applied by clicking a dashboard count. `overdue` and
  // `completedToday` are evaluated against the request's `now`/`todayStart`/
  // `todayEnd` context (below) so the user's local time zone is respected.
  /** Not Completed/Canceled AND Due Date earlier than `now`. */
  overdue?: boolean;
  /** Status Completed AND Status-changed within [todayStart, todayEnd). */
  completedToday?: boolean;
  /** Restrict to a Parent/Child relationship bucket. */
  relation?: TaskRelationFilter;
  /** Selected creator user ids; empty = no creator filter ("Created by me"). */
  creatorIds?: string[];
  /** Only tasks with an incomplete blocker (a non-terminal `isBlockedBy`). */
  blocked?: boolean;
}

export interface TaskSearchRequest {
  text?: string;
  filters?: TaskSearchFilters;
  sort?: TaskSort[];
  page?: number;
  pageSize?: number;
  /**
   * When true, results are nested: every child in the result set is grouped
   * under its parent (across the whole set, not just the page), each sibling
   * layer following the same sort order, and the nested sequence is paginated.
   */
  nest?: boolean;
  // Client-supplied clock context for the time-relative quick-filters
  // (`overdue`, `completedToday`). Computed in the browser so "now" and the
  // current calendar day reflect the user's local time zone. Ignored unless the
  // corresponding quick-filter is active.
  now?: string; // ISO instant
  todayStart?: string; // ISO instant — local midnight today
  todayEnd?: string; // ISO instant — local midnight tomorrow
}

// ---------------------------------------------------------------------------
// Search dashboard (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Request for the Task Search dashboard counts. Carries the same text + filters
 * as a search, plus the browser-computed clock context used for the Overdue and
 * Completed-Today tallies. `sort`/`page`/`nest` are irrelevant to counts and so
 * are omitted — the dashboard always reflects the entire filtered result set.
 */
export interface TaskDashboardRequest {
  text?: string;
  filters?: TaskSearchFilters;
  now: string; // ISO instant
  todayStart: string; // ISO instant — local midnight today
  todayEnd: string; // ISO instant — local midnight tomorrow
}

/**
 * Counts for the current filtered/searched result set. `parent + child +
 * standalone === total`, and the `byStatus` values also sum to `total`.
 */
export interface TaskDashboardDto {
  total: number;
  parent: number;
  child: number;
  standalone: number;
  byStatus: Record<TaskStatus, number>;
  overdue: number;
  completedToday: number;
  dueToday: number;
}

/** One row of the Task Search grid (the data behind all 12 columns). */
export interface TaskRowDto {
  id: number;
  name: string;
  status: TaskStatus;
  statusChangedAt: string | null;
  priority: TaskPriority;
  assignee: TaskUserRef | null;
  creator: TaskUserRef;
  createdAt: string;
  startAt: string | null;
  dueAt: string | null;
  parentId: number | null;
  childrenCount: number;
  tags: string[];
  /** Nesting depth in nested (tree) mode; 0 in flat mode. */
  depth?: number;
}

// --- Users screen filtering/sorting ----------------------------------------

export const USER_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'title',
  'supervisor',
  'role',
  'status',
] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export interface UserSort {
  field: UserSortField;
  dir: SortDirection;
}

export type UserStatusFilter = 'active' | 'inactive' | 'all';

export interface UserSearchFilters {
  // Free-text substring match across name + email (toolbar search box).
  query?: string;
  // Text-like columns filter by an exact multi-select of distinct values.
  firstName?: string[];
  lastName?: string[];
  email?: string[];
  title?: string[];
  supervisorIds?: string[]; // match users whose supervisor is one of these
  roles?: Role[];
  status?: UserStatusFilter;
}

/** Roster-wide active/inactive tallies for the Users header (ignores filters). */
export interface UserCountsDto {
  active: number;
  inactive: number;
}

/** Distinct values available for each Users-screen filter checklist. */
export interface UserFilterOptions {
  firstName: string[];
  lastName: string[];
  email: string[];
  title: string[];
  supervisors: TaskUserRef[]; // users who supervise at least one person
}

export interface UserSearchRequest {
  filters?: UserSearchFilters;
  sort?: UserSort[];
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Notifications (Phase 8)
// ---------------------------------------------------------------------------

/** The three notification lists. Also the keys for per-list preferences. */
export const NOTIFICATION_LISTS = ['mentioned', 'reminders', 'assigned'] as const;
export type NotificationList = (typeof NOTIFICATION_LISTS)[number];

export const NOTIFICATION_LIST_LABELS: Record<NotificationList, string> = {
  mentioned: 'Mentioned',
  reminders: 'Reminders',
  assigned: 'Assigned',
};

/** Read/unread filter offered on the Mentioned list. */
export const MENTIONED_FILTERS = ['all', 'unread', 'read'] as const;
export type MentionedFilter = (typeof MENTIONED_FILTERS)[number];

/** Whether an Assigned entry was for the user being added or removed as assignee. */
export type AssignAction = 'added' | 'removed';

/** A row in the Mentioned list (from a comment @mention). */
export interface MentionedNotificationDto {
  id: string; // Notification id (for mark-read)
  taskId: number;
  taskName: string;
  commentAt: string; // ISO — the comment's timestamp
  commenter: TaskUserRef;
  commentHtml: string; // sanitized rich-text body
  read: boolean;
}

/** A row in the Reminders list (a personal reminder that has become due). */
export interface ReminderNotificationDto {
  id: string; // Reminder id (for mark-read / remove)
  taskId: number;
  taskName: string;
  startAt: string | null; // ISO — the task's Start Date & Time
  priority: TaskPriority;
  leadMinutes: number;
  read: boolean;
}

/** A row in the Assigned list (assignee added/removed). */
export interface AssignedNotificationDto {
  id: string; // Notification id (for mark-read)
  taskId: number;
  taskName: string;
  startAt: string | null; // ISO — the task's Start Date & Time
  dueAt: string | null; // ISO — the task's Due Date & Time
  priority: TaskPriority;
  action: AssignAction;
  actor: TaskUserRef | null; // who assigned/unassigned (null for legacy rows)
  blockedByCount: number; // open blockers on the task
  createdAt: string; // ISO
  read: boolean;
}

/** The full Notifications screen payload. */
export interface NotificationsDto {
  mentioned: MentionedNotificationDto[];
  reminders: ReminderNotificationDto[];
  assigned: AssignedNotificationDto[];
}

/** Unread tallies used by the bell badge (total) and, if useful, per list. */
export interface UnreadCountDto {
  total: number;
  mentioned: number;
  reminders: number;
  assigned: number;
}

// --- Reminders (task-detail management) ------------------------------------

/**
 * Preset lead times offered when adding a reminder, in minutes before the
 * task's Start Date & Time. Stored as a raw minute count so custom values
 * remain representable.
 */
export const REMINDER_LEAD_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At start time' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

/** Human label for a lead time (falls back to "N minutes before"). */
export function reminderLeadLabel(minutes: number): string {
  return (
    REMINDER_LEAD_OPTIONS.find((o) => o.minutes === minutes)?.label ??
    `${minutes} minutes before`
  );
}

/** The current user's reminder on a task (shown on the Task Detail page). */
export interface ReminderDto {
  id: string;
  taskId: number;
  leadMinutes: number;
  createdAt: string; // ISO
}

export interface AddReminderRequest {
  leadMinutes: number;
}

/** Snooze a due reminder for `minutes` from now; it re-surfaces after that. */
export interface SnoozeReminderRequest {
  minutes: number;
}

/** Preset snooze durations offered on a due reminder (minutes from now). */
export const REMINDER_SNOOZE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
  { minutes: 1440, label: 'Tomorrow' },
];

// --- Notification preferences (user profile) -------------------------------

/** Per-list opt-in plus a per-list "also email me" flag. */
export interface NotificationPreferencesDto {
  mentionedInApp: boolean;
  mentionedEmail: boolean;
  remindersInApp: boolean;
  remindersEmail: boolean;
  assignedInApp: boolean;
  assignedEmail: boolean;
}

export type UpdateNotificationPreferencesRequest = Partial<NotificationPreferencesDto>;
