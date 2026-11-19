import { useEffect, useState } from 'react';
import { dutyLabel, type TimeDayDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

/**
 * One timer for the whole app, one task at a time (brief §6.4). The clock
 * lives in the browser (localStorage), so it keeps running across pages and a
 * closed tab. When it stops, the stretch is saved on the server with its task
 * and the duty the task has then (Nov 2026 plan, L2): the task shows the time,
 * and My Time adds it up by duty. No duty is asked for. A stretch that can't be
 * saved (offline) is kept here and sent again on the next start or stop.
 */

export interface RunningTimer {
  taskId: number;
  taskName: string;
  startedAt: number; // epoch ms
}

interface Unsaved {
  taskId: number;
  taskName: string;
  startedAt: string;
  endedAt: string;
  date: string;
}

const TIMER_KEY = 'hb-timer';
const UNSAVED_KEY = 'hb-timer-unsaved';
/** Fired when the timer starts, stops, or saved time changes. */
export const TIMER_EVENT = 'hb-timer-change';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the timer simply won't survive a reload */
  }
  window.dispatchEvent(new Event(TIMER_EVENT));
}

export function getTimer(): RunningTimer | null {
  return read<RunningTimer | null>(TIMER_KEY, null);
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
  /** Saved on the server; when false, `reason` says why (it is kept to send again). */
  logged: boolean;
  /** Where it went on My Time: a duty's name, or null for "No duty". */
  dutyName?: string | null;
  reason?: string;
}

async function send(u: Unsaved): Promise<StopResult> {
  const r = await api.saveTimedStretch(u.taskId, {
    startedAt: u.startedAt,
    endedAt: u.endedAt,
    date: u.date,
  });
  return {
    taskName: u.taskName,
    minutes: r.minutes,
    logged: true,
    dutyName: r.duty ? dutyLabel(r.duty) : null,
  };
}

let flushing: Promise<void> | null = null;

/**
 * Send stretches kept from an earlier failed save, one flush at a time (the
 * list is taken out of storage first, so nothing is sent twice). Ones the
 * server refuses (task gone, bad times) are dropped; the rest are kept again.
 */
export function flushUnsaved(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const list = read<Unsaved[]>(UNSAVED_KEY, []);
    if (list.length === 0) return;
    write(UNSAVED_KEY, null);
    const left: Unsaved[] = [];
    for (const u of list) {
      try {
        await send(u);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status >= 500) left.push(u);
      }
    }
    if (left.length) write(UNSAVED_KEY, [...left, ...read<Unsaved[]>(UNSAVED_KEY, [])]);
    window.dispatchEvent(new Event(TIMER_EVENT));
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Stop the running timer and save the stretch. Time under a minute counts as 1m. */
export async function stopTimer(): Promise<StopResult | null> {
  const t = getTimer();
  if (!t) return null;
  write(TIMER_KEY, null);
  const stretch: Unsaved = {
    taskId: t.taskId,
    taskName: t.taskName,
    startedAt: new Date(t.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    date: todayYmd(),
  };
  const minutes = Math.max(1, Math.round((Date.parse(stretch.endedAt) - t.startedAt) / 60000));
  void flushUnsaved();
  try {
    const r = await send(stretch);
    window.dispatchEvent(new Event(TIMER_EVENT));
    return r;
  } catch (e) {
    const kept = !(e instanceof ApiError) || e.status >= 500;
    if (kept) write(UNSAVED_KEY, [...read<Unsaved[]>(UNSAVED_KEY, []), stretch]);
    const why = e instanceof ApiError || e instanceof Error ? e.message : 'the server refused it';
    return {
      taskName: t.taskName,
      minutes,
      logged: false,
      reason: kept ? `${why}. It is kept on this browser and will be sent again` : why,
    };
  }
}

/** Start timing a task; a timer on another task is stopped and saved first. */
export async function startTimer(task: { id: number; name: string }): Promise<StopResult | null> {
  const previous = getTimer();
  const stopped = previous && previous.taskId !== task.id ? await stopTimer() : null;
  void flushUnsaved();
  write(TIMER_KEY, { taskId: task.id, taskName: task.name, startedAt: Date.now() });
  return stopped;
}

/** The running timer and a ticking clock, kept in step across tabs. */
export function useTimer(): { timer: RunningTimer | null; elapsed: number } {
  const [timer, setTimer] = useState<RunningTimer | null>(() => getTimer());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => setTimer(getTimer());
    window.addEventListener(TIMER_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TIMER_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);
  return { timer, elapsed: timer ? now - timer.startedAt : 0 };
}

/** The toast text for a stop. */
export function stopMessage(r: StopResult): string {
  if (!r.logged)
    return `Stopped the timer on “${r.taskName}” (${formatMinutes(r.minutes)}), but it wasn’t saved: ${r.reason}.`;
  const where = r.dutyName ? `under ${r.dutyName}` : 'as “No duty”';
  return `Saved ${formatMinutes(r.minutes)} on “${r.taskName}”. It shows on My Time ${where}.`;
}
