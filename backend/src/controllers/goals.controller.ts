import type { Request, Response } from 'express';
import type { GoalDto, Role } from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import type {
  CreateGoalInput,
  GoalTeamInput,
  RejectGoalInput,
  ResolveGoalInput,
  UpdateGoalInput,
  UpdateGoalProgressInput,
} from '../validation/schemas.js';
import {
  approveGoal,
  createGoal,
  deleteGoal,
  finalizeResults,
  getGoal,
  listMyGoals,
  listTeamGoals,
  rejectGoal,
  resolveGoal,
  submitGoal,
  updateGoalDraft,
  updateGoalProgress,
} from '../services/goal.service.js';

function actor(req: Request): { id: string; role: Role } {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

function parseGoalId(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid goal id');
  return id;
}

export async function listMyGoalsController(req: Request, res: Response): Promise<void> {
  res.json((await listMyGoals(actor(req))) satisfies GoalDto[]);
}

export async function listTeamGoalsController(req: Request, res: Response): Promise<void> {
  res.json((await listTeamGoals(actor(req), req.body as GoalTeamInput)) satisfies GoalDto[]);
}

export async function getGoalController(req: Request, res: Response): Promise<void> {
  res.json((await getGoal(actor(req), parseGoalId(req))) satisfies GoalDto);
}

export async function createGoalController(req: Request, res: Response): Promise<void> {
  const result = await createGoal(actor(req), req.body as CreateGoalInput);
  res.status(201).json(result satisfies GoalDto);
}

export async function updateGoalController(req: Request, res: Response): Promise<void> {
  const result = await updateGoalDraft(actor(req), parseGoalId(req), req.body as UpdateGoalInput);
  res.json(result satisfies GoalDto);
}

export async function deleteGoalController(req: Request, res: Response): Promise<void> {
  await deleteGoal(actor(req), parseGoalId(req));
  res.status(204).send();
}

export async function updateGoalProgressController(req: Request, res: Response): Promise<void> {
  const result = await updateGoalProgress(actor(req), parseGoalId(req), req.body as UpdateGoalProgressInput);
  res.json(result satisfies GoalDto);
}

export async function submitGoalController(req: Request, res: Response): Promise<void> {
  res.json((await submitGoal(actor(req), parseGoalId(req))) satisfies GoalDto);
}

export async function approveGoalController(req: Request, res: Response): Promise<void> {
  res.json((await approveGoal(actor(req), parseGoalId(req))) satisfies GoalDto);
}

export async function rejectGoalController(req: Request, res: Response): Promise<void> {
  const result = await rejectGoal(actor(req), parseGoalId(req), req.body as RejectGoalInput);
  res.json(result satisfies GoalDto);
}

export async function finalizeGoalController(req: Request, res: Response): Promise<void> {
  res.json((await finalizeResults(actor(req), parseGoalId(req))) satisfies GoalDto);
}

export async function resolveGoalController(req: Request, res: Response): Promise<void> {
  const result = await resolveGoal(actor(req), parseGoalId(req), req.body as ResolveGoalInput);
  res.json(result satisfies GoalDto);
}
