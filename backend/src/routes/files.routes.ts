import { Router } from 'express';
import { FILE_KINDS, type FileKind } from '@healthy-tasks/shared';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { listFiles } from '../services/file-cabinet.service.js';

/** The file cabinet (Nov 2026 plan, I3): `GET /api/files`. */
export const filesRouter = Router();
filesRouter.use(requireAuth);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

filesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user) throw HttpError.unauthorized();
    const kind = str(req.query.kind);
    if (kind && !(FILE_KINDS as readonly string[]).includes(kind)) {
      throw HttpError.badRequest(`kind must be one of ${FILE_KINDS.join(', ')}`);
    }
    const q = str(req.query.q);
    res.json(
      await listFiles(
        { id: req.user.id, role: req.user.role },
        {
          q: q?.slice(0, 200),
          kind: kind as FileKind | undefined,
          departmentId: str(req.query.departmentId),
          uploadedById: str(req.query.uploadedById),
          from: str(req.query.from),
          to: str(req.query.to),
          cursor: str(req.query.cursor),
        },
      ),
    );
  }),
);
