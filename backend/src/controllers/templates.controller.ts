import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import type {
  ApplyToFutureResultDto,
  FutureOccurrenceDto,
  GhostOccurrenceDto,
  InstantiateResultDto,
  Role,
  TemplateDto,
  TemplateSummaryDto,
} from '@healthy-tasks/shared';
import type {
  ApplyToFutureInput,
  CreateTemplateInput,
  InstantiateTemplateInput,
  MaterializeGhostInput,
  UpdateTemplateInput,
} from '../validation/schemas.js';
import {
  applyTemplateToOccurrences,
  createTemplate,
  deleteTemplate,
  getAllGhosts,
  getTemplate,
  getTemplateGhosts,
  instantiateTemplate,
  listFutureOccurrences,
  listTemplates,
  materializeGhost,
  updateTemplate,
} from '../services/template.service.js';

function actor(req: Request): { id: string; role: Role } {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

function parseTemplateId(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid template id');
  return id;
}

export async function listTemplatesController(_req: Request, res: Response): Promise<void> {
  res.json((await listTemplates()) satisfies TemplateSummaryDto[]);
}

export async function getAllGhostsController(_req: Request, res: Response): Promise<void> {
  res.json((await getAllGhosts(new Date())) satisfies GhostOccurrenceDto[]);
}

export async function getTemplateController(req: Request, res: Response): Promise<void> {
  res.json((await getTemplate(parseTemplateId(req))) satisfies TemplateDto);
}

export async function createTemplateController(req: Request, res: Response): Promise<void> {
  const result = await createTemplate(actor(req), req.body as CreateTemplateInput);
  res.status(201).json(result satisfies TemplateDto);
}

export async function updateTemplateController(req: Request, res: Response): Promise<void> {
  const result = await updateTemplate(actor(req), parseTemplateId(req), req.body as UpdateTemplateInput);
  res.json(result satisfies TemplateDto);
}

export async function deleteTemplateController(req: Request, res: Response): Promise<void> {
  await deleteTemplate(actor(req), parseTemplateId(req));
  res.status(204).send();
}

export async function instantiateTemplateController(req: Request, res: Response): Promise<void> {
  const result = await instantiateTemplate(
    actor(req),
    parseTemplateId(req),
    req.body as InstantiateTemplateInput,
  );
  res.status(201).json(result satisfies InstantiateResultDto);
}

export async function materializeGhostController(req: Request, res: Response): Promise<void> {
  const { seq } = req.body as MaterializeGhostInput;
  const result = await materializeGhost(actor(req), parseTemplateId(req), seq);
  res.status(201).json(result satisfies InstantiateResultDto);
}

export async function getTemplateGhostsController(req: Request, res: Response): Promise<void> {
  res.json((await getTemplateGhosts(parseTemplateId(req), new Date())) satisfies GhostOccurrenceDto[]);
}

export async function listFutureOccurrencesController(req: Request, res: Response): Promise<void> {
  res.json((await listFutureOccurrences(parseTemplateId(req))) satisfies FutureOccurrenceDto[]);
}

export async function applyToFutureController(req: Request, res: Response): Promise<void> {
  const { occurrenceIds } = req.body as ApplyToFutureInput;
  const result = await applyTemplateToOccurrences(actor(req), parseTemplateId(req), occurrenceIds);
  res.json(result satisfies ApplyToFutureResultDto);
}
