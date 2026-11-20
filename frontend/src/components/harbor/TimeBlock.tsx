import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square } from 'lucide-react';
import type { TaskTimeDto } from '@healthy-tasks/shared';
import { api } from '../../api/client';
import {
  TIMER_EVENT,
  formatClock,
  formatMinutes,
  keepTimer,
  startTimer,
  stopMessage,
  stopTone,
  stopTimer,
  useTimer,
} from '../../lib/timer';
import { userLabel } from '../ui/Avatar';
import { useToast } from './Toast';
import { cx } from './ui';

/** The task's saved time (L2), refreshed whenever a stretch is saved. */
function useTaskTime(taskId: number): TaskTimeDto | null {
  const [time, setTime] = useState<TaskTimeDto | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getTaskTime(taskId)
        .then((t) => alive && setTime(Array.isArray(t?.people) ? t : null))
        .catch(() => alive && setTime(null));
    void load();
    window.addEventListener(TIMER_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(TIMER_EVENT, load);
    };
  }, [taskId]);
  return time;
}

/** "Mo Me 40m · Ana Khan 5m" (the first three; all of them in the tooltip). */
function peopleLine(
  time: TaskTimeDto,
  meId: string | undefined,
  max = 3,
): { short: string; all: string } {
  const label = (p: TaskTimeDto['people'][number]) =>
    `${p.user.id === meId ? 'You' : userLabel(p.user)} ${formatMinutes(p.minutes)}`;
  const all = time.people.map(label);
  const short =
    all.slice(0, max).join(' · ') + (all.length > max ? ` · +${all.length - max} more` : '');
  return { short, all: all.join('\n') };
}

/**
 * The time block in the task header (§6.4, L2): the one big number. Stopped,
 * it shows the time everyone has timed on the task and Start timer; while
 * another task is timed, Switch here; running, a red ticking clock and Stop.
 * Each stop saves the stretch with the task and its duty; nothing is asked.
 */
export function TimeBlock({
  task,
  meId,
}: {
  task: { id: number; name: string };
  /** Shown as “You” in the per-person line. */
  meId?: string;
}) {
  const { timer, elapsed } = useTimer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const time = useTaskTime(task.id);
  const total = time?.totalMinutes ?? 0;
  const running = timer?.taskId === task.id;
  const elsewhere = timer && !running ? timer : null;
  const people = time && time.people.length > 0 ? peopleLine(time, meId) : null;

  async function start() {
    setBusy(true);
    try {
      const stopped = await startTimer({ id: task.id, name: task.name });
      if (stopped)
        toast({
          message: `${stopMessage(stopped)} Now timing this task.`,
          tone: stopTone(stopped, 'dark'),
        });
    } catch (e) {
      toast({
        message: e instanceof Error ? e.message : 'Could not start the timer',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      const r = await stopTimer();
      if (r) toast({ message: stopMessage(r), tone: stopTone(r, 'success') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx('hb-timeblock', running && 'running')}>
      {running ? (
        <>
          <span className="hb-tb-label">
            <span className="hb-live" aria-hidden="true" /> Timer running
          </span>
          <span className="hb-tb-clock" aria-live="off">
            {formatClock(elapsed)}
          </span>
          <span className="hb-small">
            {total > 0
              ? `Plus ${formatMinutes(total)} already on this task`
              : 'Saved on the task when you stop'}
          </span>
          <button
            type="button"
            className="hb-tb-btn stop"
            disabled={busy}
            onClick={() => void stop()}
          >
            <Square size={14} fill="currentColor" aria-hidden="true" /> Stop
          </button>
        </>
      ) : (
        <>
          <span className="hb-tb-label">Time on this task</span>
          <span className="hb-tb-total">{formatMinutes(total)}</span>
          <span className="hb-small" title={people?.all}>
            {elsewhere ? (
              <>
                Timer is on <Link to={`/tasks/${elsewhere.taskId}`}>{elsewhere.taskName}</Link>
              </>
            ) : people ? (
              people.short
            ) : (
              'Nobody has timed it yet'
            )}
          </span>
          <button type="button" className="hb-tb-btn" disabled={busy} onClick={() => void start()}>
            <Play size={15} fill="currentColor" aria-hidden="true" />{' '}
            {elsewhere ? 'Switch here' : 'Start timer'}
          </button>
        </>
      )}
    </div>
  );
}

/** The sidebar pill shown on every page while a timer runs (hidden on its own task). */
export function TimerPill({ hiddenOnTaskId }: { hiddenOnTaskId: number | null }) {
  const { timer, elapsed } = useTimer();
  if (!timer || timer.taskId === hiddenOnTaskId) return null;
  return (
    <Link
      to={`/tasks/${timer.taskId}`}
      className="hb-timer-pill"
      title={`Timer running on ${timer.taskName}`}
    >
      <span className="hb-live" aria-hidden="true" />
      <span className="hb-timer-pill-text">
        <span className="hb-timer-pill-clock">{formatClock(elapsed)}</span>
        <span className="hb-timer-pill-name">{timer.taskName}</span>
      </span>
    </Link>
  );
}

/**
 * "Still working on …?" (L2): shown on every page once the timer asks. Keep
 * going asks again after the Admin's hours; with no answer the server stops
 * it at the deadline, saving the time up to the question.
 */
export function TimerCheckIn() {
  const { timer, checkingIn } = useTimer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!timer || !checkingIn) return null;
  const at = new Date(timer.stopsAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const askedAt = new Date(timer.checkInAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  async function run(what: 'keep' | 'stop') {
    setBusy(true);
    try {
      if (what === 'keep') await keepTimer();
      else {
        const r = await stopTimer();
        if (r) toast({ message: stopMessage(r), tone: stopTone(r, 'success') });
      }
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'That didn’t work', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hb-checkin" role="alertdialog" aria-label="Still working?">
      <span className="hb-live" aria-hidden="true" />
      <span className="hb-checkin-text">
        <strong>
          Still working on <Link to={`/tasks/${timer.taskId}`}>{timer.taskName}</Link>?
        </strong>{' '}
        The timer stops at {at} unless you keep it going; the time up to {askedAt} is kept.
      </span>
      <button
        type="button"
        className="hb-btn hb-btn-primary"
        disabled={busy}
        onClick={() => void run('keep')}
      >
        Keep going
      </button>
      <button type="button" className="hb-btn" disabled={busy} onClick={() => void run('stop')}>
        <Square size={13} fill="currentColor" aria-hidden="true" /> Stop
      </button>
    </div>
  );
}
