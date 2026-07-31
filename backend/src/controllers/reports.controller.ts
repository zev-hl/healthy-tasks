import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import type { DueDateReportResult } from '@healthy-tasks/shared';
import type { DueDateReportInput } from '../validation/schemas.js';
import { runDueDateReport } from '../services/due-date-report.service.js';
import { buildDueDateReportWorkbook } from '../services/due-date-report-export.service.js';
import type { Actor } from '../services/access-control.service.js';

function actorOf(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

/** POST /api/reports/due-date — the bucketed, access-scoped report. */
export async function dueDateReportController(req: Request, res: Response): Promise<void> {
  const result = await runDueDateReport(req.body as DueDateReportInput, actorOf(req));
  res.json(result satisfies DueDateReportResult);
}

/** POST /api/reports/due-date/export — the same report as an .xlsx download. */
export async function dueDateReportExportController(req: Request, res: Response): Promise<void> {
  const input = req.body as DueDateReportInput;
  const result = await runDueDateReport(input, actorOf(req));
  const workbook = await buildDueDateReportWorkbook(result.rows, input.groupByAssignee ?? false);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="due-date-performance.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}
