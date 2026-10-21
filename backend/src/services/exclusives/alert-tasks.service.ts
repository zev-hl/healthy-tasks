import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  RICH_TEXT_MAX_CHARS,
  alertLogHref,
  alertTaskInstanceLabel,
  withClashCounter,
  type ExclusivesAlertType,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import {
  addCalendarDays,
  fromBusinessDate,
  toBusinessDate,
  type CalendarDate,
} from '../../utils/business-time.js';
import { richTextLength, sanitizeRichText } from '../../utils/rich-text.js';
import { generateOccurrence } from '../template-instantiation.service.js';
import { alertTaskRecipes, type AlertTaskRecipe } from './alert-task-setup.service.js';

/**
 * HLAI-112: tasks made from Exclusives alerts, by the Alert Task Setup — per
 * alert type, a template and a person per role, the same for every group. Each
 * task tree is labelled `<group>_<type>_<time>`, tagged with its group and type,
 * and created by the Admin who last saved that type's row.
 *
 * - Immediate (after every check): each new alert of a type its group has on
 *   "Immediate" makes its own task tree. No limit: every alert gets its task.
 * - Daily (8:30 AM business time, from the scheduler): one task tree per group
 *   and type for the alerts of the day that has just ended (8:30 AM to 8:30 AM),
 *   in a table in the top task's description, with links to the Alert Log.
 *
 * An alert is picked up only while `taskHandledAt` is empty. It is set with the
 * task, in the same transaction, or when no task is due — no template for its
 * type, alerts switched off, its group gone — so an alert never makes two tasks
 * and never one later. A task that fails is left unhandled and tried again next
 * time (the next check, or the scheduler's next pass).
 */

export interface AlertTaskRunReport {
  /** Task trees made. */
  made: number;
  /** Alerts dealt with that needed no task. */
  noTask: number;
  /** Task trees not made; their alerts are tried again next time. */
  failed: number;
}

const NOTHING: AlertTaskRunReport = { made: 0, noTask: 0, failed: 0 };

type Log = (msg: string) => void;

interface WaitingAlert {
  id: number;
  alertType: string;
  groupId: number | null;
  asin: string;
  message: string;
  createdAt: Date;
  group: { name: string; settings: { alertType: string; mode: string }[] } | null;
}

const waitingSelect = {
  id: true,
  alertType: true,
  groupId: true,
  asin: true,
  message: true,
  createdAt: true,
  group: { select: { name: true, settings: { select: { alertType: true, mode: true } } } },
} as const;

/** The alert's group's mode for its type now ('immediate', 'daily', 'off'). */
const modeOf = (a: WaitingAlert) =>
  a.group?.settings.find((s) => s.alertType === a.alertType)?.mode ?? 'off';

