import type { Request, Response } from 'express';
import { getExclusivesStatus } from '../services/exclusives/status.service.js';

export async function exclusivesStatusController(_req: Request, res: Response): Promise<void> {
  res.json(await getExclusivesStatus());
}
