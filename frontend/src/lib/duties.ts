import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DUTY_NOT_HELD_CODE,
  dutyLabel,
  type DepartmentDto,
  type DutyHoldingsDto,
  type DutyRef,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

/**
 * Department Duties helpers shared by the task, template, organization and time
 * screens: the catalog as a lookup, who holds what, and the grouped option
 * lists behind the assignee ⇄ duty cross-check.
 */

export interface CatalogDuty extends DutyRef {
  description: string | null;
}

/** Every duty (archived included) by id, as a DutyRef plus its description. */
export function indexDuties(departments: DepartmentDto[]): Map<string, CatalogDuty> {
  const out = new Map<string, CatalogDuty>();
  for (const d of departments) {
    for (const u of d.duties) {
      out.set(u.id, {
        id: u.id,
        name: u.name,
        departmentId: d.id,
        departmentName: d.name,
        color: d.color,
        archived: u.archived || d.archived,
        description: u.description,
      });
    }
  }
  return out;
}

export function holdsDuty(holdings: DutyHoldingsDto, userId: string, dutyId: string): boolean {
  return (holdings[userId] ?? []).includes(dutyId);
}

/** True when both are set and the person doesn't hold the duty (the ⚠ case). */
export function isMismatch(
  holdings: DutyHoldingsDto,
  assigneeId: string | null | undefined,
  dutyId: string | null | undefined,
): boolean {
  return !!assigneeId && !!dutyId && !holdsDuty(holdings, assigneeId, dutyId);
}

/** Read a 422 DUTY_NOT_HELD error, if that's what this is. */
export function isDutyNotHeldError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    (err.details as { code?: string } | undefined)?.code === DUTY_NOT_HELD_CODE
  );
}

// --- Picker option groups ----------------------------------------------------

export interface PickerOption {
  value: string;
  label: string;
  /** Picking this would break the assignee ⇄ duty rule (rendered with ⚠). */
  warn?: boolean;
}

export interface PickerGroup {
  label: string;
  options: PickerOption[];
}

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/**
 * Duty picker: one "Department › Duty" list grouped by department. With an
 * assignee chosen, their own duties come first and every other duty is marked
 * ⚠ under "<Dept> — <Name> doesn't hold these". An archived duty that is the
 * current value stays visible (labelled archived) so it never silently drops.
 */
export function dutyOptionGroups(
  departments: DepartmentDto[],
  opts: {
    holdings: DutyHoldingsDto;
    assignee?: { id: string; firstName: string } | null;
    selectedId?: string | null;
  },
): PickerGroup[] {
  const active = departments
    .filter((d) => !d.archived)
    .map((d) => ({ dept: d, duties: d.duties.filter((u) => !u.archived) }))
    .filter((x) => x.duties.length > 0);
  const groups: PickerGroup[] = [];
  const held = new Set(opts.assignee ? (opts.holdings[opts.assignee.id] ?? []) : []);

  if (opts.assignee) {
    const name = opts.assignee.firstName || 'This person';
    const mine = active
      .flatMap(({ dept, duties }) =>
        duties
          .filter((u) => held.has(u.id))
          .map((u) => ({
            value: u.id,
            label: dutyLabel({ departmentName: dept.name, name: u.name }),
          })),
      )
      .sort(byLabel);
    groups.push({ label: `${name}’s duties`, options: mine });
    for (const { dept, duties } of active) {
      const rest = duties
        .filter((u) => !held.has(u.id))
        .map((u) => ({ value: u.id, label: `⚠ ${dept.name} › ${u.name}`, warn: true }))
        .sort(byLabel);
      if (rest.length)
        groups.push({ label: `${dept.name} — ${name} doesn’t hold these`, options: rest });
    }
  } else {
    for (const { dept, duties } of active) {
      groups.push({
        label: dept.name,
        options: duties
          .map((u) => ({ value: u.id, label: `${dept.name} › ${u.name}` }))
          .sort(byLabel),
      });
    }
  }

  if (opts.selectedId && !groups.some((g) => g.options.some((o) => o.value === opts.selectedId))) {
    const index = indexDuties(departments);
    const sel = index.get(opts.selectedId);
    if (sel) {
      groups.push({
        label: 'Current',
        options: [
          {
            value: sel.id,
            label: `${dutyLabel(sel)}${sel.archived ? ' (archived)' : ''}`,
            warn: !!opts.assignee && !held.has(sel.id),
          },
        ],
      });
    }
  }
  return groups;
}

export interface PersonLike {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

const personName = (p: PersonLike) => `${p.firstName} ${p.lastName}`.trim() || p.email;

/**
 * Assignee picker: with a duty chosen, people split into "Hold <duty>" and
 * "Don't hold this duty" (⚠). Without one, a single alphabetical list.
 */
export function assigneeOptionGroups(
  people: PersonLike[],
  opts: { holdings: DutyHoldingsDto; duty?: DutyRef | null },
): PickerGroup[] {
  const sorted = [...people].sort((a, b) => personName(a).localeCompare(personName(b)));
  const opt = (p: PersonLike, warn = false): PickerOption => ({
    value: p.id,
    label: `${warn ? '⚠ ' : ''}${personName(p)}`,
    warn,
  });
  if (!opts.duty) return [{ label: '', options: sorted.map((p) => opt(p)) }];
  const has = sorted.filter((p) => holdsDuty(opts.holdings, p.id, opts.duty!.id));
  const not = sorted.filter((p) => !holdsDuty(opts.holdings, p.id, opts.duty!.id));
  return [
    { label: `Hold ${dutyLabel(opts.duty)}`, options: has.map((p) => opt(p)) },
    { label: 'Don’t hold this duty', options: not.map((p) => opt(p, true)) },
  ];
}

// --- Data hook -----------------------------------------------------------------

/**
 * The catalog + who holds which duty, loaded once per screen. `reload` refreshes
 * both (after "Give this duty" or a Re-check); `grantLocally` reflects a grant
 * without a round trip.
 */
export function useDutyCatalog(): {
  departments: DepartmentDto[];
  duties: Map<string, CatalogDuty>;
  holdings: DutyHoldingsDto;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  grantLocally: (userId: string, dutyId: string) => void;
} {
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [holdings, setHoldings] = useState<DutyHoldingsDto>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([api.listDepartments(), api.getDutyHoldings()]);
      setDepartments(d);
      setHoldings(h);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load departments and duties');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grantLocally = useCallback((userId: string, dutyId: string) => {
    setHoldings((h) => ({ ...h, [userId]: [...new Set([...(h[userId] ?? []), dutyId])] }));
  }, []);

  const duties = useMemo(() => indexDuties(departments), [departments]);
  return { departments, duties, holdings, loading, error, reload, grantLocally };
}
