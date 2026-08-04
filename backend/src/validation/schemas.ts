import { z } from 'zod';
import {
  ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_NAME_MIN_LENGTH,
  TASK_SORT_FIELDS,
  TASK_RELATION_FILTERS,
  USER_SORT_FIELDS,
  MAX_PAGE_SIZE,
  RECURRENCE_TYPES,
  RECURRENCE_UNITS,
  RECURRENCE_END_TYPES,
  GOAL_METRIC_TYPES,
  GOAL_STATUSES,
  GOAL_RESOLUTIONS,
  GOAL_SPECIFIC_MIN_LENGTH,
  MATERIALIZE_LEAD_DAYS_MIN,
  MATERIALIZE_LEAD_DAYS_MAX,
} from '@healthy-tasks/shared';

export const roleSchema = z.enum(ROLES);

// Reusable field pieces
const email = z.string().trim().toLowerCase().email('A valid email is required');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long');

// --- Auth -------------------------------------------------------------------

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: password,
});

// --- Admin user management --------------------------------------------------

// Optional free-text field. Preserves `undefined` (field omitted → leave
// unchanged on PATCH); maps '' and explicit null to null.
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

// Required person-name field (First/Last name). Non-empty, trimmed.
const personName = z.string().trim().min(1, 'Required').max(100, 'Too long');

export const createUserSchema = z.object({
  email,
  firstName: personName,
  lastName: personName,
  role: roleSchema,
  title: optionalText,
  jobDescription: optionalText,
  supervisorId: z.string().uuid().optional().nullable(),
});

