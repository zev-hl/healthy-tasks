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
  // Phase 10 review workflow. All null unless the task is currently in Review.
  // reviewInitiator = who sent it to Review (audit/context only).
  // priorAssignee / priorStatus = what to restore when it leaves Review.
  reviewInitiatorId: string | null;
  reviewInitiator: TaskUserRef | null;
  priorAssigneeId: string | null;
  priorAssignee: TaskUserRef | null;
  priorStatus: TaskStatus | null;
  // Phase 11: set on tasks generated from a template. `instanceLabel` is the
  // PO/batch label (also prefixed onto `name`); `templateId` traces the source.
  instanceLabel: string | null;
  templateId: number | null;
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
  // Phase 11: this task's own recurrence rule (null unless it is set to recur),
  // plus how it relates to a recurring series it may belong to.
  recurrence: TaskRecurrenceDto | null;
  /** If this task is a generated occurrence, the source (definition) task id. */
  recurrenceSourceId: number | null;
  /** 1-based occurrence index if this task is a generated recurrence instance. */
  recurrenceSeq: number | null;
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
  // Phase 10: required by the server only on a transition INTO Review — the
  // chosen reviewer becomes the temporary assignee.
  reviewerId?: string | null;
  // Phase 10: Gantt-drag date edits set this so the server coalesces the
  // History entry with a recent one (same user+task+field within 60s) instead
  // of logging every intermediate drag position.
  coalesceHistory?: boolean;
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
  // Phase 11: task generated from a template (provenance, on the root task).
  template: 'template',
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
  template: 'Template',
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
  // --- Template provenance (Phase 11) --------------------------------------
  /** Case-insensitive substring match on a generated task's instance label. */
  instanceLabel?: string;
  /** Restrict to tasks generated from this template. */
  templateId?: number;
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
  /** Phase 10: ids of the tasks this one is blocked by, for Gantt dependency arrows. */
  blockedByIds: number[];
  /** Phase 11: PO/batch label for a template-generated task (null otherwise). */
  instanceLabel: string | null;
  /** Phase 11: source template id for a generated task (null otherwise). */
  templateId: number | null;
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
  /**
   * Phase 11: true when the recurrence background timer has gone stale (stopped
   * ticking). Surfaced on the heartbeat every client already polls so the app
   * can show a global "contact an admin" banner to everyone, not just admins.
   */
  schedulerDown: boolean;
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

// ---------------------------------------------------------------------------
// Task templates & recurring tasks (Phase 11)
// ---------------------------------------------------------------------------

// A template is a reusable, non-live definition — never a real Task until
// instantiated. Only Admin/Manager may manage templates (enforced in service +
// route + UI). Recurrence is configured per template and comes in two flavours.
export const RECURRENCE_TYPES = ['None', 'Fixed', 'RelativeToCompletion'] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];
export const RECURRENCE_TYPE_LABELS: Record<RecurrenceType, string> = {
  None: 'No recurrence (manual only)',
  Fixed: 'Fixed calendar schedule',
  RelativeToCompletion: 'Relative to prior completion',
};

export const RECURRENCE_UNITS = ['Day', 'Week', 'Month'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];
export const RECURRENCE_UNIT_LABELS: Record<RecurrenceUnit, string> = {
  Day: 'day(s)',
  Week: 'week(s)',
  Month: 'month(s)',
};

export const RECURRENCE_END_TYPES = ['Never', 'OnDate', 'AfterOccurrences'] as const;
export type RecurrenceEndType = (typeof RECURRENCE_END_TYPES)[number];

export const TEMPLATE_OCCURRENCE_ORIGINS = ['manual', 'scheduled'] as const;
export type TemplateOccurrenceOrigin = (typeof TEMPLATE_OCCURRENCE_ORIGINS)[number];

/** Default lead time (days) before an occurrence's anchor to auto-materialize. */
export const DEFAULT_TEMPLATE_LEAD_DAYS = 14;

/**
 * How far ahead ghost previews are computed for an indefinite (`Never`-ending)
 * fixed schedule, so a never-ending series doesn't produce an unbounded list.
 * Bounded series (end date / max occurrences) show all remaining occurrences.
 */
