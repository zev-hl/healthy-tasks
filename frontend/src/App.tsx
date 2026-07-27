import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { HomePage } from './pages/HomePage';
import { UsersPage } from './pages/UsersPage';
import { TaskListPage } from './pages/TaskListPage';
import { TaskCreatePage } from './pages/TaskCreatePage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { SessionExpiryWarning } from './components/SessionExpiryWarning';
import type { Role } from '@healthy-tasks/shared';
import type { ReactNode } from 'react';

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Authenticated */}
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/tasks/new" element={<TaskCreatePage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route
            path="/admin/users"
            element={
              <RequireAuth roles={['Admin']}>
                <UsersPage />
              </RequireAuth>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global overlay: pre-expiry "continue session?" prompt. */}
      <SessionExpiryWarning />
    </>
  );
}