export const updateUserSchema = z.object({
  // Email is editable in place; uniqueness is enforced in the service.
  email: email.optional(),
  firstName: personName.optional(),
  lastName: personName.optional(),
  role: roleSchema.optional(),
  title: optionalText,
  jobDescription: optionalText,
  supervisorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// --- Account merge ----------------------------------------------------------

export const mergeUsersSchema = z.object({
  survivingId: z.string().uuid('A valid surviving account id is required'),
  mergedId: z.string().uuid('A valid merged account id is required'),
  confirmEmail: z.string().trim().toLowerCase().min(1, 'Confirmation email is required'),
  fieldChoices: z.object({
    firstName: personName,
    lastName: personName,
    title: optionalText,
    jobDescription: optionalText,
    role: roleSchema,
    supervisorId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  }),
});

export type MergeUsersInput = z.infer<typeof mergeUsersSchema>;

// --- Tasks ------------------------------------------------------------------

const taskName = z
  .string()
  .trim()
  .min(TASK_NAME_MIN_LENGTH, `Name must be at least ${TASK_NAME_MIN_LENGTH} characters`)
  .max(300, 'Name is too long');

// Optional uuid that also accepts '' / null to mean "no value". Preserves
// `undefined` so an omitted field is left unchanged on PATCH.
const optionalUserId = z
  .union([z.null(), z.literal(''), z.string().uuid('Invalid user id')])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

// Optional date/time. Distinguishes "omitted" (undefined → leave unchanged) from
// "cleared" ('' or null → set to null). Accepts ISO or datetime-local strings.
const optionalDateTime = z
  .union([z.null(), z.literal(''), z.coerce.date()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

const tags = z.array(z.string().trim().min(1).max(50)).max(50);

// Rich-text HTML (Phase 4). Distinguishes omitted (undefined → leave unchanged
// on PATCH) from cleared ('' or null → null). The raw cap only bounds the
// payload; the ~10k text-content limit is enforced after sanitization in the
// service layer (see utils/rich-text.ts).
const richText = z
  .union([z.null(), z.literal(''), z.string().max(100000, 'Content is too large')])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

export const createTaskSchema = z.object({
  name: taskName,
  description: richText,
  assigneeId: optionalUserId,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  tags: tags.optional(),
  startAt: optionalDateTime,
  dueAt: optionalDateTime,
});

// PATCH semantics: every field optional; omitted fields are left unchanged.
export const updateTaskSchema = z.object({
  name: taskName.optional(),
  description: richText,
  assigneeId: optionalUserId,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  tags: tags.optional(),
  startAt: optionalDateTime,
  dueAt: optionalDateTime,
  // Phase 10: reviewer chosen when sending a task to Review (required by the
  // service only on a transition into Review).
  reviewerId: optionalUserId,
  // Phase 10: set by Gantt-drag date edits so the server coalesces the History
  // entry with a recent one instead of logging every intermediate position.
  coalesceHistory: z.boolean().optional(),
});

// Duplicate a task: optionally clone its whole sub-tree.
export const duplicateTaskSchema = z.object({
  includeDescendants: z.boolean().optional(),
  copyAttachments: z.boolean().optional(),
});
export type DuplicateTaskInput = z.infer<typeof duplicateTaskSchema>;

// Phase 13: toggle a task's Private flag.
export const setTaskPrivateSchema = z.object({
  isPrivate: z.boolean(),
});
export type SetTaskPrivateInput = z.infer<typeof setTaskPrivateSchema>;

// --- Task relationships (Phase 3) ------------------------------------------

const taskId = z.number().int().positive('A valid task id is required');

export const setParentSchema = z.object({
  parentId: taskId,
});

export const dependencySchema = z.object({
  type: z.enum(['blocks', 'blockedBy']),
  otherTaskId: taskId,
});

export type SetParentInput = z.infer<typeof setParentSchema>;
export type DependencyInput = z.infer<typeof dependencySchema>;

// --- Attachments & comments (Phase 4) --------------------------------------

// Type/size are validated authoritatively in attachment.service against the
// shared allowlist and 25 MB cap; these just guard shape.
export const presignAttachmentSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255),
  contentType: z.string().trim().min(1, 'Content type is required').max(255),
  size: z.number().int().positive('File size is required'),
});

export const confirmAttachmentSchema = presignAttachmentSchema.extend({
  storageKey: z.string().min(1, 'storageKey is required').max(1024),
});

const commentBody = z
  .string()
  .min(1, 'Comment cannot be empty')
  .max(100000, 'Comment is too large');

export const createCommentSchema = z.object({ body: commentBody });
export const updateCommentSchema = z.object({ body: commentBody });

export type PresignAttachmentInput = z.infer<typeof presignAttachmentSchema>;
export type ConfirmAttachmentInput = z.infer<typeof confirmAttachmentSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// --- Search / sort / pagination (Phase 6) ----------------------------------

const sortDir = z.enum(['asc', 'desc']);
// A nullable, coercible date bound for range filters (accepts ISO string, '', or null).
const dateBound = z
  .union([z.null(), z.literal(''), z.coerce.date()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional();

// Shared by the search grid, the export, and the dashboard counts.
const taskFiltersSchema = z.object({
  assigneeIds: z.array(z.string().uuid()).max(200).optional(),
  includeUnassigned: z.boolean().optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).optional(),
  priorities: z.array(z.enum(TASK_PRIORITIES)).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  statusChangedFrom: dateBound,
  statusChangedTo: dateBound,
  startFrom: dateBound,
  startTo: dateBound,
  includeNoStart: z.boolean().optional(),
  dueFrom: dateBound,
  dueTo: dateBound,
  includeNoDue: z.boolean().optional(),
  // Dashboard quick-filters (Phase 7).
  overdue: z.boolean().optional(),
  completedToday: z.boolean().optional(),
  relation: z.enum(TASK_RELATION_FILTERS).optional(),
  // Saved-view filters (Phase 10).
  creatorIds: z.array(z.string().uuid()).max(200).optional(),
  blocked: z.boolean().optional(),
  // Template provenance filters (Phase 11).
  instanceLabel: z.string().trim().max(200).optional(),
  templateId: z.coerce.number().int().positive().optional(),
});

export const taskSearchSchema = z.object({
  text: z.string().trim().max(200).optional(),
  filters: taskFiltersSchema.optional(),
  sort: z.array(z.object({ field: z.enum(TASK_SORT_FIELDS), dir: sortDir })).max(12).optional(),
  page,
  pageSize,
  nest: z.boolean().optional(),
  // Client clock context for the time-relative quick-filters.
  now: dateBound,
  todayStart: dateBound,
  todayEnd: dateBound,
  // Phase 13: include mention-only tasks in the access-scoped result (default true).
  includeReadOnly: z.boolean().optional(),
  // The requester's IANA timezone, so the Excel export renders dates in local time.
  timeZone: z.string().trim().max(64).optional(),
});

// Dashboard counts: same text + filters, with a required clock context so the
// Overdue and Completed-Today tallies use the user's local "now"/calendar day.
export const taskDashboardSchema = z.object({
  text: z.string().trim().max(200).optional(),
  filters: taskFiltersSchema.optional(),
  now: z.coerce.date(),
  todayStart: z.coerce.date(),
  todayEnd: z.coerce.date(),
  includeReadOnly: z.boolean().optional(),
});

// Due Date Performance Report (Phase 13): the full search filter set + clock
// context, plus the report-only Team Hierarchy selection and group-by toggle.
export const dueDateReportSchema = z.object({
  text: z.string().trim().max(200).optional(),
  filters: taskFiltersSchema.optional(),
  sort: z.array(z.object({ field: z.enum(TASK_SORT_FIELDS), dir: sortDir })).max(12).optional(),
  now: dateBound,
  todayStart: dateBound,
  todayEnd: dateBound,
  includeReadOnly: z.boolean().optional(),
  hierarchyUserIds: z.array(z.string().uuid()).max(5000).optional(),
  groupByAssignee: z.boolean().optional(),
  timeZone: z.string().trim().max(64).optional(),
});
export type DueDateReportInput = z.infer<typeof dueDateReportSchema>;

export const userSearchSchema = z.object({
  filters: z
    .object({
      query: z.string().max(200).optional(),
      firstName: z.array(z.string()).optional(),
      lastName: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
      title: z.array(z.string()).optional(),
      supervisorIds: z.array(z.string().uuid()).optional(),
      roles: z.array(roleSchema).optional(),
      status: z.enum(['active', 'inactive', 'all']).optional(),
    })
    .optional(),
  sort: z.array(z.object({ field: z.enum(USER_SORT_FIELDS), dir: sortDir })).max(7).optional(),
  page,
  pageSize,
});

// PUT /preferences/:screen body — `state` is an opaque object owned by the client.
export const screenStateSchema = z.object({
  state: z.record(z.string(), z.unknown()),
});

// --- Notifications & reminders (Phase 8) -----------------------------------

// Lead time in minutes before a task's Start; capped at ~1 year.
export const addReminderSchema = z.object({
  leadMinutes: z.number().int().min(0).max(527040),
});

// Snooze duration in minutes from now; capped at ~1 week.
export const snoozeReminderSchema = z.object({
  minutes: z.number().int().min(1).max(10080),
});

export const updateNotificationPreferencesSchema = z
  .object({
    mentionedInApp: z.boolean().optional(),
    mentionedEmail: z.boolean().optional(),
    remindersInApp: z.boolean().optional(),
    remindersEmail: z.boolean().optional(),
    assignedInApp: z.boolean().optional(),
    assignedEmail: z.boolean().optional(),
  })
  .strict();

export type AddReminderInput = z.infer<typeof addReminderSchema>;
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export type TaskSearchInput = z.infer<typeof taskSearchSchema>;
export type TaskDashboardInput = z.infer<typeof taskDashboardSchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
export type ScreenStateInput = z.infer<typeof screenStateSchema>;

// --- Task templates & recurring tasks (Phase 11) ---------------------------

const templateName = z.string().trim().min(1, 'Name is required').max(300, 'Name is too long');
// A day offset from the instantiation anchor. Null clears the date; omitted on a
// node input means "no date". Bounded to a decade either side of the anchor —
// negatives arise when converting a task tree whose descendant starts before the
// root's Day-0 anchor. Catches fat-finger entries.
const offsetDays = z
  .union([z.null(), z.coerce.number().int().min(-3650).max(3650)])
  .optional()
  .transform((v) => (v === undefined ? undefined : v));
// A node key is a client-local identifier used to express parent/dependency
// links within a single payload (server ids don't exist yet on create).
const nodeKey = z.string().trim().min(1).max(100);

// Weekly "repeat on" weekdays (0=Sun … 6=Sat).
const weekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7).optional();

const recurrenceInputSchema = z
  .object({
    recurrenceType: z.enum(RECURRENCE_TYPES),
    intervalCount: z.number().int().min(1).max(365).nullable().optional(),
    intervalUnit: z.enum(RECURRENCE_UNITS).nullable().optional(),
    weekdays: weekdaysSchema,
    anchorDate: z
      .union([z.null(), z.literal(''), z.coerce.date()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
    endType: z.enum(RECURRENCE_END_TYPES).optional(),
    endDate: z
      .union([z.null(), z.literal(''), z.coerce.date()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
    maxOccurrences: z.number().int().min(1).max(1000).nullable().optional(),
    labelPrefix: optionalText,
    isActive: z.boolean().optional(),
  })
  // Structural rules that depend on the chosen recurrence type. Deeper business
  // validation (e.g. anchor required for a live schedule) lives in the service.
  .superRefine((r, ctx) => {
    if (r.recurrenceType !== 'None') {
      if (!r.intervalCount) {
        ctx.addIssue({ code: 'custom', path: ['intervalCount'], message: 'Interval is required' });
      }
      if (!r.intervalUnit) {
        ctx.addIssue({ code: 'custom', path: ['intervalUnit'], message: 'Interval unit is required' });
      }
    }
    if (r.endType === 'AfterOccurrences' && !r.maxOccurrences) {
      ctx.addIssue({ code: 'custom', path: ['maxOccurrences'], message: 'A maximum occurrence count is required' });
    }
    if (r.endType === 'OnDate' && !r.endDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'An end date is required' });
    }
  });

const templateNodeInputSchema = z.object({
  id: z.number().int().positive().optional(),
  key: nodeKey,
  parentKey: nodeKey.nullable(),
  name: templateName,
  description: optionalText,
  defaultPriority: z.enum(TASK_PRIORITIES).optional(),
  startOffsetDays: offsetDays,
  dueOffsetDays: offsetDays,
  assigneeRole: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
  tags: tags.optional(),
  orderIndex: z.number().int().min(0).max(10000).optional(),
});

const templateDependencyInputSchema = z.object({
  blockerKey: nodeKey,
  blockedKey: nodeKey,
});

export const createTemplateSchema = z.object({
  name: templateName,
  description: optionalText,
  nodes: z.array(templateNodeInputSchema).min(1, 'A template needs at least one node').max(200),
  dependencies: z.array(templateDependencyInputSchema).max(400).optional(),
  recurrence: recurrenceInputSchema.optional(),
});

// PATCH: any top-level piece may be omitted (left unchanged). When `nodes` is
// present it replaces the whole tree; the service reconciles against existing.
export const updateTemplateSchema = z.object({
  name: templateName.optional(),
  description: optionalText,
  nodes: z.array(templateNodeInputSchema).min(1).max(200).optional(),
  dependencies: z.array(templateDependencyInputSchema).max(400).optional(),
  recurrence: recurrenceInputSchema.optional(),
});

// Convert a live task (optionally its whole subtree) into a new template.
export const saveTaskAsTemplateSchema = z.object({
  name: templateName,
  includeDescendants: z.boolean(),
  includeAttachments: z.boolean(),
  rootRoleLabel: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
});

export const instantiateTemplateSchema = z.object({
  instanceLabel: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
  anchorStart: z.coerce.date(),
  roleAssignments: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(100),
        assigneeId: optionalUserId,
      }),
    )
    .max(200)
    .optional(),
});

