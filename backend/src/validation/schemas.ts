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
});

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
});

// Dashboard counts: same text + filters, with a required clock context so the
// Overdue and Completed-Today tallies use the user's local "now"/calendar day.
export const taskDashboardSchema = z.object({
  text: z.string().trim().max(200).optional(),
  filters: taskFiltersSchema.optional(),
  now: z.coerce.date(),
  todayStart: z.coerce.date(),
  todayEnd: z.coerce.date(),
});

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
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export type TaskSearchInput = z.infer<typeof taskSearchSchema>;
export type TaskDashboardInput = z.infer<typeof taskDashboardSchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
export type ScreenStateInput = z.infer<typeof screenStateSchema>;
