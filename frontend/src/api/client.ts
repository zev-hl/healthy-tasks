import type {
  ActiveUserDto,
  AdminResetLinkResponse,
  AttachmentDownloadResponse,
  ConfirmAttachmentRequest,
  CreateCommentRequest,
  CreateTaskRequest,
  CreateUserRequest,
  DependencyType,
  LoginResponse,
  MergeUsersRequest,
  PaginatedResult,
  PresignAttachmentRequest,
  PresignAttachmentResponse,
  AddReminderRequest,
  MentionedFilter,
  NotificationPreferencesDto,
  NotificationsDto,
  ReminderDto,
  ScreenKey,
  TaskDashboardDto,
  TaskDashboardRequest,
  TaskDetailDto,
  UnreadCountDto,
  UpdateNotificationPreferencesRequest,
  TaskDto,
  TaskHistoryEntryDto,
  TaskRef,
  TaskRowDto,
  TaskSearchRequest,
  UpdateCommentRequest,
  UpdateTaskRequest,
  UpdateUserRequest,
  UserDto,
  UserCountsDto,
  UserFilterOptions,
  UserSearchRequest,
} from '@healthy-tasks/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'healthy-tasks.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Expiry time (ms epoch) of the current token from its JWT `exp` claim, or null
 * if there's no token / it can't be read. Used to detect idle expiry client-side
 * so the UI can react before the user submits into a dead session.
 */
export function getTokenExpiresAt(): number | null {
  const token = getToken();
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Called when an authenticated request is rejected with 401 (idle session
// expired or revoked). AuthContext registers a handler that bounces to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  // Sliding session: adopt the server's re-issued token so the idle timer
  // resets on every request while the user is active.
  const refreshed = res.headers.get('X-Refreshed-Token');
  if (refreshed) setToken(refreshed);

  // A 401 while we were authenticated means the session expired or was revoked:
  // drop the token and let the app bounce to the login screen.
  if (res.status === 401 && token) {
    setToken(null);
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'Request failed', data?.details);
  }
  return data as T;
}

