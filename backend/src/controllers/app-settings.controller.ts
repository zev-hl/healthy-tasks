import type { Request, Response } from 'express';
import type { AppSettingsDto } from '@healthy-tasks/shared';
import { getAppSettings, updateAppSettings } from '../services/app-settings.service.js';
import type { UpdateAppSettingsInput } from '../validation/schemas.js';

/** GET /api/settings — the global app settings (any authenticated user). */
export async function getAppSettingsController(_req: Request, res: Response): Promise<void> {
  res.json((await getAppSettings()) satisfies AppSettingsDto);
}

/** PUT /api/settings — update the global app settings (Admin only). */
export async function updateAppSettingsController(req: Request, res: Response): Promise<void> {
  const updated = await updateAppSettings(req.body as UpdateAppSettingsInput);
  res.json(updated satisfies AppSettingsDto);
}