export const materializeGhostSchema = z.object({
  seq: z.number().int().min(1),
});

export const applyToFutureSchema = z.object({
  occurrenceIds: z.array(z.number().int().positive()).min(1).max(500),
});

// Recurrence set directly on a regular task. anchorDate is derived server-side
// from the task's earliest date, so it is not accepted here.
export const setTaskRecurrenceSchema = z
  .object({
    recurrenceType: z.enum(['Fixed', 'RelativeToCompletion']),
    intervalCount: z.number().int().min(1).max(365),
    intervalUnit: z.enum(RECURRENCE_UNITS),
    weekdays: weekdaysSchema,
    endType: z.enum(RECURRENCE_END_TYPES).optional(),
    endDate: z
      .union([z.null(), z.literal(''), z.coerce.date()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
    maxOccurrences: z.number().int().min(1).max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.endType === 'AfterOccurrences' && !r.maxOccurrences) {
      ctx.addIssue({ code: 'custom', path: ['maxOccurrences'], message: 'A maximum occurrence count is required' });
    }
    if (r.endType === 'OnDate' && !r.endDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'An end date is required' });
    }
  });

export type SetTaskRecurrenceInput = z.infer<typeof setTaskRecurrenceSchema>;

// --- SMART Goals (Phase 12) -------------------------------------------------

