import ExcelJS from 'exceljs';
import {
  DUE_DATE_BUCKETS,
  DUE_DATE_BUCKET_LABELS,
  TASK_STATUS_LABELS,
  formatDueDateResult,
  type DueDateBucketTotals,
  type DueDateReportRow,
} from '@healthy-tasks/shared';
import { toExcelLocalDate } from '../utils/excel-date.js';

/**
 * Build the Due Date Performance Report workbook. Mirrors the Task export column
 * set plus a Result column (bucket + days early/late). When `groupByAssignee` is
 * on, rows are grouped under each assignee with a bold subtotal row carrying that
 * assignee's per-bucket counts — matching the on-screen grouped view.
 */
export async function buildDueDateReportWorkbook(
  rows: DueDateReportRow[],
  groupByAssignee: boolean,
  timeZone?: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Due Date Performance');

  ws.columns = [
    { header: 'Task Id', key: 'id', width: 10 },
    { header: 'Task Name', key: 'name', width: 42 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Status Changed', key: 'statusChangedAt', width: 20 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Assignee', key: 'assignee', width: 28 },
    { header: 'Creator', key: 'creator', width: 28 },
    { header: 'Start', key: 'startAt', width: 20 },
    { header: 'Due', key: 'dueAt', width: 20 },
    { header: 'Result', key: 'result', width: 26 },
  ];
  ws.getRow(1).font = { bold: true };

  const addDataRow = (r: DueDateReportRow): void => {
    ws.addRow({
      id: r.id,
      name: r.name,
      status: TASK_STATUS_LABELS[r.status],
      statusChangedAt: toExcelLocalDate(r.statusChangedAt, timeZone),
      priority: r.priority,
      assignee: r.assignee?.email ?? '',
      creator: r.creator.email,
      startAt: toExcelLocalDate(r.startAt, timeZone),
      dueAt: toExcelLocalDate(r.dueAt, timeZone),
      result: formatDueDateResult(r.bucket, r.daysDelta),
    });
  };

  if (!groupByAssignee) {
    for (const r of rows) addDataRow(r);
  } else {
    for (const group of groupRows(rows)) {
      for (const r of group.rows) addDataRow(r);
      const subtotal = ws.addRow({
        name: `Subtotal — ${group.label}`,
        result: subtotalText(group.totals),
      });
      subtotal.font = { bold: true };
    }
  }

  for (const key of ['statusChangedAt', 'startAt', 'dueAt']) {
    ws.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm';
  }

  return wb;
}

interface AssigneeGroup {
  key: string;
  label: string;
  rows: DueDateReportRow[];
  totals: DueDateBucketTotals;
}

/** Group rows by assignee (Unassigned last), preserving row order within a group. */
function groupRows(rows: DueDateReportRow[]): AssigneeGroup[] {
  const groups = new Map<string, AssigneeGroup>();
  for (const r of rows) {
    const key = r.assignee?.id ?? '__unassigned__';
    let g = groups.get(key);
    if (!g) {
      const label = r.assignee
        ? `${r.assignee.firstName} ${r.assignee.lastName}`.trim() || r.assignee.email
        : 'Unassigned';
      g = { key, label, rows: [], totals: emptyTotals() };
      groups.set(key, g);
    }
    g.rows.push(r);
    g.totals[r.bucket] += 1;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '__unassigned__') return 1;
    if (b.key === '__unassigned__') return -1;
    return a.label.localeCompare(b.label);
  });
}

function emptyTotals(): DueDateBucketTotals {
  return Object.fromEntries(DUE_DATE_BUCKETS.map((b) => [b, 0])) as DueDateBucketTotals;
}

function subtotalText(totals: DueDateBucketTotals): string {
  return DUE_DATE_BUCKETS.filter((b) => totals[b] > 0)
    .map((b) => `${DUE_DATE_BUCKET_LABELS[b]}: ${totals[b]}`)
    .join('  |  ');
}
