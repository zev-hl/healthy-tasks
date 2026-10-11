import { describe, expect, it } from 'vitest';
import type { DepartmentDto, DutyDto } from '@healthy-tasks/shared';
import {
  assigneeOptionGroups,
  dutyOptionGroups,
  holdsDuty,
  indexDuties,
  isMismatch,
} from './duties';

const duty = (id: string, departmentId: string, name: string, archived = false): DutyDto => ({
  id,
  departmentId,
  name,
  description: null,
  archived,
  peopleCount: 0,
  openTaskCount: 0,
  inUse: false,
});

const DEPTS: DepartmentDto[] = [
  {
    id: 'fin',
    name: 'Finance',
    color: '#7857c8',
    archived: false,
    peopleCount: 1,
    duties: [duty('ap', 'fin', 'Accounts payable'), duty('inv', 'fin', 'Invoicing')],
  },
  {
    id: 'ful',
    name: 'Fulfillment',
    color: '#b8720a',
    archived: false,
    peopleCount: 2,
    duties: [
      duty('pack', 'ful', 'Packing'),
      duty('recv', 'ful', 'Receiving'),
      duty('old', 'ful', 'Label printing', true),
    ],
  },
  { id: 'fac', name: 'Facilities', color: '#8a8177', archived: false, peopleCount: 0, duties: [] },
];

const HOLDINGS = { grace: ['pack'], tomas: ['pack', 'recv'], maria: ['ap'] };

describe('duty holdings', () => {
  it('knows who holds what, and flags a mismatch only when both are set', () => {
    expect(holdsDuty(HOLDINGS, 'grace', 'pack')).toBe(true);
    expect(holdsDuty(HOLDINGS, 'grace', 'recv')).toBe(false);
    expect(holdsDuty(HOLDINGS, 'nobody', 'pack')).toBe(false);
    expect(isMismatch(HOLDINGS, 'grace', 'recv')).toBe(true);
    expect(isMismatch(HOLDINGS, 'grace', 'pack')).toBe(false);
    expect(isMismatch(HOLDINGS, null, 'recv')).toBe(false);
    expect(isMismatch(HOLDINGS, 'grace', null)).toBe(false);
  });

  it('indexes every duty with its department, archived included', () => {
    const idx = indexDuties(DEPTS);
    expect(idx.get('recv')).toMatchObject({
      departmentName: 'Fulfillment',
      color: '#b8720a',
      archived: false,
    });
    expect(idx.get('old')?.archived).toBe(true);
  });
});

describe('duty picker groups', () => {
  it('without an assignee: one group per department with active duties, labelled Dept › Duty', () => {
    const groups = dutyOptionGroups(DEPTS, { holdings: HOLDINGS });
    expect(groups.map((g) => g.label)).toEqual(['Finance', 'Fulfillment']);
    expect(groups[1]!.options.map((o) => o.label)).toEqual([
      'Fulfillment › Packing',
      'Fulfillment › Receiving',
    ]);
    expect(groups.flatMap((g) => g.options).some((o) => o.value === 'old')).toBe(false);
  });

  it('with an assignee: their duties first, everything else marked ⚠', () => {
    const groups = dutyOptionGroups(DEPTS, {
      holdings: HOLDINGS,
      assignee: { id: 'grace', firstName: 'Grace' },
    });
    expect(groups[0]).toEqual({
      label: 'Grace’s duties',
      options: [{ value: 'pack', label: 'Fulfillment › Packing' }],
    });
    expect(groups.map((g) => g.label)).toEqual([
      'Grace’s duties',
      'Finance — Grace doesn’t hold these',
      'Fulfillment — Grace doesn’t hold these',
    ]);
    const recv = groups[2]!.options[0]!;
    expect(recv).toMatchObject({ value: 'recv', warn: true });
    expect(recv.label.startsWith('⚠')).toBe(true);
  });

  it('keeps an archived current value visible so it never silently disappears', () => {
    const groups = dutyOptionGroups(DEPTS, { holdings: HOLDINGS, selectedId: 'old' });
    const last = groups[groups.length - 1]!;
    expect(last.options).toEqual([
      { value: 'old', label: 'Fulfillment › Label printing (archived)', warn: false },
    ]);
  });
});

describe('assignee picker groups', () => {
  const people = [
    { id: 'tomas', firstName: 'Tomas', lastName: 'Rivera', email: 't@x' },
    { id: 'grace', firstName: 'Grace', lastName: 'Kim', email: 'g@x' },
    { id: 'maria', firstName: 'Maria', lastName: 'Chen', email: 'm@x' },
  ];

  it('is one alphabetical list without a duty', () => {
    const groups = assigneeOptionGroups(people, { holdings: HOLDINGS });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.options.map((o) => o.label)).toEqual([
      'Grace Kim',
      'Maria Chen',
      'Tomas Rivera',
    ]);
  });

  it('splits into holders and ⚠ non-holders once a duty is picked', () => {
    const recv = indexDuties(DEPTS).get('recv')!;
    const groups = assigneeOptionGroups(people, { holdings: HOLDINGS, duty: recv });
    expect(groups[0]!.label).toBe('Hold Fulfillment › Receiving');
    expect(groups[0]!.options.map((o) => o.value)).toEqual(['tomas']);
    expect(groups[1]!.label).toBe('Don’t hold this duty');
    expect(groups[1]!.options.map((o) => o.label)).toEqual(['⚠ Grace Kim', '⚠ Maria Chen']);
  });
});
