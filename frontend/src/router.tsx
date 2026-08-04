import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import type { Role } from '@healthy-tasks/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { SessionExpiryWarning } from './components/SessionExpiryWarning';

// Route components are code-split (React.lazy) so the first paint — login and
// My Day — no longer downloads the whole app in one bundle. The heaviest
// dependency, the TipTap rich-text editor, now only loads when a task
// detail/create screen is actually opened.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const TemplatesPage = lazy(() =>
  import('./pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
);
const TaskSearchPage = lazy(() =>
  import('./pages/TaskSearchPage').then((m) => ({ default: m.TaskSearchPage })),
);
const TaskCreatePage = lazy(() =>
  import('./pages/TaskCreatePage').then((m) => ({ default: m.TaskCreatePage })),
);
const TaskDetailPage = lazy(() =>
  import('./pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const MyGoalsPage = lazy(() => import('./pages/MyGoalsPage').then((m) => ({ default: m.MyGoalsPage })));
const TeamGoalsPage = lazy(() =>
  import('./pages/TeamGoalsPage').then((m) => ({ default: m.TeamGoalsPage })),
);
const DueDatePerformancePage = lazy(() =>
  import('./pages/DueDatePerformancePage').then((m) => ({ default: m.DueDatePerformancePage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Root layout: renders the active (lazy) route plus the global session-expiry overlay. */
function RootLayout() {
  return (
    <>
      <Suspense fallback={<div className="container">Loading…</div>}>
        <Outlet />
      </Suspense>
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
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/reports/due-date', element: <DueDatePerformancePage /> },
          { path: '/goals', element: <MyGoalsPage /> },
          {
            path: '/goals/team',
            element: (
              <RequireAuth roles={['Admin', 'Manager']}>
                <TeamGoalsPage />
              </RequireAuth>
            ),
          },
          {
            path: '/admin/users',
            element: (
              <RequireAuth roles={['Admin']}>
                <UsersPage />
              </RequireAuth>
            ),
          },
          {
            path: '/admin/templates',
            element: (
              <RequireAuth roles={['Admin', 'Manager']}>
                <TemplatesPage />
              </RequireAuth>
            ),
          },
          {
            path: '/admin/settings',
            element: (
              <RequireAuth roles={['Admin']}>
                <SettingsPage />
              </RequireAuth>
            ),
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