/** Mark alerts dealt with, no task due. */
async function markNoTask(ids: number[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await prisma.alertLog.updateMany({
    where: { id: { in: ids }, taskHandledAt: null },
    data: { taskHandledAt: at },
  });
}

// --- Immediate ---------------------------------------------------------------

/**
 * Make the task of every Immediate alert still waiting for one. Never throws: a
 * problem is logged and the alerts are tried again on the next check.
 */
export async function makeImmediateAlertTasks(
  onLog: Log = () => {},
  now: () => Date = () => new Date(),
): Promise<AlertTaskRunReport> {
  try {
    return await makeImmediate(onLog, now);
  } catch (err) {
    onLog(`[alert-tasks] Immediate tasks not made this time: ${(err as Error).message}`);
    return NOTHING;
  }
}

async function makeImmediate(onLog: Log, now: () => Date): Promise<AlertTaskRunReport> {
  const waiting: WaitingAlert[] = await prisma.alertLog.findMany({
    where: { taskHandledAt: null },
    orderBy: { id: 'asc' },
    select: waitingSelect,
  });
  if (waiting.length === 0) return NOTHING;

  const recipes = await alertTaskRecipes();
  const noTask: number[] = [];
  const due: WaitingAlert[] = [];
  for (const a of waiting) {
    const mode = modeOf(a);
    if (a.group !== null && mode === 'daily') continue; // the 8:30 AM Daily task's
    if (a.group === null || mode !== 'immediate' || !recipes.has(a.alertType)) {
      noTask.push(a.id); // group deleted, switched off since, or no template
      continue;
    }
    due.push(a);
  }
  await markNoTask(noTask, now());

  let made = 0;
  let failed = 0;
  const activeIds = await activePeople(recipes);
  for (const a of due) {
    const type = a.alertType as ExclusivesAlertType;
    try {
      await makeAlertTask({
        recipe: recipes.get(type) as AlertTaskRecipe,
        activeIds,
        groupId: a.groupId as number,
        groupName: (a.group as { name: string }).name,
        type,
        at: now(),
        alertLogIds: [a.id],
      });
      made += 1;
    } catch (err) {
      failed += 1;
      onLog(
        `[alert-tasks] alert ${a.id} (${EXCLUSIVES_ALERT_TYPE_LABELS[type]}, ` +
          `${(a.group as { name: string }).name}): task not made, trying again next check — ` +
          (err as Error).message,
      );
    }
  }

  if (made > 0 || failed > 0) {
    onLog(
      `[alert-tasks] Immediate: ${made} task(s) made` +
        (failed > 0 ? `, ${failed} not made (tried again next check)` : ''),
    );
  }
  return { made, noTask: noTask.length, failed };
}

// --- Daily -------------------------------------------------------------------

/** When the Daily tasks are made: 8:30 AM business time. */
const DAILY_HOUR = 8;
const DAILY_MINUTE = 30;

/** At most this many alerts are rows in a Daily task; the link shows them all. */
export const DAILY_ROWS_MAX = 100;

/** 8:30 AM on this business date. (DST changes at 2 AM, never near 8:30.) */
function dailyRunOn(date: CalendarDate): Date {
  return new Date(fromBusinessDate(date, DAILY_HOUR).getTime() + DAILY_MINUTE * 60_000);
}

/** The latest 8:30 AM at or before `now`: where the last full Daily window ends. */
export function lastDailyRunAt(now: Date): Date {
  const today = toBusinessDate(now);
  const at = dailyRunOn(today);
  return at.getTime() <= now.getTime() ? at : dailyRunOn(addCalendarDays(today, -1));
}

/** The first 8:30 AM after `at`: when the Daily window `at` falls in ends. */
export function nextDailyRunAt(at: Date): Date {
  const today = toBusinessDate(at);
  const run = dailyRunOn(today);
  return run.getTime() > at.getTime() ? run : dailyRunOn(addCalendarDays(today, 1));
}

/** Whether any group has an alert type on Daily that has a template (the 8:30 wake). */
export async function dailyAlertTasksInUse(): Promise<boolean> {
  const withTemplate = await prisma.alertTaskSetting.findMany({
    where: { templateId: { not: null } },
    select: { alertType: true },
  });
  if (withTemplate.length === 0) return false;
  const daily = await prisma.alertSetting.count({
    where: { mode: 'daily', alertType: { in: withTemplate.map((s) => s.alertType) } },
  });
  return daily > 0;
}

/**
 * Make the Daily tasks of every 8:30 AM window that has ended: one task tree per
 * group, alert type and day, for the alerts waiting in it. Catches up on days a
 * missed 8:30 left behind, each with its own day's label. Never throws.
 */
export async function makeDailyAlertTasks(
  onLog: Log = () => {},
  now: Date = new Date(),
): Promise<AlertTaskRunReport> {
  try {
    return await makeDaily(onLog, now);
  } catch (err) {
    onLog(`[alert-tasks] Daily tasks not made this time: ${(err as Error).message}`);
    return NOTHING;
  }
}

async function makeDaily(onLog: Log, now: Date): Promise<AlertTaskRunReport> {
  const waiting: WaitingAlert[] = await prisma.alertLog.findMany({
    where: { taskHandledAt: null, createdAt: { lt: lastDailyRunAt(now) } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: waitingSelect,
  });
  if (waiting.length === 0) return NOTHING;

  const recipes = await alertTaskRecipes();
  const noTask: number[] = [];
  // One task per group, type and window, in the order the windows ended.
  const days = new Map<
    string,
    {
      groupId: number;
      groupName: string;
      type: ExclusivesAlertType;
      end: Date;
      alerts: WaitingAlert[];
    }
  >();
  for (const a of waiting) {
    const mode = modeOf(a);
    if (a.group !== null && mode === 'immediate') continue; // the Immediate tasks'
    if (a.group === null || mode !== 'daily' || !recipes.has(a.alertType)) {
      noTask.push(a.id);
      continue;
    }
    const end = nextDailyRunAt(a.createdAt);
    const key = `${end.toISOString()}|${a.groupId}|${a.alertType}`;
    const day = days.get(key) ?? {
      groupId: a.groupId as number,
      groupName: a.group.name,
      type: a.alertType as ExclusivesAlertType,
      end,
      alerts: [],
    };
    day.alerts.push(a);
    days.set(key, day);
  }
  await markNoTask(noTask, now);

  let made = 0;
  let failed = 0;
  const activeIds = await activePeople(recipes);
  for (const day of days.values()) {
    try {
      await makeAlertTask({
        recipe: recipes.get(day.type) as AlertTaskRecipe,
        activeIds,
        groupId: day.groupId,
        groupName: day.groupName,
        type: day.type,
        at: day.end,
        alertLogIds: day.alerts.map((a) => a.id),
        rootDescriptionExtra: (room) => dailyTable(day, room),
      });
      made += 1;
    } catch (err) {
      failed += 1;
      onLog(
        `[alert-tasks] Daily ${EXCLUSIVES_ALERT_TYPE_LABELS[day.type]} task for ${day.groupName} ` +
          `(${day.alerts.length} alert(s) to ${day.end.toISOString()}) not made, trying again ` +
          `next time — ${(err as Error).message}`,
      );
    }
  }

  if (made > 0 || failed > 0) {
    onLog(
      `[alert-tasks] Daily: ${made} task(s) made` +
        (failed > 0 ? `, ${failed} not made (tried again next time)` : ''),
    );
  }
  return { made, noTask: noTask.length, failed };
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** "Oct 19, 2026, 2:15 PM", on the business clock. */
function when(at: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: env.businessTimeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(at)
    .replace(/\s/g, ' '); // newer ICU puts a narrow no-break space before AM/PM
}

const LINK_TEXT = 'View these alerts in the Alert Log';
const moreText = (n: number) => `…and ${n} more: see the Alert Log link`;

/** The Daily table's columns, in order. */
const TABLE_HEADERS = ['No.', 'ASIN', 'Group', 'Alert Type', 'Date & time', 'Details'];
/** The first rows show the alert's own description; later ones link to it. */
const ROWS_WITH_DETAILS = 2;
const DETAILS_LINK_TEXT = 'See log for details…';

/**
 * The Daily task's table: a header row, then one row per alert, oldest first —
 * No., ASIN, Group, Alert Type, Date & time (business clock), Details. Details is
 * the alert's own description for the first two rows, and from the third a link
 * to the Alert Log on that day, type and group with the row's ASIN in the search
 * box. At most DAILY_ROWS_MAX rows, and no more than fit in `room` characters
 * beside the template's own text; then how many more, and the link to the Alert
 * Log on the whole day (8:30 AM to 8:30 AM).
 */
export function dailyTable(
  day: {
    groupId: number;
    groupName: string;
    type: ExclusivesAlertType;
    end: Date;
    alerts: { asin: string; message: string; createdAt: Date }[];
  },
  room: number,
): string {
  const typeLabel = EXCLUSIVES_ALERT_TYPE_LABELS[day.type];
  const link = (search?: string) =>
    alertLogHref({
      from: dailyRunOn(addCalendarDays(toBusinessDate(day.end), -1)).toISOString(),
      to: day.end.toISOString(),
      alertTypes: [day.type],
      groupIds: [day.groupId],
      search,
    });
  const cell = (tag: 'th' | 'td', html: string) => `<${tag}><p>${html}</p></${tag}>`;

  let budget =
    room - TABLE_HEADERS.join('').length - moreText(day.alerts.length).length - LINK_TEXT.length;
  // A template whose own text leaves no room keeps it, and gets no table.
  if (budget < 0) return '';
  const rows: string[] = [];
  for (const [i, a] of day.alerts.entries()) {
    const texts = [String(i + 1), a.asin, day.groupName, typeLabel, when(a.createdAt)];
    const withDetails = i < ROWS_WITH_DETAILS;
    const size = texts.join('').length + (withDetails ? a.message : DETAILS_LINK_TEXT).length;
    if (rows.length === DAILY_ROWS_MAX || size > budget) break;
    budget -= size;
    const details = withDetails
      ? escapeHtml(a.message)
      : `<a href="${escapeHtml(link(a.asin))}">${DETAILS_LINK_TEXT}</a>`;
    rows.push(
      `<tr>${texts.map((t) => cell('td', escapeHtml(t))).join('')}${cell('td', details)}</tr>`,
    );
  }
  const more = day.alerts.length - rows.length;
  const header = `<tr>${TABLE_HEADERS.map((h) => cell('th', escapeHtml(h))).join('')}</tr>`;
  return (
    (rows.length > 0 ? `<table><tbody>${header}${rows.join('')}</tbody></table>` : '') +
    (more > 0 ? `<p>${escapeHtml(moreText(more))}</p>` : '') +
    `<p><a href="${escapeHtml(link())}">${LINK_TEXT}</a></p>`
  );
}

// --- Making one task tree ------------------------------------------------------

/** Who of the people picked on Alert Task Setup is still active. */
async function activePeople(recipes: Map<string, AlertTaskRecipe>): Promise<Set<string>> {
  const ids = [...recipes.values()].flatMap((r) => r.roleAssignments.map((a) => a.assigneeId));
  if (ids.length === 0) return new Set();
  const active = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] }, isActive: true },
    select: { id: true },
  });
  return new Set(active.map((u) => u.id));
}