const goalSpecific = z
  .string()
  .trim()
  .min(GOAL_SPECIFIC_MIN_LENGTH, `Describe the goal in at least ${GOAL_SPECIFIC_MIN_LENGTH} characters`)
  .max(4000, 'Too long');

// A finite (non-NaN/Infinity) numeric target/result value.
const goalNumber = z
  .number({ invalid_type_error: 'A number is required' })
  .finite('A finite number is required')
  .min(-1e12)
  .max(1e12);

// Required free-text comment (rejection reason / supervisor comments).
const requiredComment = z.string().trim().min(1, 'Required').max(4000, 'Too long');

// The metric's free-text unit label. Required only when metricType is `Other`;
// checked in the superRefine below.
const unitLabel = optionalText;

const metricTypeSchema = z.enum(GOAL_METRIC_TYPES);

export const createGoalSchema = z
  .object({
    ownerId: optionalUserId,
    specific: goalSpecific,
    metricType: metricTypeSchema,
    unitLabel,
    targetValue: goalNumber,
    deadline: z.coerce.date(),
    risks: optionalText,
    mitigations: optionalText,
    notes: optionalText,
  })
  .superRefine((g, ctx) => {
    if (g.metricType === 'Other' && !g.unitLabel) {
      ctx.addIssue({ code: 'custom', path: ['unitLabel'], message: 'A unit label is required for a custom metric' });
    }
  });

