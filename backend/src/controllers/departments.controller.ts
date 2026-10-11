import type { Request, Response } from 'express';
import type { DepartmentDto, DutyHoldingsDto } from '@healthy-tasks/shared';
import type {
  CreateDepartmentInput,
  CreateDutyInput,
  UpdateDepartmentInput,
  UpdateDutyInput,
} from '../validation/schemas.js';
import {
  archiveDepartment,
  archiveDuty,
  createDepartment,
  createDuty,
  deleteDepartment,
  deleteDuty,
  getDutyHoldings,
  listDepartments,
  restoreDepartment,
  restoreDuty,
  updateDepartment,
  updateDuty,
} from '../services/department.service.js';

const idParam = (req: Request): string => (req.params as { id: string }).id;

/** Every write answers with the whole catalog, so the screen re-renders from truth. */
async function sendCatalog(res: Response, status = 200): Promise<void> {
  res.status(status).json((await listDepartments()) satisfies DepartmentDto[]);
}

export async function listDepartmentsController(_req: Request, res: Response): Promise<void> {
  await sendCatalog(res);
}

export async function dutyHoldingsController(_req: Request, res: Response): Promise<void> {
  res.json((await getDutyHoldings()) satisfies DutyHoldingsDto);
}

export async function createDepartmentController(req: Request, res: Response): Promise<void> {
  await createDepartment(req.body as CreateDepartmentInput);
  await sendCatalog(res, 201);
}

export async function updateDepartmentController(req: Request, res: Response): Promise<void> {
  await updateDepartment(idParam(req), req.body as UpdateDepartmentInput);
  await sendCatalog(res);
}

export async function archiveDepartmentController(req: Request, res: Response): Promise<void> {
  await archiveDepartment(idParam(req));
  await sendCatalog(res);
}

export async function restoreDepartmentController(req: Request, res: Response): Promise<void> {
  await restoreDepartment(idParam(req));
  await sendCatalog(res);
}

export async function deleteDepartmentController(req: Request, res: Response): Promise<void> {
  await deleteDepartment(idParam(req));
  await sendCatalog(res);
}

export async function createDutyController(req: Request, res: Response): Promise<void> {
  await createDuty(idParam(req), req.body as CreateDutyInput);
  await sendCatalog(res, 201);
}

export async function updateDutyController(req: Request, res: Response): Promise<void> {
  await updateDuty(idParam(req), req.body as UpdateDutyInput);
  await sendCatalog(res);
}

export async function archiveDutyController(req: Request, res: Response): Promise<void> {
  await archiveDuty(idParam(req));
  await sendCatalog(res);
}

export async function restoreDutyController(req: Request, res: Response): Promise<void> {
  await restoreDuty(idParam(req));
  await sendCatalog(res);
}

export async function deleteDutyController(req: Request, res: Response): Promise<void> {
  await deleteDuty(idParam(req));
  await sendCatalog(res);
}
