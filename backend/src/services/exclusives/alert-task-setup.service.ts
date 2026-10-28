import type { AlertTaskSetting, Prisma } from '@prisma/client';
import {
  DUTY_NOT_HELD_CODE,
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertTaskSettingDto,
  type ExclusivesAlertTaskSetupDto,
  type ExclusivesAlertType,
  type OrgAlertTaskPickDto,
  type TemplateDutyProblemDto,
} from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { STALE_WRITE_CODE } from '../../utils/optimistic.js';
import { templateDutyProblems } from '../template.service.js';
import type { ExclusivesAlertTaskSetupSaveInput } from '../../validation/schemas.js';

/**
 * HLAI-112: the setup behind the Alert Tasks screen. Per Exclusives alert type,
 * the same for every group: the template its tasks are made from, and who fills
 * each of that template's roles.
 *
 * A row exists once a type has been saved with something in it. Its `savedById`
 * is the Admin or Manager who last changed it — the creator of the tasks it
 * makes — so a Save only rewrites the rows that changed. The setup's version is its newest
 * row's `updatedAt`; a Save made from an older version is refused (409), as
 * elsewhere in the app.
 */

// Every Save of the setup goes through one critical section, so two people
// saving at once cannot both pass the version check. The ASCII bytes of "HATS"
// (Healthy-tasks Alert TaskS).
const SETUP_LOCK_KEY = 0x48415453;

type Db = Prisma.TransactionClient;

/** A role with its person (a type, not an interface, so it is storable JSON). */
type Filled = { role: string; assigneeId: string };

/** The people for a row, as stored: people only, one per role, by role. */
function tidy(assignments: { role: string; assigneeId?: string | null }[]): Filled[] {
  return assignments
    .filter((a): a is Filled => !!a.assigneeId)
    .map((a) => ({ role: a.role, assigneeId: a.assigneeId }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

/** A stored `roleAssignments`, read defensively (it is JSON). */
function storedAssignments(value: Prisma.JsonValue): Filled[] {
  if (!Array.isArray(value)) return [];
  return tidy(
    value.filter(
      (a): a is Filled =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as { role?: unknown }).role === 'string' &&
        typeof (a as { assigneeId?: unknown }).assigneeId === 'string',
    ),
  );
}

function toSettingDto(alertType: ExclusivesAlertType, row?: AlertTaskSetting) {
  // A deleted template empties `templateId`; its people go with it.
  if (!row || row.templateId === null) {
    return {
      alertType,
      templateId: null,
      roleAssignments: [],
    } satisfies ExclusivesAlertTaskSettingDto;
  }
  return {
    alertType,
    templateId: row.templateId,
    roleAssignments: storedAssignments(row.roleAssignments),
  } satisfies ExclusivesAlertTaskSettingDto;
}

/** The setup's version: when it last changed, or null before the first Save. */
function versionOf(rows: AlertTaskSetting[]): string | null {
  const newest = Math.max(...rows.map((r) => r.updatedAt.getTime()));
  return Number.isFinite(newest) ? new Date(newest).toISOString() : null;
}

async function readSetup(db: Db): Promise<ExclusivesAlertTaskSetupDto> {
  const rows = await db.alertTaskSetting.findMany();
  const byType = new Map(rows.map((r) => [r.alertType, r]));
  return {
    settings: EXCLUSIVES_ALERT_TYPES.map((t) => toSettingDto(t, byType.get(t))),
    updatedAt: versionOf(rows),
  };
}

/** Every alert type's row, in the screen's order (an unsaved type is empty). */
export async function getAlertTaskSetup(): Promise<ExclusivesAlertTaskSetupDto> {
  return readSetup(prisma);
}

/**
 * Per person, the roles they fill on Alert Task Setup whose template tasks carry
 * duties, and those duties: what the Organization screen must not take away.
 */
export async function alertTaskPicksByPerson(): Promise<Map<string, OrgAlertTaskPickDto[]>> {
  const rows = await prisma.alertTaskSetting.findMany({ where: { templateId: { not: null } } });
  const byPerson = new Map<string, OrgAlertTaskPickDto[]>();
  if (rows.length === 0) return byPerson;
  const nodes = await prisma.taskTemplateNode.findMany({
    where: { templateId: { in: rows.map((r) => r.templateId as number) }, dutyId: { not: null } },
    select: { templateId: true, assigneeRole: true, dutyId: true },
  });
  const needs = new Map<string, Set<string>>(); // `${templateId}|${role}` → dutyIds
  for (const n of nodes) {
    if (!n.assigneeRole || !n.dutyId) continue;
    const key = `${n.templateId}|${n.assigneeRole}`;
    needs.set(key, (needs.get(key) ?? new Set()).add(n.dutyId));
  }
  for (const r of rows) {
    if (!(EXCLUSIVES_ALERT_TYPES as readonly string[]).includes(r.alertType)) continue;
    for (const a of storedAssignments(r.roleAssignments)) {
      const dutyIds = [...(needs.get(`${r.templateId}|${a.role}`) ?? [])].sort();
      if (dutyIds.length === 0) continue;
      const list = byPerson.get(a.assigneeId) ?? [];
      list.push({ alertType: r.alertType as ExclusivesAlertType, role: a.role, dutyIds });
      byPerson.set(a.assigneeId, list);
    }
  }
  return byPerson;
}

/** A saved alert type that makes tasks: its template, its people, and its saver. */
export interface AlertTaskRecipe {
  templateId: number;
  roleAssignments: Filled[];
  /** Who last saved the row: the creator of its tasks. */
  savedById: string | null;
}

/** The alert types that have a template, by type, for the task maker. */
export async function alertTaskRecipes(): Promise<Map<string, AlertTaskRecipe>> {
  const rows = await prisma.alertTaskSetting.findMany({ where: { templateId: { not: null } } });
  return new Map(
    rows.map((r) => [
      r.alertType,
      {
        templateId: r.templateId as number,
        roleAssignments: storedAssignments(r.roleAssignments),
        savedById: r.savedById,
      },
    ]),
  );
}

/**
 * Check a Save against the templates and people as they are now: each template
 * still exists, each role is one of its template's, each person is active, and
 * holds the duties their role's tasks carry. The screen stops all of these
 * before Save; this is the backstop.
 */
async function assertSavable(settings: ExclusivesAlertTaskSetupSaveInput['settings']) {
  const templateIds = [
    ...new Set(settings.map((s) => s.templateId).filter((id): id is number => id !== null)),
  ];
  const templates = new Map(
    (
      await prisma.taskTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, nodes: { select: { id: true, assigneeRole: true, dutyId: true } } },
      })
    ).map((t) => [t.id, t]),
  );

  const people = tidy(settings.flatMap((s) => s.roleAssignments)).map((a) => a.assigneeId);
  const active = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(people)] }, isActive: true },
        select: { id: true },
      })
    ).map((u) => u.id),
  );

  const dutyProblems: (TemplateDutyProblemDto & { alertType: ExclusivesAlertType })[] = [];
  for (const s of settings) {
    const label = EXCLUSIVES_ALERT_TYPE_LABELS[s.alertType];
    const roles = s.roleAssignments.map((a) => a.role);
    if (new Set(roles).size !== roles.length) {
      throw HttpError.badRequest(`A role is listed twice for ${label}.`);
    }
    if (s.templateId === null) {
      if (tidy(s.roleAssignments).length > 0) {
        throw HttpError.badRequest(`Pick a template for ${label} before choosing people.`);
      }
      continue;
    }
    const template = templates.get(s.templateId);
    if (!template) {
      throw HttpError.badRequest(
        `The template picked for ${label} no longer exists. Pick another.`,
      );
    }
    const templateRoles = new Set(template.nodes.map((n) => n.assigneeRole).filter(Boolean));
    const unknown = roles.find((r) => !templateRoles.has(r));
    if (unknown !== undefined) {
      throw HttpError.badRequest(`“${unknown}” is not a role of the template picked for ${label}.`);
    }
    const filled = tidy(s.roleAssignments);
    if (filled.some((a) => !active.has(a.assigneeId))) {
      throw HttpError.badRequest(
        `Someone picked for ${label} is no longer active. Pick someone else.`,
      );
    }
    const roleMap = new Map(filled.map((a) => [a.role, a.assigneeId]));
    for (const p of await templateDutyProblems(template.nodes, roleMap)) {
      dutyProblems.push({ ...p, alertType: s.alertType });
    }
  }
  if (dutyProblems.length > 0) {
    const n = dutyProblems.length;
    throw new HttpError(
      422,
      `${n} required ${n === 1 ? 'duty is' : 'duties are'} not held by the people picked`,
      { code: DUTY_NOT_HELD_CODE, problems: dutyProblems },
    );
  }
}