export const GHOST_HORIZON_OCCURRENCES = 24;

/** One definition node in a template tree (mirrors a real Task in the hierarchy). */
export interface TemplateNodeDto {
  id: number;
  parentNodeId: number | null;
  name: string;
  description: string | null;
  defaultPriority: TaskPriority;
  /** Day offsets from the occurrence anchor; null ⇒ that date is left unset. */
  startOffsetDays: number | null;
  dueOffsetDays: number | null;
  /** Free-text job-role placeholder, resolved to a real user at instantiation. */
  assigneeRole: string | null;
  orderIndex: number;
}

/** A dependency edge between two nodes of the same template (blocker → blocked). */
export interface TemplateDependencyDto {
  id: number;
  blockerNodeId: number;
  blockedNodeId: number;
}

/** A materialized instantiation of a template into a real task tree. */
export interface TemplateOccurrenceDto {
  id: number;
  /** 1-based schedule index for a scheduled occurrence; null for a manual one. */
  seq: number | null;
  origin: TemplateOccurrenceOrigin;
  instanceLabel: string | null;
  anchorStart: string; // ISO
  rootTaskId: number | null;
  materializedAt: string; // ISO
}

/** Full template with its tree, dependencies, and a summary of its occurrences. */
export interface TemplateDto {
  id: number;
  name: string;
  description: string | null;
  createdBy: TaskUserRef;
  recurrenceType: RecurrenceType;
  intervalCount: number | null;
  intervalUnit: RecurrenceUnit | null;
  anchorDate: string | null; // ISO
  endType: RecurrenceEndType;
  endDate: string | null; // ISO
  maxOccurrences: number | null;
  leadTimeDays: number;
  labelPrefix: string | null;
  isActive: boolean;
  nodes: TemplateNodeDto[];
  dependencies: TemplateDependencyDto[];
  occurrences: TemplateOccurrenceDto[];
  /** Distinct assignee-role placeholders across the tree (for the instantiation form). */
  roles: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Compact row for the template management list. */
export interface TemplateSummaryDto {
  id: number;
  name: string;
  description: string | null;
  createdBy: TaskUserRef;
  recurrenceType: RecurrenceType;
  isActive: boolean;
  nodeCount: number;
  occurrenceCount: number;
  updatedAt: string; // ISO
}

/**
 * A computed, not-yet-materialized future occurrence (a "ghost"). Never a DB
 * row: produced on the fly for Fixed schedules and shown as a light/dashed
 * preview in Gantt and Calendar (never Kanban). A ghost comes from either a
 * recurring TASK (its future copies) or a recurring TEMPLATE (future
 * instantiations); `sourceType` + `sourceId` say which and drive materialization.
 * A ghost is, by definition, a future occurrence whose earliest date (start or
 * due) is more than the lead time out — nearer ones auto-materialize into real
 * tasks and so appear as normal bars, not ghosts.
 */
export interface GhostOccurrenceDto {
  sourceType: 'task' | 'template';
  /** The recurring task id, or the template id. */
  sourceId: number;
  sourceName: string;
  /** 1-based occurrence index this ghost would take when materialized. */
  seq: number;
  /** The occurrence's display name (label-prefixed for templates). */
  name: string;
  startAt: string | null; // ISO
  dueAt: string | null; // ISO
  priority: TaskPriority;
  /** Within the auto-materialization window (earliest date − leadTimeDays ≤ now). */
  withinLeadTime: boolean;
}

// --- Request shapes --------------------------------------------------------

/** A node in a create/update template request. `id` present ⇒ update an existing
 * node; a negative/absent id ⇒ a new node. `parentRef` links to another node in
 * the same payload by its (client) id, since server ids aren't known yet. */
export interface TemplateNodeInput {
  id?: number;
  /** Client-local key used to express parent/dependency links within the payload. */
  key: string;
  parentKey: string | null;
  name: string;
  description?: string | null;
  defaultPriority?: TaskPriority;
  startOffsetDays?: number | null;
  dueOffsetDays?: number | null;
  assigneeRole?: string | null;
  orderIndex?: number;
}

/** A dependency edge in a create/update request, by client-local node keys. */
export interface TemplateDependencyInput {
  blockerKey: string;
  blockedKey: string;
}

export interface RecurrenceInput {
  recurrenceType: RecurrenceType;
  intervalCount?: number | null;
  intervalUnit?: RecurrenceUnit | null;
  anchorDate?: string | null; // ISO
  endType?: RecurrenceEndType;
  endDate?: string | null; // ISO
  maxOccurrences?: number | null;
  leadTimeDays?: number;
  labelPrefix?: string | null;
  isActive?: boolean;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string | null;
  nodes: TemplateNodeInput[];
  dependencies?: TemplateDependencyInput[];
  recurrence?: RecurrenceInput;
}

export type UpdateTemplateRequest = Partial<CreateTemplateRequest>;

/** Maps a role placeholder label to the real user that fills it this instantiation. */
export interface RoleAssignment {
  role: string;
  assigneeId: string | null;
}

/** Manual instantiation of a template into a real, independent task tree. */
export interface InstantiateTemplateRequest {
  /** PO/order/batch label; prefixed onto every generated task name + stored on each. */
  instanceLabel?: string | null;
  /** Concrete anchor (instantiation date) that resolves the relative offsets. */
  anchorStart: string; // ISO
  /** Resolve each role placeholder to a real user. Unmapped roles ⇒ unassigned. */
  roleAssignments?: RoleAssignment[];
}

/** Materialize a specific ghost occurrence into real tasks (click-through). */
export interface MaterializeGhostRequest {
  seq: number;
}

/**
 * Scope choice when editing a template that already has instances, mirroring
 * how Google Calendar scopes recurring-event edits. There is deliberately NO
 * "all including past" option — past/completed instances are never rewritten.
 */
export const TEMPLATE_EDIT_SCOPES = ['thisAndFollowing'] as const;
export type TemplateEditScope = (typeof TEMPLATE_EDIT_SCOPES)[number];

/** Re-sync already-materialized FUTURE occurrences to the current template. */
export interface ApplyToFutureRequest {
  /** The occurrence ids the user confirmed should be updated to match. */
  occurrenceIds: number[];
}

/** A future materialized occurrence that could be re-synced to the template. */
export interface FutureOccurrenceDto {
  occurrenceId: number;
  seq: number | null;
  instanceLabel: string | null;
  anchorStart: string; // ISO
  rootTaskId: number | null;
  rootName: string | null;
  rootStatus: TaskStatus | null;
  taskCount: number;
}

/** Result of applying a template edit to already-materialized future instances. */
export interface ApplyToFutureResultDto {
  updatedOccurrences: number;
  updatedTasks: number;
}

/** Result of a manual instantiation or a ghost materialization. */
export interface InstantiateResultDto {
  occurrence: TemplateOccurrenceDto;
  rootTaskId: number;
  taskIds: number[];
}

// --- Task-level recurrence (a regular task set to recur) --------------------

/** A recurrence rule attached directly to a task (the task = occurrence #1). */
export interface TaskRecurrenceDto {
  recurrenceType: Exclude<RecurrenceType, 'None'>;
  intervalCount: number;
  intervalUnit: RecurrenceUnit;
  anchorDate: string; // ISO — the source task's earliest date (start ?? due)
  endType: RecurrenceEndType;
  endDate: string | null; // ISO
  maxOccurrences: number | null; // counts the source as #1
  leadTimeDays: number;
  isActive: boolean;
  /** Generated future instances materialized so far (excludes the source #1). */
  occurrenceCount: number;
}

/** Set or update a task's recurrence. anchorDate is derived server-side from the
 * task's earliest date, so it is never supplied here. */
export interface SetTaskRecurrenceRequest {
  recurrenceType: Exclude<RecurrenceType, 'None'>;
  intervalCount: number;
  intervalUnit: RecurrenceUnit;
  endType?: RecurrenceEndType;
  endDate?: string | null; // ISO
  maxOccurrences?: number | null;
  leadTimeDays?: number;
  isActive?: boolean;
}
