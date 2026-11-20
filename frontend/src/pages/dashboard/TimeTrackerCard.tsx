import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square, Timer } from 'lucide-react';
import { api } from '../../api/client';
import { Bar, Card, CardHead, cx } from '../../components/harbor/ui';
import { useToast } from '../../components/harbor/Toast';
import {
  dayMinutes,
  formatClock,
  formatMinutes,
  stopMessage,
  stopTimer,
  useTimer,
} from '../../lib/timer';
import { toYmd } from '../../components/harbor/DatePicker';
import type { Period } from '../../components/harbor/taskHelpers';
import { periodRange } from '../../components/harbor/taskHelpers';

const DAY_MINUTES = 8 * 60;

/** The card's note on time logged: today against the 8h target, saying so
 * plainly when it is over; this week or month as a plain total. */
function loggedText(logged: number, period: Period): string {
  if (period !== 'today')
    return `Logged ${period === 'week' ? 'this week' : 'this month'}: ${formatMinutes(logged)}`;
  const base = `Logged today: ${formatMinutes(logged)}`;
  return logged > DAY_MINUTES
    ? `${base}, ${formatMinutes(logged - DAY_MINUTES)} over the 8h target`
    : `${base} of the 8h target`;
}

/**
 * The Dashboard's time tracker (§6.4): the same timer as the task page and the
 * sidebar pill, with Stop, and the time logged on My Time for the
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
      .then((days) => alive && setLogged(days.reduce((n, d) => n + dayMinutes(d), 0)))
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
      <CardHead icon={<Timer size={16} />} title="Time tracker" />
      {timer ? (
        <div className="hb-tt running">
          <span className="hb-live" aria-hidden="true" />
          <span className="hb-tt-clock">{formatClock(elapsed)}</span>
          <span className="hb-tt-on">
            On <Link to={`/tasks/${timer.taskId}`}>{timer.taskName}</Link>
          </span>
          <button type="button" className="hb-tb-btn stop" onClick={() => void stop()}>
            <Square size={13} fill="currentColor" aria-hidden="true" /> Stop
          </button>
        </div>
      ) : (
        <div className="hb-tt">
          <span className="hb-tt-idle">No timer running</span>
          <span className="hb-tt-on">
            Start the timer from any task’s page; it keeps running while you move around.
          </span>
        </div>
      )}
      {logged !== null && (
        <div className="hb-pad hb-pad-tight" style={{ paddingBottom: 16 }}>
          <p className={cx('hb-tt-logged', period === 'today' && logged > DAY_MINUTES && 'over')}>
            {loggedText(logged, period)}
          </p>
          {period === 'today' && <Bar value={logged} max={DAY_MINUTES} />}
        </div>
      )}
    </Card>
  );
}
