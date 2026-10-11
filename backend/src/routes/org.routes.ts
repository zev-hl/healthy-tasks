import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { saveOrgChangesSchema } from '../validation/schemas.js';
import {
  getOrgController,
  grantDutyController,
  saveOrgController,
} from '../controllers/org.controller.js';

// Organization (Department Duties): reporting lines + duty assignments. Admins
// manage everyone; Managers their own subtree (re-checked per person in the
// service).
export const orgRouter = Router();

orgRouter.use(requireAuth);
orgRouter.use(requireRole('Admin', 'Manager'));

orgRouter.get('/', asyncHandler(getOrgController));
orgRouter.put('/', validateBody(saveOrgChangesSchema), asyncHandler(saveOrgController));
orgRouter.post('/people/:userId/duties/:dutyId', asyncHandler(grantDutyController));
