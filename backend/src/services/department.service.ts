import { Prisma } from '@prisma/client';
import {
  DEPARTMENT_COLORS,
  TERMINAL_TASK_STATUSES,
  catalogNameKey,
  normalizeCatalogName,
  type DepartmentDto,
  type DutyDto,
  type DutyHoldingsDto,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type {
  CreateDepartmentInput,
  CreateDutyInput,
  UpdateDepartmentInput,
  UpdateDutyInput,
} from '../validation/schemas.js';

/**
 * Departments & Duties catalog (Admin-managed; readable by everyone for the
 * pickers). Every duty belongs to exactly one department; its name is unique
 * within that department, ignoring case and extra spaces. Archive, don't delete:
 * anything that has been used is archived (hidden from pickers, kept in history
 * and reports); only never-used rows can be deleted.
 */

const dutyCountSelect = {
  _count: { select: { holders: true, tasks: true, templateNodes: true, timeEntries: true } },
} as const;

// --- Reads -----------------------------------------------------------------

/** The whole catalog, active and archived, alphabetical, with usage counts. */
export async function listDepartments(): Promise<DepartmentDto[]> {
  const [departments, activeHolders, openTasks] = await Promise.all([
    prisma.department.findMany({
      include: { duties: { include: dutyCountSelect } },
    }),
    prisma.userDuty.findMany({
      where: { user: { isActive: true } },
      select: { userId: true, dutyId: true },
    }),
    prisma.task.groupBy({
      by: ['dutyId'],
      where: { dutyId: { not: null }, status: { notIn: [...TERMINAL_TASK_STATUSES] } },
      _count: { _all: true },
      orderBy: { dutyId: 'asc' },
    }),
  ]);

  const holdersByDuty = new Map<string, Set<string>>();
  for (const h of activeHolders) {
    const set = holdersByDuty.get(h.dutyId) ?? new Set<string>();
    set.add(h.userId);
    holdersByDuty.set(h.dutyId, set);
  }
  const openByDuty = new Map<string, number>();
  for (const g of openTasks) if (g.dutyId) openByDuty.set(g.dutyId, g._count._all);

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  return [...departments].sort(byName).map((d) => {
    const people = new Set<string>();
    const duties: DutyDto[] = [...d.duties].sort(byName).map((u) => {
      const holders = holdersByDuty.get(u.id) ?? new Set<string>();
      holders.forEach((id) => people.add(id));
      const c = u._count;
      return {
        id: u.id,
        departmentId: d.id,
        name: u.name,
        description: u.description,
        archived: u.archivedAt !== null || d.archivedAt !== null,
        peopleCount: holders.size,
        openTaskCount: openByDuty.get(u.id) ?? 0,
        inUse: c.holders + c.tasks + c.templateNodes + c.timeEntries > 0,
      };
    });
    return {
      id: d.id,
      name: d.name,
      color: d.color,
      archived: d.archivedAt !== null,
      duties,
      peopleCount: people.size,
    };
  });
}

/** Which duties each ACTIVE person holds (archived duties included). */
export async function getDutyHoldings(): Promise<DutyHoldingsDto> {
  const rows = await prisma.userDuty.findMany({
    where: { user: { isActive: true } },
    select: { userId: true, dutyId: true },
  });
  const out: DutyHoldingsDto = {};
  for (const r of rows) (out[r.userId] ??= []).push(r.dutyId);
  return out;
}

/**
 * A duty that may be newly put on a task / template task: it must exist and be
 * active (neither it nor its department archived). Keeping an already-set
 * archived duty is fine — callers only check when the duty is CHANGING.
 */
export async function assertDutyAssignable(dutyId: string): Promise<void> {
  const duty = await prisma.duty.findUnique({
    where: { id: dutyId },
    select: { archivedAt: true, department: { select: { archivedAt: true } } },
  });
  if (!duty) throw HttpError.badRequest('Selected duty does not exist');
  if (duty.archivedAt || duty.department.archivedAt) {
    throw HttpError.badRequest('Selected duty is archived');
  }
}

// --- Departments -----------------------------------------------------------

async function assertDepartmentNameFree(name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.department.findUnique({ where: { nameKey: catalogNameKey(name) } });
  if (clash && clash.id !== exceptId) {
    throw HttpError.conflict(
      `A department named “${clash.name}” already exists${clash.archivedAt ? ' (archived)' : ''}.`,
    );
  }
}

async function getDepartmentOr404(id: string) {
  const d = await prisma.department.findUnique({ where: { id } });
  if (!d) throw HttpError.notFound('Department not found');
  return d;
}

export async function createDepartment(input: CreateDepartmentInput): Promise<void> {
  const name = normalizeCatalogName(input.name);
  await assertDepartmentNameFree(name);
  // No color picked: cycle through the palette so neighbours differ.
  const color: string =
    input.color ??
    DEPARTMENT_COLORS[(await prisma.department.count()) % DEPARTMENT_COLORS.length] ??
    DEPARTMENT_COLORS[0];
  await prisma.department.create({ data: { name, nameKey: catalogNameKey(name), color } });
}

export async function updateDepartment(id: string, input: UpdateDepartmentInput): Promise<void> {
  const d = await getDepartmentOr404(id);
  if (d.archivedAt) throw HttpError.badRequest('Restore the department before editing it');
  const data: Prisma.DepartmentUpdateInput = {};
  if (input.name !== undefined) {
    const name = normalizeCatalogName(input.name);
    await assertDepartmentNameFree(name, id);
    data.name = name;
    data.nameKey = catalogNameKey(name);
  }
  if (input.color !== undefined) data.color = input.color;
  await prisma.department.update({ where: { id }, data });
}

/** Archive a department and every duty under it (they stay in history/reports). */
export async function archiveDepartment(id: string): Promise<void> {
  const d = await getDepartmentOr404(id);
  if (d.archivedAt) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.department.update({ where: { id }, data: { archivedAt: now } }),
    prisma.duty.updateMany({
      where: { departmentId: id, archivedAt: null },
      data: { archivedAt: now },
    }),
  ]);
}

