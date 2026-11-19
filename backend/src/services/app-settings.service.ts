import {
  DEFAULT_MATERIALIZE_LEAD_DAYS,
  TIMER_CHECK_IN_GRACE_DEFAULT,
  TIMER_CHECK_IN_HOURS_DEFAULT,
  type AppSettingsDto,
  type UpdateAppSettingsRequest,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';

/**
 * Global, Admin-controlled application settings, stored as a singleton row
 * (id = 1), mirroring the SchedulerState pattern. Holds the recurrence
 * materialization lead time — a single value every recurring template and task
 * reads from (there is deliberately no per-template/per-task override) — and
 * the timer's check-in hours and grace minutes (L2).
 */

const APP_SETTING_ID = 1;

const DEFAULTS: AppSettingsDto = {
  materializeLeadDays: DEFAULT_MATERIALIZE_LEAD_DAYS,
  timerCheckInHours: TIMER_CHECK_IN_HOURS_DEFAULT,
  timerCheckInGraceMinutes: TIMER_CHECK_IN_GRACE_DEFAULT,
};

function toDto(row: AppSettingsDto): AppSettingsDto {
  return {
    materializeLeadDays: row.materializeLeadDays,
    timerCheckInHours: row.timerCheckInHours,
    timerCheckInGraceMinutes: row.timerCheckInGraceMinutes,
  };
}

/** Read the global settings, falling back to defaults if the row is absent. */
export async function getAppSettings(): Promise<AppSettingsDto> {
  const row = await prisma.appSetting.findUnique({ where: { id: APP_SETTING_ID } });
  return toDto(row ?? DEFAULTS);
}

/** The timer's check-in (L2): hours before it asks, minutes to answer, in ms. */
export async function getTimerCheckIn(): Promise<{ afterMs: number; graceMs: number }> {
  const s = await getAppSettings();
  return { afterMs: s.timerCheckInHours * 3_600_000, graceMs: s.timerCheckInGraceMinutes * 60_000 };
}

/**
 * The single global lead time (days) that governs when a recurring occurrence
 * auto-materializes into a real task. Every scheduler/ghost path reads this — no
 * per-template or per-task value exists.
 */
export async function getMaterializeLeadDays(): Promise<number> {
  const row = await prisma.appSetting.findUnique({
    where: { id: APP_SETTING_ID },
    select: { materializeLeadDays: true },
  });
  return row?.materializeLeadDays ?? DEFAULT_MATERIALIZE_LEAD_DAYS;
}

/**
 * When the global settings last changed (null before the first change). A
 * longer lead time makes recurring occurrences due at once, so the scheduler's
 * lateness check counts them from here.
 */
export async function appSettingsChangedAt(): Promise<Date | null> {
  const row = await prisma.appSetting.findUnique({
    where: { id: APP_SETTING_ID },
    select: { updatedAt: true },
  });
  return row?.updatedAt ?? null;
}

/** Update the global settings (Admin only; enforced at the route). */
export async function updateAppSettings(input: UpdateAppSettingsRequest): Promise<AppSettingsDto> {
  const data = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as UpdateAppSettingsRequest;
  const row = await prisma.appSetting.upsert({
    where: { id: APP_SETTING_ID },
    create: { id: APP_SETTING_ID, ...DEFAULTS, ...data },
    update: data,
  });
  return toDto(row);
}
