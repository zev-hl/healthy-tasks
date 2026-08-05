import ExcelJS from 'exceljs';
import {
  GOAL_METRIC_TYPE_LABELS,
  GOAL_RESOLUTION_LABELS,
  GOAL_STATUS_LABELS,
  type GoalDto,
} from '@healthy-tasks/shared';
import { toExcelLocalDate } from '../utils/excel-date.js';

/**
 * Build an .xlsx workbook of the given goals (My Goals or Team Goals). The Owner
 * column is included only for the Team export. Dates render in `timeZone` (the
 * requester's local zone), matching the on-screen values.
 */
export async function buildGoalsWorkbook(
  goals: GoalDto[],
  opts: { timeZone?: string; includeOwner?: boolean } = {},
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Goals');

  const columns: Partial<ExcelJS.Column>[] = [{ header: 'Goal Id', key: 'id', width: 10 }];
  if (opts.includeOwner) columns.push({ header: 'Owner', key: 'owner', width: 28 });
  columns.push(
    { header: 'Specific (What)', key: 'specific', width: 42 },
    { header: 'Metric', key: 'metric', width: 16 },
    { header: 'Target', key: 'target', width: 12 },
    { header: 'Unit', key: 'unit', width: 14 },
    { header: 'Result', key: 'result', width: 12 },
    { header: 'Deadline', key: 'deadline', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Resolution', key: 'resolution', width: 14 },
    { header: 'Risks', key: 'risks', width: 30 },
    { header: 'Mitigations', key: 'mitigations', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Supervisor Comments', key: 'supervisorComments', width: 30 },
    { header: 'Created By', key: 'createdBy', width: 28 },
    { header: 'Submitted', key: 'submittedAt', width: 20 },
    { header: 'Approved', key: 'approvedAt', width: 20 },
    { header: 'Resolved', key: 'resolvedAt', width: 20 },
    { header: 'Created', key: 'createdAt', width: 20 },
    { header: 'Updated', key: 'updatedAt', width: 20 },
  );
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };

  for (const g of goals) {
    ws.addRow({
      id: g.id,
      owner: g.owner.email,
      specific: g.specific,
      metric: GOAL_METRIC_TYPE_LABELS[g.metricType],
      target: g.targetValue,
      unit: g.unitLabel ?? '',
      result: g.resultValue ?? '',
      deadline: toExcelLocalDate(g.deadline, opts.timeZone),
      status: GOAL_STATUS_LABELS[g.status],
      resolution: g.resolution ? GOAL_RESOLUTION_LABELS[g.resolution] : '',
      risks: g.risks ?? '',
      mitigations: g.mitigations ?? '',
      notes: g.notes ?? '',
      supervisorComments: g.supervisorComments ?? '',
      createdBy: g.createdBy.email,
      submittedAt: toExcelLocalDate(g.submittedAt, opts.timeZone),
      approvedAt: toExcelLocalDate(g.approvedAt, opts.timeZone),
      resolvedAt: toExcelLocalDate(g.resolvedAt, opts.timeZone),
      createdAt: toExcelLocalDate(g.createdAt, opts.timeZone),
      updatedAt: toExcelLocalDate(g.updatedAt, opts.timeZone),
    });
  }

  for (const key of ['deadline', 'submittedAt', 'approvedAt', 'resolvedAt', 'createdAt', 'updatedAt']) {
    ws.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm';
  }

  return wb;
}
