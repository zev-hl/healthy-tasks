import { useEffect, useState } from 'react';
import {
  TIMER_CHANGED_CODE,
  dutyLabel,
  type MyTimerDto,
  type RunningTimerDto,
  type TimeDayDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

/**
 * One timer per person, one task at a time (brief §6.4, Nov 2026 plan L2). It
 * runs on the server (`/api/timer`), so every browser and device shows the
 * same one, and none can overwrite another's: a start names the timer it
 * replaces and a stop the one it stops, and the server refuses (409) when that
 * isn't the one running, handing back the current one. Each stop or switch
 * saves the stretch with the task and the task's duty; no duty is asked for.
 * Here it is kept in one shared copy, refreshed on focus and every 30 seconds.
 */

export interface RunningTimer {
  taskId: number;
  taskName: string;
  /** When it started, on this browser's clock (the server's, corrected for skew). */
  startedAt: number; // epoch ms
  /** When it asks "Still working?" (same clock). */
  checkInAt: number;
  /** When it stops by itself if nobody answers (same clock). */
  stopsAt: number;
}

/** Fired when the timer starts, stops, or saved time changes. */
export const TIMER_EVENT = 'hb-timer-change';
const REFRESH_MS = 30_000;

let current: RunningTimer | null = null;
/** Server clock minus this browser's clock. */
let skew = 0;
let loaded: Promise<void> | null = null;

function adopt(timer: RunningTimerDto | null | undefined, now: string | undefined) {
  if (now) skew = Date.parse(now) - Date.now();
  const local = (iso: string) => Date.parse(iso) - skew;
  const next = timer
    ? {
        taskId: timer.taskId,
        taskName: timer.taskName,
        startedAt: local(timer.startedAt),
        checkInAt: local(timer.checkInAt),
        stopsAt: local(timer.stopsAt),
      }
    : null;
  const same =
    next?.taskId === current?.taskId &&
    next?.startedAt === current?.startedAt &&
    next?.checkInAt === current?.checkInAt;
  current = next;
  if (!same) window.dispatchEvent(new Event(TIMER_EVENT));
}

/** Read the timer from the server (it may have changed in another browser). */
export function refreshTimer(): Promise<void> {
  return api
    .getTimer()
    .then((r) => {
      if (r && typeof r === 'object' && 'timer' in r) adopt(r.timer, r.now);
    })
    .catch(() => {
      /* offline: keep showing what we had */
    });
}

function ensureLoaded(): Promise<void> {
  // A timer kept on this browser by the old version can't be carried over.
  try {
    localStorage.removeItem('hb-timer');
    localStorage.removeItem('hb-timelog');
  } catch {
    /* storage unavailable */
  }
  return (loaded ??= refreshTimer());
}

export function getTimer(): RunningTimer | null {
  return current;
}

/** Forget the loaded copy (tests, sign-out). */
export function resetTimerCache(): void {
  const had = current !== null;
  current = null;
  skew = 0;
  loaded = null;
  if (had) window.dispatchEvent(new Event(TIMER_EVENT));
}

/** "0:12:04" */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** "2h 40m" */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A My Time day's whole time: hand-typed rows plus timed hours. */
export function dayMinutes(d: Pick<TimeDayDto, 'entries' | 'timed'>): number {
  return (
    d.entries.reduce((n, e) => n + e.minutes, 0) +
    (d.timed ?? []).reduce((n, e) => n + e.minutes, 0)
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface StopResult {
  taskName: string;
  minutes: number;
  /** Saved on the task; when false, `reason` says why. */
  logged: boolean;
  /** Where it went on My Time: a duty's name, or null for "No duty". */
  dutyName?: string | null;
  reason?: string;
  /**
   * The timer did stop, but its task is one this person can no longer open, so
   * the time had nowhere to go. Nothing went wrong on their side: say it plainly.
   */
  lostAccess?: boolean;
}

/** `taskName`: the stopped timer's task, as this browser last knew it. */
function savedResult(saved: MyTimerDto['saved'], taskName?: string): StopResult | null {
  if (saved === undefined) return null;
  if (saved === null)
    return {
      taskName: taskName || 'the previous task',
      minutes: 0,
      logged: false,
      lostAccess: true,
    };
  return {
    taskName: saved.taskName,
    minutes: saved.minutes,
    logged: true,
    dutyName: saved.duty ? dutyLabel(saved.duty) : null,
  };
}

/** The server said another browser changed the timer: show the real one, and say so. */
function handleChanged(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = e.details as
    { code?: string; timer?: RunningTimerDto | null; now?: string } | undefined;
  if (d?.code !== TIMER_CHANGED_CODE) return null;
  adopt(d.timer ?? null, d.now);
  return e.message;
}

/** Stop the running timer and save the stretch on its task. */
export async function stopTimer(): Promise<StopResult | null> {
  await ensureLoaded();
  const t = current;
  if (!t) return null;
  try {
    const r = await api.stopTimer({ taskId: t.taskId, date: todayYmd() });
    adopt(r.timer, r.now);
    window.dispatchEvent(new Event(TIMER_EVENT));
    return savedResult(r.saved, t.taskName);
  } catch (e) {
    const changed = handleChanged(e);
    return {
      taskName: t.taskName,
      minutes: 0,
      logged: false,
      reason:
        changed ??
        `${e instanceof Error ? e.message : 'the server refused it'}. The timer is still running; try again`,
    };
  }
}

/**
 * Start timing a task; a timer on another task is stopped and saved first (the
 * result says what was saved). Throws with a message the caller shows when the
 * server refuses, e.g. because another browser changed the timer meanwhile.
 */
export async function startTimer(task: { id: number; name: string }): Promise<StopResult | null> {
  await ensureLoaded();
  const replacedName = current?.taskName;
  try {
    const r = await api.startTimer({
      taskId: task.id,
      replacing: current?.taskId ?? null,
      date: todayYmd(),
    });
    adopt(r.timer, r.now);
    window.dispatchEvent(new Event(TIMER_EVENT));
    return savedResult(r.saved, replacedName);
  } catch (e) {
    const changed = handleChanged(e);
    throw new Error(
      changed
        ? `${changed} Nothing was changed here; press it again if you still want this task timed.`
        : e instanceof Error
          ? e.message
          : 'Could not start the timer',
    );
  }
}

/** "Keep going" on the check-in: it asks again after the Admin's hours. */
export async function keepTimer(): Promise<void> {
  const t = current;
  if (!t) return;
  try {
    const r = await api.keepTimer({ taskId: t.taskId });
    adopt(r.timer, r.now);
  } catch (e) {
    const changed = handleChanged(e);
    throw new Error(changed ?? (e instanceof Error ? e.message : 'Could not keep the timer going'));
  }
}

/** The running timer and a ticking clock, the same in every browser. */
export function useTimer(): {
  timer: RunningTimer | null;
  elapsed: number;
  /** True once it is asking "Still working?". */
  checkingIn: boolean;
} {
  const [timer, setTimer] = useState<RunningTimer | null>(() => current);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => setTimer(current);
    window.addEventListener(TIMER_EVENT, sync);
    void ensureLoaded().then(sync);
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void refreshTimer();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.removeEventListener(TIMER_EVENT, sync);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    // Ask the server again just after it stops by itself, so every view follows.
    const wait = timer.stopsAt - Date.now() + 2000;
    const stopCheck =
      wait > 0 && wait < 2 ** 31 ? window.setTimeout(() => void refreshTimer(), wait) : 0;
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stopCheck);
    };
  }, [timer]);
  return {
    timer,
    elapsed: timer ? now - timer.startedAt : 0,
    checkingIn: !!timer && now >= timer.checkInAt && now < timer.stopsAt,
  };
}

/** The toast text for a stop. */
export function stopMessage(r: StopResult): string {
  if (r.lostAccess)
    return `The timer on “${r.taskName}” stopped. Its time wasn’t kept because you can no longer open that task.`;
  if (!r.logged) return `The timer on “${r.taskName}” wasn’t saved: ${r.reason}.`;
  const where = r.dutyName ? `under ${r.dutyName}` : 'as “No duty”';
  return `Saved ${formatMinutes(r.minutes)} on “${r.taskName}”. It shows on My Time ${where}.`;
}

/** The toast tone for a stop: red only when something actually failed. */
export function stopTone<T extends 'dark' | 'success'>(r: StopResult, ok: T): T | 'dark' | 'error' {
  if (r.logged) return ok;
  return r.lostAccess ? 'dark' : 'error';
}
