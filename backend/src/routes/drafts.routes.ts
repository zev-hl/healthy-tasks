import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { confirmAttachmentSchema, presignAttachmentSchema } from '../validation/schemas.js';
import {
  addDraftFile,
  createDraft,
  deleteDraft,
  draftFileUrl,
  finishDraft,
  listDrafts,
  presignDraftUpload,
  removeDraftFile,
  updateDraft,
} from '../services/draft.service.js';
import type { Actor } from '../services/access-control.service.js';

/** Drafts (Nov 2026 plan, I1): each person's own; nobody else sees them. */
export const draftsRouter = Router();
draftsRouter.use(requireAuth);

const actorOf = (req: Request): Actor => {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
};
const idOf = (req: Request) => (req.params as { id: string }).id;

const saveDraftSchema = z.object({
  title: z.string().trim().min(1, 'Give the draft a title').max(300),
  notes: z.string().max(200_000).nullable().optional(),
});
const patchDraftSchema = saveDraftSchema.partial();
const finishSchema = z.object({ taskId: z.number().int().positive() });

draftsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listDrafts(actorOf(req)));
  }),
);
draftsRouter.post(
  '/',
  validateBody(saveDraftSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createDraft(actorOf(req), req.body));
  }),
);
draftsRouter.patch(
  '/:id',
  validateBody(patchDraftSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateDraft(actorOf(req), idOf(req), req.body));
  }),
);
draftsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteDraft(actorOf(req), idOf(req));
    res.status(204).send();
  }),
);
draftsRouter.post(
  '/:id/files/presign',
  validateBody(presignAttachmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await presignDraftUpload(actorOf(req), idOf(req), req.body));
  }),
);
draftsRouter.post(
  '/:id/files',
  validateBody(confirmAttachmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await addDraftFile(actorOf(req), idOf(req), req.body));
  }),
);
draftsRouter.delete(
  '/:id/files/:fileId',
  asyncHandler(async (req, res) => {
    const { fileId } = req.params as { fileId: string };
    res.json(await removeDraftFile(actorOf(req), idOf(req), fileId));
  }),
);
draftsRouter.get(
  '/:id/files/:fileId/download',
  asyncHandler(async (req, res) => {
    const { fileId } = req.params as { fileId: string };
    res.json({ url: await draftFileUrl(actorOf(req), idOf(req), fileId) });
  }),
);
/** "Make task": the task made from this draft takes its files; the draft goes. */
draftsRouter.post(
  '/:id/finish',
  validateBody(finishSchema),
  asyncHandler(async (req, res) => {
    await finishDraft(actorOf(req), idOf(req), (req.body as { taskId: number }).taskId);
    res.status(204).send();
  }),
);