// Draft edit (PATCH). Any field may be omitted (left unchanged). The
// metric/unit cross-check runs in the service, where the merged value is known.
export const updateGoalSchema = z.object({
  specific: goalSpecific.optional(),
  metricType: metricTypeSchema.optional(),
  unitLabel,
  targetValue: goalNumber.optional(),
  deadline: z.coerce.date().optional(),
  risks: optionalText,
  mitigations: optionalText,
  notes: optionalText,
});

// Employee progress update while Active (results + soft fields only).
export const updateGoalProgressSchema = z.object({
  resultValue: goalNumber.nullable().optional(),
  notes: optionalText,
  risks: optionalText,
  mitigations: optionalText,
});

export const rejectGoalSchema = z.object({
  comments: requiredComment,
});

export const resolveGoalSchema = z.object({
  resolution: z.enum(GOAL_RESOLUTIONS),
  supervisorComments: requiredComment,
});

export const goalTeamSchema = z.object({
  filters: z
    .object({
      ownerIds: z.array(z.string().uuid()).max(500).optional(),
      statuses: z.array(z.enum(GOAL_STATUSES)).max(GOAL_STATUSES.length).optional(),
      deadlineFrom: optionalDateTime,
      deadlineTo: optionalDateTime,
    })
    .optional(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type UpdateGoalProgressInput = z.infer<typeof updateGoalProgressSchema>;
export type RejectGoalInput = z.infer<typeof rejectGoalSchema>;
export type ResolveGoalInput = z.infer<typeof resolveGoalSchema>;
export type GoalTeamInput = z.infer<typeof goalTeamSchema>;

// --- App settings (global, Admin-controlled) -------------------------------

export const updateAppSettingsSchema = z.object({
  materializeLeadDays: z
    .number()
    .int()
    .min(MATERIALIZE_LEAD_DAYS_MIN)
    .max(MATERIALIZE_LEAD_DAYS_MAX),
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type SaveTaskAsTemplateInput = z.infer<typeof saveTaskAsTemplateSchema>;
export type RecurrenceInputParsed = z.infer<typeof recurrenceInputSchema>;
export type TemplateNodeInputParsed = z.infer<typeof templateNodeInputSchema>;
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;
export type MaterializeGhostInput = z.infer<typeof materializeGhostSchema>;
export type ApplyToFutureInput = z.infer<typeof applyToFutureSchema>;
