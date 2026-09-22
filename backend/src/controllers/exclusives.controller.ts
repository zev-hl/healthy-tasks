import type { Request, Response } from 'express';
import type {
  ExclusivesAlertRowDto,
  ExclusivesGroupDto,
  ExclusivesLookupResponseDto,
  ExclusivesGroupRowDto,
  ExclusivesSummaryDto,
  PaginatedResult,
} from '@healthy-tasks/shared';
import { getExclusivesStatus } from '../services/exclusives/status.service.js';
import { getExclusivesSummary } from '../services/exclusives/summary.service.js';
import { getGroup, queryGroups } from '../services/exclusives/group.service.js';
import { queryAlerts } from '../services/exclusives/alert-log.service.js';
import { lookupAsins } from '../services/exclusives/lookup.service.js';
import {
  createGroup,
  deleteGroup,
  updateGroup,
} from '../services/exclusives/group-write.service.js';
import {
  csvFileName,
  exportAlertsCsv,
  exportGroupCsv,
} from '../services/exclusives/export.service.js';
import type {
  ExclusivesAlertQueryInput,
  ExclusivesGroupQueryInput,
  ExclusivesAlertExportInput,
  ExclusivesGroupCreateInput,
  ExclusivesGroupExportInput,
  ExclusivesGroupUpdateInput,
  ExclusivesLookupInput,
} from '../validation/schemas.js';
import { HttpError } from '../utils/http-error.js';

function groupId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw HttpError.badRequest('Invalid group id.');
  return id;
}

export async function exclusivesStatusController(_req: Request, res: Response): Promise<void> {
  res.json(await getExclusivesStatus());
}

/** Header numbers for the Exclusives screens. */
export async function exclusivesSummaryController(_req: Request, res: Response): Promise<void> {
  res.json((await getExclusivesSummary()) satisfies ExclusivesSummaryDto);
}

/** One page of the Alert Groups list. */
export async function queryExclusivesGroupsController(req: Request, res: Response): Promise<void> {
  const result = await queryGroups(req.body as ExclusivesGroupQueryInput);
  res.json(result satisfies PaginatedResult<ExclusivesGroupRowDto>);
}

/** One group, for the editor. */
export async function getExclusivesGroupController(req: Request, res: Response): Promise<void> {
  res.json((await getGroup(groupId(req))) satisfies ExclusivesGroupDto);
}

/** One page of the Alert Log. */
export async function queryExclusivesAlertsController(req: Request, res: Response): Promise<void> {
  const result = await queryAlerts(req.body as ExclusivesAlertQueryInput);
  res.json(result satisfies PaginatedResult<ExclusivesAlertRowDto>);
}

/** Resolve ASINs against the seller account (the only part that calls Amazon). */
export async function lookupExclusivesListingsController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await lookupAsins(req.body as ExclusivesLookupInput);
  res.json(result satisfies ExclusivesLookupResponseDto);
}

function actorId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

function sendCsv(res: Response, body: string, fileName: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(body);
}

export async function createExclusivesGroupController(req: Request, res: Response): Promise<void> {
  const group = await createGroup(req.body as ExclusivesGroupCreateInput, actorId(req));
  res.status(201).json(group satisfies ExclusivesGroupDto);
}

export async function updateExclusivesGroupController(req: Request, res: Response): Promise<void> {
  const group = await updateGroup(
    groupId(req),
    req.body as ExclusivesGroupUpdateInput,
    actorId(req),
  );
  res.json(group satisfies ExclusivesGroupDto);
}

export async function deleteExclusivesGroupController(req: Request, res: Response): Promise<void> {
  await deleteGroup(groupId(req));
  res.status(204).end();
}

/** The Alert Log download, filtered exactly as the screen is. */
export async function exportExclusivesAlertsController(req: Request, res: Response): Promise<void> {
  const input = req.body as ExclusivesAlertExportInput;
  sendCsv(res, await exportAlertsCsv(input), csvFileName('exclusives-alerts'));
}

/** A group's ASIN list, as a download. */
export async function exportExclusivesGroupController(req: Request, res: Response): Promise<void> {
  const { timeZone } = req.body as ExclusivesGroupExportInput;
  const id = groupId(req);
  sendCsv(res, await exportGroupCsv(id, timeZone), csvFileName(`exclusives-group-${id}`));
}
