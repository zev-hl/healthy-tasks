import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import { assertScreenKey, getPref, setPref } from '../services/preference.service.js';
import type { ScreenStateInput } from '../validation/schemas.js';

function screenParam(req: Request) {
  return assertScreenKey((req.params as { screen: string }).screen);
}

export async function getPreferenceController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const state = await getPref(req.user.id, screenParam(req));
  res.json({ state });
}

export async function putPreferenceController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const { state } = req.body as ScreenStateInput;
  await setPref(req.user.id, screenParam(req), state);
  res.json({ state });
}