/**
 * Save the Alert Tasks screen. Only the rows that changed are written, each
 * recording this person as the one who saved it; a row with nothing in it that
 * was never saved stays unsaved. Returns the setup as it now is.
 */
export async function saveAlertTaskSetup(
  input: ExclusivesAlertTaskSetupSaveInput,
  actorId: string,
): Promise<ExclusivesAlertTaskSetupDto> {
  await assertSavable(input.settings);

  return prisma.$transaction(async (tx) => {
    // $executeRaw: pg_advisory_xact_lock() returns SQL `void`, which $queryRaw
    // cannot read. The key is a constant.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);

    const rows = await tx.alertTaskSetting.findMany();
    const expected = input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).toISOString();
    if ((expected ?? null) !== versionOf(rows)) {
      throw new HttpError(
        409,
        'The alert tasks were changed by someone else while you were editing.',
        {
          code: STALE_WRITE_CODE,
        },
      );
    }

    const byType = new Map(rows.map((r) => [r.alertType, r]));
    for (const s of input.settings) {
      const before = toSettingDto(s.alertType, byType.get(s.alertType));
      const after = { templateId: s.templateId, roleAssignments: tidy(s.roleAssignments) };
      const unchanged =
        before.templateId === after.templateId &&
        JSON.stringify(before.roleAssignments) === JSON.stringify(after.roleAssignments);
      if (unchanged) continue;
      await tx.alertTaskSetting.upsert({
        where: { alertType: s.alertType },
        create: { alertType: s.alertType, ...after, savedById: actorId },
        update: { ...after, savedById: actorId },
      });
    }
    return readSetup(tx);
  });
}
