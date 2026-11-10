import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square, Timer } from 'lucide-react';
import { api } from '../../api/client';
import { Bar, Card, CardHead } from '../../components/harbor/ui';
import { useToast } from '../../components/harbor/Toast';
import { formatClock, formatMinutes, stopMessage, stopTimer, useTimer } from '../../lib/timer';
import { toYmd } from '../../components/harbor/DatePicker';
import type { Period } from '../../components/harbor/taskHelpers';
import { periodRange } from '../../components/harbor/taskHelpers';

const DAY_MINUTES = 8 * 60;

/**
 * The Dashboard's time tracker (§6.4): the same timer as the task page and the
 * sidebar pill, with Stop and log, and the time logged on My Time for the
 * period against an 8h day.
 */
export function TimeTrackerCard({ period }: { period: Period }) {
  const { timer, elapsed } = useTimer();
  const toast = useToast();
  const [logged, setLogged] = useState<number | null>(null);
  const range = periodRange(period);

  useEffect(() => {
    let alive = true;
    const to = period === 'today' ? range.from : toYmd(new Date());
    api
      .listTimeDays(range.from, to)
      .then(
        (days) =>
          alive &&
          setLogged(days.reduce((n, d) => n + d.entries.reduce((m, e) => m + e.minutes, 0), 0)),
      )
      .catch(() => alive && setLogged(null));
    return () => {
      alive = false;
    };
  }, [period, range.from, timer]);

  async function stop() {
    const r = await stopTimer();
    if (r) toast({ message: stopMessage(r), tone: r.logged ? 'success' : 'error' });
  }

  return (
    <Card>
      <CardHead
        icon={<Timer size={16} />}
        title="Time tracker"
        right={
          <span className="hb-small">
            {logged === null
              ? ''
              : period === 'today'
                ? `${formatMinutes(logged)} of 8h today`
                : `${formatMinutes(logged)} ${period === 'week' ? 'this week' : 'this month'}`}
          </span>
        }
      />
      {timer ? (
        <div className="hb-tt running">
          <span className="hb-live" aria-hidden="true" />
          <span className="hb-tt-clock">{formatClock(elapsed)}</span>
          <span className="hb-tt-on">
            On <Link to={`/tasks/${timer.taskId}`}>{timer.taskName}</Link>
          </span>
          <button type="button" className="hb-tb-btn stop" onClick={() => void stop()}>
            <Square size={13} fill="currentColor" aria-hidden="true" /> Stop and log
          </button>
        </div>
      ) : (
        <div className="hb-tt">
          <span className="hb-tt-clock idle">0:00:00</span>
          <span className="hb-tt-on">
            Start the timer from any task’s page; it keeps running while you move around.
          </span>
        </div>
      )}
      {period === 'today' && logged !== null && (
        <div className="hb-pad hb-pad-tight" style={{ paddingBottom: 16 }}>
          <Bar value={logged} max={DAY_MINUTES} />
        </div>
      )}
    </Card>
  );
}
