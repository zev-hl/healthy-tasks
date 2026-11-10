import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { CountBadge, Segmented } from '../components/harbor/ui';
import { PERIOD_OPTIONS, periodRange, type Period } from '../components/harbor/taskHelpers';
import { MyDashboard } from './dashboard/MyDashboard';
import { MyTeam } from './dashboard/MyTeam';

type View = 'me' | 'team';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
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
 * The Dashboard (§6.1), at `/`: My dashboard for everyone, My team for Admins
 * and Managers. The view and the period are remembered; `#me` / `#team` link
 * straight to a view.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canTeam = user?.role === 'Admin' || user?.role === 'Manager';

  const hashView = location.hash === '#team' ? 'team' : location.hash === '#me' ? 'me' : null;
  const [view, setView] = useState<View>(
    () => hashView ?? readStored('hb-dash-view', ['me', 'team'] as const, 'me'),
  );
  const [period, setPeriod] = useState<Period>(() =>
    readStored('hb-dash-period', ['today', 'week', 'month'] as const, 'today'),
  );
  const [meAttention, setMeAttention] = useState(0);
  const [teamAttention, setTeamAttention] = useState(0);
  const onMe = useCallback((n: number) => setMeAttention(n), []);
  const onTeam = useCallback((n: number) => setTeamAttention(n), []);

  useEffect(() => {
    if (hashView) setView(hashView);
  }, [hashView]);

  const shown: View = canTeam ? view : 'me';
  const range = periodRange(period);

  function pickView(v: View) {
    setView(v);
    store('hb-dash-view', v);
    navigate({ hash: v }, { replace: true });
  }
  function pickPeriod(p: Period) {
    setPeriod(p);
    store('hb-dash-period', p);
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const first = user?.firstName?.trim();

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={first ? `${today} · Hello, ${first}` : today}
        switcher={
          canTeam ? (
            <Segmented
              label="Dashboard view"
              value={shown}
              onChange={pickView}
              options={[
                {
                  value: 'me',
                  label: <>My dashboard {meAttention > 0 && <CountBadge n={meAttention} red />}</>,
                },
                {
                  value: 'team',
                  label: <>My team {teamAttention > 0 && <CountBadge n={teamAttention} red />}</>,
                },
              ]}
            />
          ) : undefined
        }
      />
      <PageBody>
        <div className="hb-periodline">
          <h2>{range.heading}</h2>
          <Segmented label="Period" value={period} onChange={pickPeriod} options={PERIOD_OPTIONS} />
          <span className="hb-small">
            Click a number to filter {shown === 'me' ? 'your tasks' : 'your team'}
          </span>
        </div>
        {shown === 'me' ? (
          <MyDashboard period={period} onCounts={onMe} />
        ) : (
          <MyTeam period={period} onCounts={onTeam} />
        )}
      </PageBody>
    </>
  );
}
