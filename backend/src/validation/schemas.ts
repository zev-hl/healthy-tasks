import { z } from 'zod';
import { ROLES, TASK_PRIORITIES, TASK_STATUSES, TASK_NAME_MIN_LENGTH } from '@healthy-tasks/shared';

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

export const createUserSchema = z.object({
  email,
  role: roleSchema,
  title: optionalText,
  jobDescription: optionalText,
  supervisorId: z.string().uuid().optional().nullable(),
});

export const updateUserSchema = z.object({
  role: roleSchema.optional(),
  title: optionalText,
  jobDescription: optionalText,
  supervisorId: z.string().uuid().nullable().optional(),
});

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

export const createTaskSchema = z.object({
  name: taskName,
  description: optionalText,
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
  description: optionalText,
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

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
