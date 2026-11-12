import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Square } from 'lucide-react';
import {
  formatClock,
  formatMinutes,
  getTaskLog,
  startTimer,
  stopMessage,
  stopTimer,
  useTimer,
} from '../../lib/timer';
import { useToast } from './Toast';
import { cx } from './ui';

/**
 * The time block in the task header (§6.4): the one big number. Stopped, it
 * shows what this browser has logged on the task and Start timer; while
 * another task is timed, Switch here; running, a red ticking clock and
 * Stop & log, which adds the minutes to My Time under the task's duty.
 */
export function TimeBlock({
  task,
  compact = false,
}: {
  task: { id: number; name: string; dutyId: string | null; dutyLabel?: string | null };
  /**
   * One button for the task page's top bar (Nov 12: time tracking isn't required
   * at rollout, so it doesn't get a big box). The details go in its tooltip.
   */
  compact?: boolean;
}) {
  const { timer, elapsed } = useTimer();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const log = getTaskLog(task.id);
  const running = timer?.taskId === task.id;
  const elsewhere = timer && !running ? timer : null;

  async function start() {
    setBusy(true);
    try {
      const stopped = await startTimer({ id: task.id, name: task.name, dutyId: task.dutyId });
      if (stopped)
        toast({
          message: `${stopMessage(stopped)} Now timing this task.`,
          tone: stopped.logged ? 'dark' : 'error',
        });
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      const r = await stopTimer();
      if (r) toast({ message: stopMessage(r), tone: r.logged ? 'success' : 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    const where = elsewhere
      ? `The timer is on “${elsewhere.taskName}”`
      : task.dutyId
        ? `Logs to My Time under ${task.dutyLabel ?? 'its duty'}`
        : 'Give the task a duty to log time to My Time';
    return running ? (
      <button
        type="button"
        className="hb-timer-btn is-running"
        disabled={busy}
        onClick={() => void stop()}
        title="Stop and log the time to My Time"
      >
        <span className="hb-live" aria-hidden="true" />
        <span aria-live="off">{formatClock(elapsed)}</span>
        <Square size={12} fill="currentColor" aria-hidden="true" /> Stop &amp; log
      </button>
    ) : (
      <button
        type="button"
        className="hb-timer-btn"
        disabled={busy}
        onClick={() => void start()}
        title={`${where}${log.minutes > 0 ? ` · ${formatMinutes(log.minutes)} logged here` : ''}`}
      >
        <Play size={13} fill="currentColor" aria-hidden="true" />
        {elsewhere ? 'Switch timer here' : 'Start timer'}
        {log.minutes > 0 && <span className="hb-timer-btn-n">{formatMinutes(log.minutes)}</span>}
      </button>
    );
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
            {log.minutes > 0
              ? `Plus ${formatMinutes(log.minutes)} already logged here`
              : 'Logs to My Time when you stop'}
          </span>
          <button
            type="button"
            className="hb-tb-btn stop"
            disabled={busy}
            onClick={() => void stop()}
          >
            <Square size={14} fill="currentColor" aria-hidden="true" /> Stop &amp; log
          </button>
        </>
      ) : (
        <>
          <span className="hb-tb-label">Time logged</span>
          <span className="hb-tb-total">{formatMinutes(log.minutes)}</span>
          <span className="hb-small">
            {elsewhere ? (
              <>
                Timer is on <Link to={`/tasks/${elsewhere.taskId}`}>{elsewhere.taskName}</Link>
              </>
            ) : log.sessions > 0 ? (
              `${log.sessions} ${log.sessions === 1 ? 'session' : 'sessions'} in this browser`
            ) : task.dutyId ? (
              `Goes to My Time under ${task.dutyLabel ?? 'its duty'}`
            ) : (
              'Give the task a duty to log time to My Time'
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