export const api = {
  // --- Auth ---
  login: (email: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<UserDto>('/api/auth/me'),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // --- Admin: users ---
  listUsers: () => request<UserDto[]>('/api/users'),
  listSupervisors: () => request<UserDto[]>('/api/users/supervisors'),
  createUser: (body: CreateUserRequest) =>
    request<AdminResetLinkResponse>('/api/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateUser: (id: string, body: UpdateUserRequest) =>
    request<UserDto>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deactivateUser: (id: string) =>
    request<UserDto>(`/api/users/${id}/deactivate`, { method: 'POST' }),
  mergeUsers: (body: MergeUsersRequest) =>
    request<UserDto>('/api/users/merge', { method: 'POST', body: JSON.stringify(body) }),
  adminResetPassword: (id: string) =>
    request<AdminResetLinkResponse>(`/api/users/${id}/reset-password`, { method: 'POST' }),

  searchUsers: (body: UserSearchRequest) =>
    request<PaginatedResult<UserDto>>('/api/users/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  userFilterOptions: () => request<UserFilterOptions>('/api/users/filter-options'),
  userCounts: () => request<UserCountsDto>('/api/users/counts'),

  // --- Active users (any authenticated user) — richer directory (Phase 10) ---
  listActiveUsers: () => request<ActiveUserDto[]>('/api/users/active'),

  // --- Per-user screen preferences (Phase 6) ---
  getPreference: (screen: ScreenKey) => request<{ state: unknown }>(`/api/preferences/${screen}`),
  savePreference: (screen: ScreenKey, state: unknown) =>
    request<{ state: unknown }>(`/api/preferences/${screen}`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    }),

  // --- Tasks ---
  listTasks: () => request<TaskDto[]>('/api/tasks'),
  queryTasks: (body: TaskSearchRequest) =>
    request<PaginatedResult<TaskRowDto>>('/api/tasks/query', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTaskDashboard: (body: TaskDashboardRequest) =>
    request<TaskDashboardDto>('/api/tasks/dashboard', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listTaskTags: () => request<string[]>('/api/tasks/tags'),
  getTask: (id: number) => request<TaskDetailDto>(`/api/tasks/${id}`),
  getTaskHistory: (id: number) => request<TaskHistoryEntryDto[]>(`/api/tasks/${id}/history`),
  createTask: (body: CreateTaskRequest) =>
    request<TaskDto>('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: number, body: UpdateTaskRequest) =>
    request<TaskDetailDto>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // --- Task relationships ---
  searchTasks: (q: string, excludeId?: number) =>
    request<TaskRef[]>(
      `/api/tasks/search?q=${encodeURIComponent(q)}` +
        (excludeId !== undefined ? `&exclude=${excludeId}` : ''),
    ),
  setParent: (id: number, parentId: number) =>
    request<TaskDetailDto>(`/api/tasks/${id}/parent`, {
      method: 'PUT',
      body: JSON.stringify({ parentId }),
    }),
  clearParent: (id: number) =>
    request<TaskDetailDto>(`/api/tasks/${id}/parent`, { method: 'DELETE' }),
  addDependency: (id: number, type: DependencyType, otherTaskId: number) =>
    request<TaskDetailDto>(`/api/tasks/${id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ type, otherTaskId }),
    }),
  removeDependency: (id: number, type: DependencyType, otherTaskId: number) =>
    request<TaskDetailDto>(`/api/tasks/${id}/dependencies`, {
      method: 'DELETE',
      body: JSON.stringify({ type, otherTaskId }),
    }),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  // --- Attachments (Phase 4) ---
  presignTaskAttachment: (taskId: number, body: PresignAttachmentRequest) =>
    request<PresignAttachmentResponse>(`/api/tasks/${taskId}/attachments/presign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirmTaskAttachment: (taskId: number, body: ConfirmAttachmentRequest) =>
    request<TaskDetailDto>(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  presignCommentAttachment: (commentId: string, body: PresignAttachmentRequest) =>
    request<PresignAttachmentResponse>(`/api/comments/${commentId}/attachments/presign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirmCommentAttachment: (commentId: string, body: ConfirmAttachmentRequest) =>
    request<TaskDetailDto>(`/api/comments/${commentId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteAttachment: (attachmentId: string) =>
    request<TaskDetailDto>(`/api/attachments/${attachmentId}`, { method: 'DELETE' }),
  getAttachmentDownloadUrl: (attachmentId: string) =>
    request<AttachmentDownloadResponse>(`/api/attachments/${attachmentId}/download`),

  // --- Comments (Phase 4) ---
  createComment: (taskId: number, body: CreateCommentRequest) =>
    request<TaskDetailDto>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateComment: (commentId: string, body: UpdateCommentRequest) =>
    request<TaskDetailDto>(`/api/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteComment: (commentId: string) =>
    request<TaskDetailDto>(`/api/comments/${commentId}`, { method: 'DELETE' }),

  // --- Notifications (Phase 8) ---
  getNotifications: (filter: MentionedFilter = 'all') =>
    request<NotificationsDto>(`/api/notifications?filter=${filter}`),
  getUnreadCount: () => request<UnreadCountDto>('/api/notifications/unread-count'),
  markNotificationRead: (id: string) =>
    request<void>(`/api/notifications/${id}/read`, { method: 'POST' }),
  getNotificationPreferences: () =>
    request<NotificationPreferencesDto>('/api/notifications/preferences'),
  updateNotificationPreferences: (body: UpdateNotificationPreferencesRequest) =>
    request<NotificationPreferencesDto>('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // --- Reminders (Phase 8) ---
  listTaskReminders: (taskId: number) => request<ReminderDto[]>(`/api/tasks/${taskId}/reminders`),
  addTaskReminder: (taskId: number, body: AddReminderRequest) =>
    request<ReminderDto>(`/api/tasks/${taskId}/reminders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeReminder: (id: string) => request<void>(`/api/reminders/${id}`, { method: 'DELETE' }),
  markReminderRead: (id: string) =>
    request<void>(`/api/reminders/${id}/read`, { method: 'POST' }),
};

/**
 * Export the current filtered/sorted task result set to an .xlsx download. Uses
 * a raw fetch (not request()) because the response is a binary blob, then
 * triggers a browser download.
 */
export async function exportTasksToExcel(body: TaskSearchRequest): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/tasks/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tasks.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Upload file bytes directly to object storage using a pre-signed PUT URL. This
 * bypasses the API entirely (bytes never touch the backend); the Content-Type
 * must match what the URL was signed with.
 */
export async function uploadToStorage(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Upload failed (${res.status})`);
  }
}
