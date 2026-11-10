import type { DepartmentDto, OrgPersonDto, Role } from '@healthy-tasks/shared';
import { api } from '../api/client';

export interface TeamScope {
  /** Departments in scope: those of the duties I hold (Admins: all). */
  departments: DepartmentDto[];
  /** Everyone the org screen lets me see. */
  people: OrgPersonDto[];
  /** People in my departments, me excluded. */
  teamIds: string[];
}

/**
 * "My team" means everyone in my departments (docs/redesign-decisions.md):
 * the departments of the duties I hold; Admins see every department. Only
 * Admins and Managers can read the org, so others get an empty scope.
 */
export async function loadTeamScope(user: { id: string; role: Role }): Promise<TeamScope> {
  if (user.role !== 'Admin' && user.role !== 'Manager') {
    return { departments: [], people: [], teamIds: [] };
  }
  const [deps, org] = await Promise.all([api.listDepartments(), api.getOrg()]);
  const me = org.people.find((p) => p.id === user.id);
  const mine = new Set(me?.dutyIds ?? []);
  const departments = deps.filter(
    (d) => !d.archived && (user.role === 'Admin' || d.duties.some((x) => mine.has(x.id))),
  );
  const dutyIds = new Set(departments.flatMap((d) => d.duties.map((x) => x.id)));
  const teamIds = org.people
    .filter((p) => p.id !== user.id && p.dutyIds.some((id) => dutyIds.has(id)))
    .map((p) => p.id);
  return { departments, people: org.people, teamIds };
}
