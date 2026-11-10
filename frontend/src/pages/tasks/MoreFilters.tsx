import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertType,
  type ExclusivesGroupOptionDto,
  type TaskRelationFilter,
  type TaskSearchFilters,
} from '@healthy-tasks/shared';
import { Popover } from '../../components/harbor/Popover';
import { Select, type SelectOption } from '../../components/harbor/Select';
import { DatePicker } from '../../components/harbor/DatePicker';

const NONE = '__none';
const NOT_SET = '__notset';

/**
 * "+ Filter": the less common filters. Each one applied shows as its own chip
 * in the toolbar (never hidden), so this only ever adds.
 */
export function MoreFilters({
  extra,
  onChange,
  tags,
  people,
  groups,
}: {
  extra: TaskSearchFilters;
  onChange: (next: TaskSearchFilters) => void;
  tags: string[];
  people: SelectOption<string>[];
  groups: ExclusivesGroupOptionDto[];
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [batch, setBatch] = useState(extra.instanceLabel ?? '');
  const set = (patch: TaskSearchFilters) => onChange({ ...extra, ...patch });

  const tagOptions: SelectOption<string>[] = [
    { value: NONE, label: 'Any tag' },
    ...tags.map((t) => ({ value: t, label: t })),
  ];
  const creatorOptions: SelectOption<string>[] = [
    { value: NONE, label: 'Anyone' },
    ...people.filter((p) => p.value !== '__unassigned'),
  ];
  const groupOptions: SelectOption<string>[] = [
    { value: NONE, label: 'Any group' },
    { value: NOT_SET, label: '(not set)' },
    ...groups.map((g) => ({
      value: String(g.id),
      label: g.name,
      hint: g.isActive ? undefined : 'off',
    })),
  ];
  const typeOptions: SelectOption<string>[] = [
    { value: NONE, label: 'Any type' },
    { value: NOT_SET, label: '(not set)' },
    ...EXCLUSIVES_ALERT_TYPES.map((t) => ({ value: t, label: EXCLUSIVES_ALERT_TYPE_LABELS[t] })),
  ];
  const relationOptions: SelectOption<string>[] = [
    { value: NONE, label: 'Any' },
    { value: 'parent', label: 'Parent tasks' },
    { value: 'child', label: 'Sub-tasks' },
    { value: 'standalone', label: 'Standalone tasks' },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-select hb-select-chip hb-add-filter"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={14} aria-hidden="true" /> Filter
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={340}
        matchWidth={false}
        className="hb-filters-pop"
        label="More filters"
        closeOnTab={false}
      >
        <div className="hb-fp-grid">
          <span className="hb-label">Tag</span>
          <Select
            label="Tag"
            value={extra.tags?.[0] ?? NONE}
            options={tagOptions}
            onChange={(v) => set({ tags: v === NONE ? undefined : [v] })}
          />
          <span className="hb-label">Created by</span>
          <Select
            label="Created by"
            value={extra.creatorIds?.[0] ?? NONE}
            options={creatorOptions}
            onChange={(v) => set({ creatorIds: v === NONE ? undefined : [v] })}
          />
          <span className="hb-label">Alert group</span>
          <Select
            label="Alert group"
            value={
              extra.includeNoAlertGroup
                ? NOT_SET
                : extra.alertGroupIds?.[0]
                  ? String(extra.alertGroupIds[0])
                  : NONE
            }
            options={groupOptions}
            onChange={(v) =>
              set({
                alertGroupIds: v === NONE || v === NOT_SET ? undefined : [Number(v)],
                includeNoAlertGroup: v === NOT_SET ? true : undefined,
              })
            }
          />
          <span className="hb-label">Alert type</span>
          <Select
            label="Alert type"
            value={extra.includeNoAlertType ? NOT_SET : (extra.alertTypes?.[0] ?? NONE)}
            options={typeOptions}
            onChange={(v) =>
              set({
                alertTypes: v === NONE || v === NOT_SET ? undefined : [v as ExclusivesAlertType],
                includeNoAlertType: v === NOT_SET ? true : undefined,
              })
            }
          />
          <span className="hb-label">Due between</span>
          <span className="hb-fp-range">
            <DatePicker
              label="Due from"
              value={extra.dueFrom ?? null}
              placeholder="From"
              onChange={(v) =>
                set({ dueFrom: v ?? undefined, includeNoDue: v || extra.dueTo ? false : undefined })
              }
            />
            <DatePicker
              label="Due to"
              value={extra.dueTo ?? null}
              placeholder="To"
              onChange={(v) =>
                set({ dueTo: v ?? undefined, includeNoDue: v || extra.dueFrom ? false : undefined })
              }
            />
          </span>
          <span className="hb-label">Starts between</span>
          <span className="hb-fp-range">
            <DatePicker
              label="Starts from"
              value={extra.startFrom ?? null}
              placeholder="From"
              onChange={(v) =>
                set({
                  startFrom: v ?? undefined,
                  includeNoStart: v || extra.startTo ? false : undefined,
                })
              }
            />
            <DatePicker
              label="Starts to"
              value={extra.startTo ?? null}
              placeholder="To"
              onChange={(v) =>
                set({
                  startTo: v ?? undefined,
                  includeNoStart: v || extra.startFrom ? false : undefined,
                })
              }
            />
          </span>
          <span className="hb-label">Status changed</span>
          <span className="hb-fp-range">
            <DatePicker
              label="Status changed from"
              value={extra.statusChangedFrom ?? null}
              placeholder="From"
              onChange={(v) => set({ statusChangedFrom: v ?? undefined })}
            />
            <DatePicker
              label="Status changed to"
              value={extra.statusChangedTo ?? null}
              placeholder="To"
              onChange={(v) => set({ statusChangedTo: v ?? undefined })}
            />
          </span>
          <span className="hb-label">Parent / sub-task</span>
          <Select
            label="Parent or sub-task"
            value={extra.relation ?? NONE}
            options={relationOptions}
            onChange={(v) => set({ relation: v === NONE ? undefined : (v as TaskRelationFilter) })}
          />
          <span className="hb-label">PO / batch</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set({ instanceLabel: batch.trim() || undefined });
            }}
          >
            <input
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              onBlur={() => set({ instanceLabel: batch.trim() || undefined })}
              placeholder="Label on a template’s tasks"
              aria-label="PO or batch label"
            />
          </form>
        </div>
        <div className="hb-fp-toggles">
          <label>
            <input
              type="checkbox"
              checked={!!extra.blocked}
              onChange={(e) => set({ blocked: e.target.checked || undefined })}
            />
            Blocked by another task
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!extra.dutyMismatch}
              onChange={(e) => set({ dutyMismatch: e.target.checked || undefined })}
            />
            Owner doesn’t hold the task’s duty
          </label>
        </div>
      </Popover>
    </>
  );
}