/** One task tree from a type's template, for these alerts of one group. */
async function makeAlertTask(o: {
  recipe: AlertTaskRecipe;
  activeIds: Set<string>;
  groupId: number;
  groupName: string;
  type: ExclusivesAlertType;
  /** When it is made: its label's time, and the template's day 0. */
  at: Date;
  alertLogIds: number[];
  /** Text after the top task's own, given how many characters are left for it. */
  rootDescriptionExtra?: (room: number) => string;
}): Promise<void> {
  const { recipe } = o;
  if (!recipe.savedById) throw new Error('no one is recorded as having saved this alert type');

  // A person no longer active leaves their role's tasks unassigned.
  const byRole = new Map(
    recipe.roleAssignments
      .filter((a) => o.activeIds.has(a.assigneeId))
      .map((a) => [a.role, a.assigneeId]),
  );
  const nodes = await prisma.taskTemplateNode.findMany({
    where: { templateId: recipe.templateId },
    select: { id: true, parentNodeId: true, assigneeRole: true, description: true },
  });
  const assigneeByNodeId = new Map(
    nodes.map((n) => [n.id, n.assigneeRole ? (byRole.get(n.assigneeRole) ?? null) : null]),
  );

  let extra: string | null = null;
  if (o.rootDescriptionExtra) {
    const rootText = Math.max(
      0,
      ...nodes
        .filter((n) => n.parentNodeId === null && n.description)
        .map((n) => richTextLength(sanitizeRichText(n.description as string))),
    );
    extra = o.rootDescriptionExtra(RICH_TEXT_MAX_CHARS - rootText);
  }

  // `_2`, `_3`, … when another task of this group and type has the same minute.
  const label = alertTaskInstanceLabel(o.groupName, o.type, o.at, env.businessTimeZone);
  const taken = await prisma.templateOccurrence.findMany({
    where: { instanceLabel: { startsWith: label } },
    select: { instanceLabel: true },
  });

  await generateOccurrence({
    templateId: recipe.templateId,
    seq: null,
    origin: 'alert',
    instanceLabel: withClashCounter(label, new Set(taken.map((t) => t.instanceLabel ?? ''))),
    anchorStart: o.at,
    assigneeByNodeId,
    creatorId: recipe.savedById,
    actorId: recipe.savedById,
    alertGroupId: o.groupId,
    alertType: o.type,
    rootDescriptionExtra: extra,
    alertLogIds: o.alertLogIds,
  });
}
