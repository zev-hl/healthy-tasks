import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

/**
 * One timer for the whole app, one task at a time (brief §6.4). It lives in the
 * browser (localStorage), so it keeps running across pages and a closed tab,
 * but not onto another device: a server-side timer is backend job 3 in
 * docs/redesign-decisions.md. Stopping logs the minutes to My Time, under the
 * task's duty, for the day it was stopped.
 */

export interface RunningTimer {
  taskId: number;
  taskName: string;
  dutyId: string | null;
  startedAt: number; // epoch ms
}

interface LogEntry {
  minutes: number;
  sessions: number;
}

const TIMER_KEY = 'hb-timer';
const LOG_KEY = 'hb-timelog';
const EVENT = 'hb-timer-change';

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
  window.dispatchEvent(new Event(EVENT));
}

export function getTimer(): RunningTimer | null {
  return read<RunningTimer | null>(TIMER_KEY, null);
}

/** Time this browser has logged on a task (the server keeps time per duty, not per task). */
export function getTaskLog(taskId: number): LogEntry {
  return read<Record<string, LogEntry>>(LOG_KEY, {})[String(taskId)] ?? { minutes: 0, sessions: 0 };
}

function addTaskLog(taskId: number, minutes: number) {
  const log = read<Record<string, LogEntry>>(LOG_KEY, {});
  const cur = log[String(taskId)] ?? { minutes: 0, sessions: 0 };
  log[String(taskId)] = { minutes: cur.minutes + minutes, sessions: cur.sessions + 1 };
  write(LOG_KEY, log);
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

const pad = (n: number) => String(n).padStart(2, '0');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface StopResult {
  taskName: string;
  minutes: number;
  /** Logged to My Time; when false, `reason` says why it wasn't. */
  logged: boolean;
  reason?: string;
}

/** Add minutes to today's My Time under a duty. */
async function logToMyTime(dutyId: string, minutes: number): Promise<void> {
  const date = todayYmd();
  const [day] = await api.listTimeDays(date, date);
  if (day?.completed) {
    throw new Error('Today is marked complete on My Time; reopen it there to add time.');
  }
  const entries = [...(day?.entries ?? [])];
  const i = entries.findIndex((e) => e.dutyId === dutyId);
  if (i >= 0) entries[i] = { dutyId, minutes: Math.min(1440, entries[i]!.minutes + minutes) };
  else entries.push({ dutyId, minutes });
  await api.saveTimeDay(date, {
    entries,
    note: day?.note ?? null,
    expectedUpdatedAt: day?.updatedAt ?? null,
  });
}

/** Stop the running timer and log it. Time under a minute counts as 1m. */
export async function stopTimer(): Promise<StopResult | null> {
  const t = getTimer();
  if (!t) return null;
  write(TIMER_KEY, null);
  const minutes = Math.max(1, Math.round((Date.now() - t.startedAt) / 60000));
  addTaskLog(t.taskId, minutes);
  if (!t.dutyId) {
    return { taskName: t.taskName, minutes, logged: false, reason: 'the task has no duty' };
  }
  try {
    await logToMyTime(t.dutyId, minutes);
    return { taskName: t.taskName, minutes, logged: true };
  } catch (e) {
    const reason = e instanceof ApiError || e instanceof Error ? e.message : 'My Time refused it';
    return { taskName: t.taskName, minutes, logged: false, reason };
  }
}

/** Start timing a task; a timer on another task is stopped and logged first. */
export async function startTimer(task: {
  id: number;
  name: string;
  dutyId: string | null;
}): Promise<StopResult | null> {
  const previous = getTimer();
  const stopped = previous && previous.taskId !== task.id ? await stopTimer() : null;
  write(TIMER_KEY, {
    taskId: task.id,
    taskName: task.name,
    dutyId: task.dutyId,
    startedAt: Date.now(),
  });
  return stopped;
}

/** The running timer and a ticking clock, kept in step across tabs. */
export function useTimer(): { timer: RunningTimer | null; elapsed: number } {
  const [timer, setTimer] = useState<RunningTimer | null>(() => getTimer());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => setTimer(getTimer());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
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
  return r.logged
    ? `Stopped the timer on “${r.taskName}” and logged ${formatMinutes(r.minutes)} to My Time.`
    : `Stopped the timer on “${r.taskName}” (${formatMinutes(r.minutes)}). Not added to My Time: ${r.reason}.`;
}
