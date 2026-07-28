import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@healthy-tasks/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { SessionExpiryWarning } from './components/SessionExpiryWarning';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { HomePage } from './pages/HomePage';
import { UsersPage } from './pages/UsersPage';
import { TaskSearchPage } from './pages/TaskSearchPage';
import { TaskCreatePage } from './pages/TaskCreatePage';
import { TaskDetailPage } from './pages/TaskDetailPage';

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Root layout: renders the active route plus the global session-expiry overlay. */
function RootLayout() {
  return (
    <>
      <Outlet />
      <SessionExpiryWarning />
    </>
  );
}

// A data router (createBrowserRouter) so components can use `useBlocker` to guard
// in-app navigation against unsaved changes.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      {
        element: (
          <RequireAuth>
            <Layout />
          </RequireAuth>
        ),
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/tasks', element: <TaskSearchPage /> },
          { path: '/tasks/new', element: <TaskCreatePage /> },
          { path: '/tasks/:id', element: <TaskDetailPage /> },
          {
            path: '/admin/users',
            element: (
              <RequireAuth roles={['Admin']}>
                <UsersPage />
              </RequireAuth>
            ),
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
