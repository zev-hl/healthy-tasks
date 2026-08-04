import {
  DEFAULT_MATERIALIZE_LEAD_DAYS,
  type AppSettingsDto,
  type UpdateAppSettingsRequest,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';

/**
 * Global, Admin-controlled application settings, stored as a singleton row
 * (id = 1), mirroring the SchedulerState pattern. Currently holds the recurrence
 * materialization lead time — a single value every recurring template and task
 * reads from (there is deliberately no per-template/per-task override).
 */

const APP_SETTING_ID = 1;

function toDto(row: { materializeLeadDays: number }): AppSettingsDto {
  return { materializeLeadDays: row.materializeLeadDays };
}

/** Read the global settings, falling back to defaults if the row is absent. */
export async function getAppSettings(): Promise<AppSettingsDto> {
  const row = await prisma.appSetting.findUnique({ where: { id: APP_SETTING_ID } });
  return toDto(row ?? { materializeLeadDays: DEFAULT_MATERIALIZE_LEAD_DAYS });
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

/** Update the global settings (Admin only; enforced at the route). */
export async function updateAppSettings(input: UpdateAppSettingsRequest): Promise<AppSettingsDto> {
  const row = await prisma.appSetting.upsert({
    where: { id: APP_SETTING_ID },
    create: { id: APP_SETTING_ID, materializeLeadDays: input.materializeLeadDays },
    update: { materializeLeadDays: input.materializeLeadDays },
  });
  return toDto(row);
}
