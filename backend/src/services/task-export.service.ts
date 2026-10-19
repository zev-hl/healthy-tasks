import ExcelJS from 'exceljs';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_ATTRIBUTE_LABELS,
  TASK_STATUS_LABELS,
  dutyLabel,
  type TaskRowDto,
} from '@healthy-tasks/shared';
import { toExcelLocalDate } from '../utils/excel-date.js';

/** "Department › Duty" for a spreadsheet cell, flagged when archived or held by no one. */
export function exportDutyLabel(r: Pick<TaskRowDto, 'duty' | 'dutyMismatch'>): string {
  if (!r.duty) return '';
  const notes = [r.duty.archived ? 'archived' : '', r.dutyMismatch ? '⚠ assignee lacks duty' : '']
    .filter(Boolean)
    .join(', ');
  return notes ? `${dutyLabel(r.duty)} (${notes})` : dutyLabel(r.duty);
}

/**
 * Build an .xlsx workbook of the given task rows. Includes ALL columns
 * regardless of what the client currently shows/hides (per the export spec).
 * Tags are comma-joined (full list, not the on-screen chip truncation). Dates
 * are rendered in `timeZone` (the requester's local zone) so the spreadsheet
 * matches the app; UTC is used when no timezone is supplied.
 */
export async function buildTasksWorkbook(
  rows: TaskRowDto[],
  timeZone?: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tasks');

  ws.columns = [
    { header: 'Task Id', key: 'id', width: 10 },
    { header: 'Task Name', key: 'name', width: 42 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Status Changed', key: 'statusChangedAt', width: 20 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Assignee', key: 'assignee', width: 28 },
    { header: 'Creator', key: 'creator', width: 28 },
    { header: 'Created', key: 'createdAt', width: 20 },
    { header: 'Start', key: 'startAt', width: 20 },
    { header: 'Due', key: 'dueAt', width: 20 },
    { header: 'Parent / Child', key: 'parentChild', width: 20 },
    { header: 'Tags', key: 'tags', width: 32 },
    { header: 'Department › Duty', key: 'duty', width: 34 },
    // HLAI-118 special attributes, one column each.
    { header: TASK_ATTRIBUTE_LABELS.alertGroup, key: 'alertGroup', width: 28 },
    { header: TASK_ATTRIBUTE_LABELS.alertType, key: 'alertType', width: 26 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow({
      id: r.id,
      name: r.name,
      status: TASK_STATUS_LABELS[r.status],
      statusChangedAt: toExcelLocalDate(r.statusChangedAt, timeZone),
      priority: r.priority,
      assignee: r.assignee?.email ?? '',
      creator: r.creator.email,
      createdAt: toExcelLocalDate(r.createdAt, timeZone),
      startAt: toExcelLocalDate(r.startAt, timeZone),
      dueAt: toExcelLocalDate(r.dueAt, timeZone),
      parentChild: r.parentId
        ? `Sub-task of #${r.parentId}`
        : r.childrenCount > 0
          ? `${r.childrenCount} sub-task(s)`
          : '',
      tags: r.tags.join(', '),
      duty: exportDutyLabel(r),
      alertGroup: r.alertGroup?.name ?? '',
      alertType: r.alertType ? EXCLUSIVES_ALERT_TYPE_LABELS[r.alertType] : '',
    });
  }

  for (const key of ['statusChangedAt', 'createdAt', 'startAt', 'dueAt']) {
    ws.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm';
  }

  return wb;
}
