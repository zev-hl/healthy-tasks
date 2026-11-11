import { NavLink, useLocation } from 'react-router-dom';
import type { Role } from '@healthy-tasks/shared';
import { useAuth } from '../auth/AuthContext';

interface Tab {
  to: string;
  label: string;
  roles?: Role[];
}

const MANAGERS: Role[] = ['Admin', 'Manager'];

/**
 * Sidebar items that hold more than one page show those pages as tabs
 * (docs/redesign-decisions.md). The pages keep their own addresses, so links
 * and bookmarks keep working.
 */
const SECTIONS: { paths: string[]; label: string; tabs: Tab[] }[] = [
  {
    label: 'Time',
    paths: ['/time', '/reports/time'],
    tabs: [
      { to: '/time', label: 'My time' },
      { to: '/reports/time', label: 'Review', roles: MANAGERS },
    ],
  },
  {
    label: 'Goals',
    paths: ['/goals', '/goals/team'],
    tabs: [
      { to: '/goals', label: 'My goals' },
      { to: '/goals/team', label: 'Team goals', roles: MANAGERS },
    ],
  },
  {
    label: 'People',
    paths: ['/admin/users', '/admin/organization'],
    tabs: [
      { to: '/admin/organization', label: 'Organization', roles: MANAGERS },
      { to: '/admin/users', label: 'Users', roles: ['Admin'] },
    ],
  },
  {
    label: 'Settings',
    paths: ['/admin/settings', '/admin/departments'],
    tabs: [
      { to: '/admin/settings', label: 'App settings', roles: ['Admin'] },
      { to: '/admin/departments', label: 'Departments & duties', roles: ['Admin'] },
    ],
  },
];

export function SectionTabs() {
  // Shared page chrome: a page rendered on its own (in a test) has no sign-in.
  let user: ReturnType<typeof useAuth>['user'] | undefined;
  try {
    // Called on every render, in the same order; only its throw is caught.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    user = useAuth().user;
  } catch {
    user = undefined;
  }
  const { pathname } = useLocation();
  const section = SECTIONS.find((s) => s.paths.includes(pathname));
  if (!section) return null;
  const tabs = section.tabs.filter((t) => !t.roles || (user && t.roles.includes(user.role)));
  if (tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={section.label}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className="section-tab">
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
