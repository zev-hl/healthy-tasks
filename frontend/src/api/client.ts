import type {
  AdminResetLinkResponse,
  CreateTaskRequest,
  CreateUserRequest,
  DependencyType,
  LoginResponse,
  TaskDetailDto,
  TaskDto,
  TaskRef,
  TaskUserRef,
  UpdateTaskRequest,
  UpdateUserRequest,
  UserDto,
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

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
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
  adminResetPassword: (id: string) =>
    request<AdminResetLinkResponse>(`/api/users/${id}/reset-password`, { method: 'POST' }),

  // --- Active users (any authenticated user) ---
  listActiveUsers: () => request<TaskUserRef[]>('/api/users/active'),

  // --- Tasks ---
  listTasks: () => request<TaskDto[]>('/api/tasks'),
  getTask: (id: number) => request<TaskDetailDto>(`/api/tasks/${id}`),
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
};