/** Restore a department only — its duties are restored one by one. */
export async function restoreDepartment(id: string): Promise<void> {
  await getDepartmentOr404(id);
  await prisma.department.update({ where: { id }, data: { archivedAt: null } });
}

/** Delete a department that has never had a duty. Anything else is archived. */
export async function deleteDepartment(id: string): Promise<void> {
  await getDepartmentOr404(id);
  const duties = await prisma.duty.count({ where: { departmentId: id } });
  if (duties > 0) {
    throw HttpError.conflict('This department has duties, so it can only be archived');
  }
  await prisma.department.delete({ where: { id } });
}

// --- Duties ----------------------------------------------------------------

async function assertDutyNameFree(
  departmentId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await prisma.duty.findUnique({
    where: { departmentId_nameKey: { departmentId, nameKey: catalogNameKey(name) } },
    include: { department: { select: { name: true } } },
  });
  if (clash && clash.id !== exceptId) {
    throw HttpError.conflict(
      clash.archivedAt
        ? `An archived duty “${clash.name}” exists in ${clash.department.name} — restore it instead.`
        : `“${clash.name}” already exists in ${clash.department.name}.`,
    );
  }
}

async function getDutyOr404(id: string) {
  const u = await prisma.duty.findUnique({
    where: { id },
    include: { department: { select: { archivedAt: true } }, ...dutyCountSelect },
  });
  if (!u) throw HttpError.notFound('Duty not found');
  return u;
}

const cleanDescription = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : v.trim() || null;

export async function createDuty(departmentId: string, input: CreateDutyInput): Promise<void> {
  const d = await getDepartmentOr404(departmentId);
  if (d.archivedAt) throw HttpError.badRequest('Restore the department before adding duties');
  const name = normalizeCatalogName(input.name);
  await assertDutyNameFree(departmentId, name);
  await prisma.duty.create({
    data: {
      departmentId,
      name,
      nameKey: catalogNameKey(name),
      description: cleanDescription(input.description) ?? null,
    },
  });
}

export async function updateDuty(id: string, input: UpdateDutyInput): Promise<void> {
  const u = await getDutyOr404(id);
  if (u.archivedAt) throw HttpError.badRequest('Restore the duty before editing it');
  const data: Prisma.DutyUpdateInput = {};
  if (input.name !== undefined) {
    const name = normalizeCatalogName(input.name);
    await assertDutyNameFree(u.departmentId, name, id);
    data.name = name;
    data.nameKey = catalogNameKey(name);
  }
  const desc = cleanDescription(input.description);
  if (desc !== undefined) data.description = desc;
  await prisma.duty.update({ where: { id }, data });
}

export async function archiveDuty(id: string): Promise<void> {
  const u = await getDutyOr404(id);
  if (u.archivedAt) return;
  await prisma.duty.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function restoreDuty(id: string): Promise<void> {
  const u = await getDutyOr404(id);
  if (u.department.archivedAt) throw HttpError.badRequest('Restore the department first');
  await prisma.duty.update({ where: { id }, data: { archivedAt: null } });
}

/** Delete a duty nothing has ever referenced. Anything else is archived. */
export async function deleteDuty(id: string): Promise<void> {
  const u = await getDutyOr404(id);
  const c = u._count;
  if (c.holders + c.tasks + c.templateNodes + c.timeEntries > 0) {
    throw HttpError.conflict('This duty has been used, so it can only be archived');
  }
  try {
    await prisma.duty.delete({ where: { id } });
  } catch (err) {
    // A reference landed between the check and the delete (Restrict FK).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw HttpError.conflict('This duty has been used, so it can only be archived');
    }
    throw err;
  }
}
