import type { Request, Response } from 'express';
import type { OrgDto } from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import type { SaveOrgChangesInput } from '../validation/schemas.js';
import type { Actor } from '../services/access-control.service.js';
import { getOrg, grantDuty, saveOrgChanges } from '../services/org.service.js';

function actorOf(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

export async function getOrgController(req: Request, res: Response): Promise<void> {
  res.json((await getOrg(actorOf(req))) satisfies OrgDto);
}

export async function saveOrgController(req: Request, res: Response): Promise<void> {
  res.json((await saveOrgChanges(actorOf(req), req.body as SaveOrgChangesInput)) satisfies OrgDto);
}

/** POST /api/org/people/:userId/duties/:dutyId — "Give this person this duty". */
export async function grantDutyController(req: Request, res: Response): Promise<void> {
  const { userId, dutyId } = req.params as { userId: string; dutyId: string };
  await grantDuty(actorOf(req), userId, dutyId);
  res.status(204).end();
}
