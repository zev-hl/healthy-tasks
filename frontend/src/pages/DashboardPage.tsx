import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { DepartmentDto, OrgPersonDto } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { loadTeamScope } from '../lib/teamScope';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select } from '../components/harbor/Select';
import type { Period } from '../components/harbor/taskHelpers';
import {
  ALL_DEPTS,
  Dashboard,
  EVERYONE,
  ME,
  PERIOD_OPTIONS,
  TEAM,
  deptOptions,
  scopeOptions,
} from './dashboard/Dashboard';

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private window: not remembered */
  }
}

/**
 * The Dashboard, at `/`. One page for everyone (Nov 12, after Lipa's system): the
 * header's Period, Department and Person decide what the numbers cover. Person is
 * Me for everyone; Admins and Managers also get My team, Everyone (Admins) and
 * each person. The choices are remembered; `#team` opens on My team.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const canTeam = user?.role === 'Admin' || user?.role === 'Manager';
  const isAdmin = user?.role === 'Admin';

  const [period, setPeriod] = useState<Period>(() => {
    const v = readStored('hb-dash-period', 'today');
    return v === 'week' || v === 'month' ? v : 'today';
  });
  const [scope, setScope] = useState<string>(() =>
    location.hash === '#team' ? TEAM : readStored('hb-dash-scope', ME),
  );
  const [dept, setDept] = useState<string>(() => readStored('hb-dash-dept', ALL_DEPTS));
  const [people, setPeople] = useState<OrgPersonDto[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);

  useEffect(() => {
    if (!user) return;
    loadTeamScope(user)
      .then((s) => {
        setPeople(s.people);
        setTeamIds(s.teamIds);
      })
      .catch(() => {});
    api
      .listDepartments()
      .then(setDepartments)
      .catch(() => {});
  }, [user]);

  // Someone who can't see the team only ever has their own numbers.
  const shownScope = canTeam ? scope : ME;
  const personOpts = useMemo(
    () => scopeOptions(canTeam, people, teamIds, user?.id ?? '', isAdmin),
    [canTeam, people, teamIds, user?.id, isAdmin],
  );
  // A remembered person who is no longer in reach falls back to Me.
  useEffect(() => {
    if (
      people.length &&
      ![ME, TEAM, EVERYONE].includes(scope) &&
      !personOpts.some((o) => o.value === scope)
    ) {
      setScope(ME);
    }
  }, [people, scope, personOpts]);

  function pick(key: string, v: string, set: (v: string) => void) {
    set(v);
    store(key, v);
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const first = user?.firstName?.trim();

  return (
    <>
      <PageHeader title="Dashboard" subtitle={first ? `${today} · Hello, ${first}` : today} />
      <PageBody>
        <Dashboard
          period={period}
          scope={shownScope}
          dept={dept}
          onScope={(v) => pick('hb-dash-scope', v, setScope)}
          filters={
            <div className="hb-dash-filters">
              <Select
                variant="chip"
                label="Period"
                value={period}
                options={PERIOD_OPTIONS}
                onChange={(v) => pick('hb-dash-period', v, (x) => setPeriod(x as Period))}
              />
              <Select
                variant="chip"
                label="Department"
                value={dept}
                options={deptOptions(departments)}
                active={dept !== ALL_DEPTS}
                onChange={(v) => pick('hb-dash-dept', v, setDept)}
              />
              {canTeam && (
                <Select
                  variant="chip"
                  label="Person"
                  value={shownScope}
                  options={personOpts}
                  active={shownScope !== ME}
                  searchPlaceholder="Search people…"
                  onChange={(v) => pick('hb-dash-scope', v, setScope)}
                />
              )}
            </div>
          }
        />
      </PageBody>
    </>
  );
}
