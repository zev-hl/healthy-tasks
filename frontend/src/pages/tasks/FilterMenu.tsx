import { useRef, useState, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type DepartmentDto,
  type ExclusivesGroupOptionDto,
  type TaskSearchFilters,
} from '@healthy-tasks/shared';
import { Popover } from '../../components/harbor/Popover';
import type { SelectOption } from '../../components/harbor/Select';
import { STATUS_DOT, cx } from '../../components/harbor/ui';
import { MoreFilterFields } from './MoreFilters';
import { STATUS_PRESETS, type StatusPreset } from './viewState';

const SHOW_PRESETS = STATUS_PRESETS.filter((p) => !p.value.startsWith('s:'));
const UNASSIGNED = '__unassigned';

/** Toggle `x` in a list; an empty list becomes undefined (no filter). */
function toggle<T>(list: T[] | undefined, x: T): T[] | undefined {
  const next = list?.includes(x) ? list.filter((y) => y !== x) : [...(list ?? []), x];
  return next.length > 0 ? next : undefined;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="hb-fm-section">
      <legend>{title}</legend>
      <div className="hb-fm-opts">{children}</div>
    </fieldset>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className={cx('hb-fm-opt', checked && 'is-on')}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

/**
 * The Tasks list's one filter menu (Nov 2026 plan): every filter in one
 * place, each a list you can pick several from. No chips in the toolbar: the
 * button says how many filters are on, and the menu lists them.
 */
export function FilterMenu({
  status,
  onStatus,
  extra,
  onChange,
  onClear,
  showAssignee,
  people,
  departments,
  tags,
  groups,
  applied,
}: {
  status: StatusPreset;
  onStatus: (s: StatusPreset) => void;
  extra: TaskSearchFilters;
  onChange: (next: TaskSearchFilters) => void;
  onClear: () => void;
  /** Off on My tasks, where the assignee is always you. */
  showAssignee: boolean;
  people: SelectOption<string>[];
  departments: DepartmentDto[];
  tags: string[];
  groups: ExclusivesGroupOptionDto[];
  /** One label per filter that's on. */
  applied: string[];
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const set = (patch: TaskSearchFilters) => onChange({ ...extra, ...patch });

  const pickedDepts = extra.departmentIds ?? [];
  const dutyDepts =
    pickedDepts.length > 0 ? departments.filter((d) => pickedDepts.includes(d.id)) : departments;
  const q = who.trim().toLowerCase();
  const shownPeople = people.filter(
    (p) => p.value !== UNASSIGNED && (!q || p.label.toLowerCase().includes(q)),
  );
  const count = applied.length;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx('hb-select hb-select-chip hb-filter-btn', count > 0 && 'is-active')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={count > 0 ? applied.join('\n') : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <ListFilter size={15} aria-hidden="true" /> Filter
        {count > 0 && <span className="hb-filter-count">{count}</span>}
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={380}
        matchWidth={false}
        className="hb-filters-pop hb-fm"
        label="Filter tasks"
        closeOnTab={false}
      >
        {count > 0 && (
          <div className="hb-fm-applied">
            <span>{applied.join(' · ')}</span>
            <button type="button" className="hb-btn hb-btn-link" onClick={onClear}>
              Clear all
            </button>
          </div>
        )}

        <Section title="Show">
          {SHOW_PRESETS.map((p) => (
            <label key={p.value} className={cx('hb-fm-opt', status === p.value && 'is-on')}>
              <input
                type="radio"
                name="hb-fm-show"
                checked={status === p.value}
                onChange={() => onStatus(p.value)}
              />
              {p.label}
            </label>
          ))}
        </Section>

        <Section title="Snoozed">
          {(
            [
              ['hide', 'Hide snoozed'],
              ['only', 'Only snoozed'],
              ['include', 'Show both'],
            ] as const
          ).map(([v, label]) => {
            const cur = extra.snoozed ?? 'hide';
            return (
              <label key={v} className={cx('hb-fm-opt', cur === v && 'is-on')}>
                <input
                  type="radio"
                  name="hb-fm-snoozed"
                  checked={cur === v}
                  onChange={() => set({ snoozed: v === 'hide' ? undefined : v })}
                />
                {label}
              </label>
            );
          })}
        </Section>

        <Section title="Status">
          {TASK_STATUSES.map((s) => (
            <Check
              key={s}
              checked={!!extra.statuses?.includes(s)}
              onChange={() => set({ statuses: toggle(extra.statuses, s) })}
            >
              <span className="hb-dot" style={{ background: STATUS_DOT[s] }} aria-hidden="true" />
              {TASK_STATUS_LABELS[s]}
            </Check>
          ))}
        </Section>

        <Section title="Priority">
          {TASK_PRIORITIES.map((p) => (
            <Check
              key={p}
              checked={!!extra.priorities?.includes(p)}
              onChange={() => set({ priorities: toggle(extra.priorities, p) })}
            >
              {p}
            </Check>
          ))}
        </Section>

        {showAssignee && (
          <Section title="Assignee">
            <input
              className="hb-fm-search"
              type="search"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
            />
            <div className="hb-fm-scroll">
              <Check
                checked={!!extra.includeUnassigned}
                onChange={() =>
                  set({ includeUnassigned: extra.includeUnassigned ? undefined : true })
                }
              >
                Unassigned
              </Check>
              {shownPeople.map((p) => (
                <Check
                  key={p.value}
                  checked={!!extra.assigneeIds?.includes(p.value)}
                  onChange={() => set({ assigneeIds: toggle(extra.assigneeIds, p.value) })}
                >
                  {p.label}
                </Check>
              ))}
            </div>
          </Section>
        )}

        {departments.length > 0 && (
          <Section title="Department">
            {departments.map((d) => (
              <Check
                key={d.id}
                checked={pickedDepts.includes(d.id)}
                onChange={() => set({ departmentIds: toggle(extra.departmentIds, d.id) })}
              >
                <span className="hb-dot" style={{ background: d.color }} aria-hidden="true" />
                {d.name}
              </Check>
            ))}
          </Section>
        )}

        {dutyDepts.some((d) => d.duties.length > 0) && (
          <Section title="Duty">
            <div className="hb-fm-scroll">
              {dutyDepts.flatMap((d) =>
                d.duties
                  .filter((x) => !x.archived)
                  .map((x) => (
                    <Check
                      key={x.id}
                      checked={!!extra.dutyIds?.includes(x.id)}
                      onChange={() => set({ dutyIds: toggle(extra.dutyIds, x.id) })}
                    >
                      {dutyDepts.length > 1 ? `${d.name} › ${x.name}` : x.name}
                    </Check>
                  )),
              )}
            </div>
          </Section>
        )}

        {tags.length > 0 && (
          <Section title="Tags">
            <div className="hb-fm-scroll">
              {tags.map((t) => (
                <Check
                  key={t}
                  checked={!!extra.tags?.includes(t)}
                  onChange={() => set({ tags: toggle(extra.tags, t) })}
                >
                  {t}
                </Check>
              ))}
            </div>
          </Section>
        )}

        <details className="hb-fm-more">
          <summary>More: dates, creator, alerts, batch</summary>
          <MoreFilterFields extra={extra} onChange={onChange} people={people} groups={groups} />
        </details>
      </Popover>
    </>
  );
}
