import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, ListTree, Lock } from 'lucide-react';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type TaskPriority,
  type TaskRowDto,
  type TaskSortField,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { Avatar, userLabel } from '../../components/ui/Avatar';
import { Select, type SelectOption } from '../../components/harbor/Select';
import { DatePicker } from '../../components/harbor/DatePicker';
import { PriorityMark, StatusPill, STATUS_TONE, cx } from '../../components/harbor/ui';
import { PeekToggle, TaskPeek, usePeek } from '../../components/harbor/TaskPeek';
import {
  PRIORITY_OPTIONS,
  dueInfo,
  statusOptions,
  ymdFromIso,
} from '../../components/harbor/taskHelpers';
import { dutyLabel } from '@healthy-tasks/shared';
import { groupRows, type GroupBy } from './grouping';

export type OptionalColumn = 'start' | 'created' | 'tags' | 'attributes';

export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: 'start', label: 'Start date' },
  { key: 'created', label: 'Created' },
  { key: 'tags', label: 'Tags' },
  { key: 'attributes', label: 'Alert group & type' },
];

export interface RowEdit {
  assigneeId?: string | null;
  dueYmd?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
}

function Th({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  className,
}: {
  field?: TaskSortField;
  label: string;
  sortField: TaskSortField;
  sortDir: 'asc' | 'desc';
  onSort: (f: TaskSortField) => void;
  className?: string;
}) {
  if (!field) return <th className={className}>{label}</th>;
  const on = sortField === field;
  return (
    <th
      className={className}
      aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className={cx('hb-th', on && 'on')} onClick={() => onSort(field)}>
        {label}
        {on &&
          (sortDir === 'asc' ? (
            <ArrowUp size={13} aria-hidden="true" />
          ) : (
            <ArrowDown size={13} aria-hidden="true" />
          ))}
      </button>
    </th>
  );
}

/**
 * The full-width task table (§6.2): quick changes happen in the row itself —
 * Owner, Due (calendar), Status and Priority are inline dropdowns that look
 * like plain text or pills with a faint ▾.
 */
export function TaskTable({
  rows,
  owners,
  selected,
  onSelect,
  onSelectAll,
  onEdit,
  sortField,
  sortDir,
  onSort,
  flash,
  columns,
  showOwner,
  groupBy = 'none',
}: {
  rows: TaskRowDto[];
  owners: SelectOption<string>[];
  selected: Set<number>;
  onSelect: (id: number, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onEdit: (row: TaskRowDto, edit: RowEdit) => void;
  sortField: TaskSortField;
  sortDir: 'asc' | 'desc';
  onSort: (f: TaskSortField) => void;
  flash: Set<number>;
  columns: Set<OptionalColumn>;
  showOwner: boolean;
  /** Group header rows (Status / Owner / Department / Due date); 'none' for a plain list. */
  groupBy?: GroupBy;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const editable = rows.filter((r) => !r.mentionOnly && !r.treeOnly);
  const all = editable.length > 0 && editable.every((r) => selected.has(r.id));
  const some = editable.some((r) => selected.has(r.id));
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some && !all;
  }, [some, all]);

  const th = { sortField, sortDir, onSort };
  const peek = usePeek();
  const groups = groupRows(rows, groupBy);
  const grouped = groupBy !== 'none';
  // Folded groups, for this visit; a new grouping starts all open.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => setFolded(new Set()), [groupBy]);
  const toggleGroup = (k: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const colCount =
    5 +
    (showOwner ? 1 : 0) +
    ['start', 'created', 'tags', 'attributes'].filter((c) => columns.has(c as OptionalColumn))
      .length;

  return (
    <div className="hb-table-wrap">
      <table className="hb-table">
        <thead>
          <tr>
            <th className="hb-check">
              <label className="hb-hit">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={all}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  aria-label="Select all shown tasks"
                />
              </label>
            </th>
            <Th field="name" label="Task" {...th} className="hb-col-task" />
            {showOwner && <Th field="assignee" label="Owner" {...th} />}
            <Th field="dueAt" label="Due" {...th} />
            <Th field="status" label="Status" {...th} />
            <Th field="priority" label="Priority" {...th} />
            {columns.has('start') && <Th field="startAt" label="Start" {...th} />}
            {columns.has('created') && <Th field="createdAt" label="Created" {...th} />}
            {columns.has('tags') && <Th label="Tags" {...th} />}
            {columns.has('attributes') && <Th label="Alert group · type" {...th} />}
          </tr>
        </thead>
        {groups.map((g) => {
          const isFolded = grouped && folded.has(g.key);
          return (
            <tbody key={g.key} className={cx(grouped && 'hb-group')}>
              {grouped && (
                <tr className="hb-group-row">
                  <th colSpan={colCount} scope="rowgroup">
                    <button
                      type="button"
                      className={cx('hb-group-btn', !isFolded && 'is-open')}
                      aria-expanded={!isFolded}
                      onClick={() => toggleGroup(g.key)}
                    >
                      <ChevronRight size={14} aria-hidden="true" />
                      {g.dot && <span className="hb-dot" style={{ background: g.dot }} />}
                      <span className="hb-group-label">{g.label}</span>
                      <span className="hb-group-count">{g.rows.length}</span>
                    </button>
                  </th>
                </tr>
              )}
              {!isFolded &&
                g.rows.map((t) => {
                  const ro = t.mentionOnly || t.treeOnly;
                  const due = dueInfo(t.dueAt, t.status);
                  const open = peek.isOpen(t.id);
                  return (
                    <Fragment key={t.id}>
                      <tr
                        id={`task-row-${t.id}`}
                        className={cx(
                          selected.has(t.id) && 'selected',
                          flash.has(t.id) && 'flash',
                          open && 'is-peek',
                          !!t.depth && 'is-child',
                        )}
                      >
                        <td className="hb-check">
                          <label className="hb-hit">
                            <input
                              type="checkbox"
                              checked={selected.has(t.id)}
                              disabled={ro}
                              onChange={(e) => onSelect(t.id, e.target.checked)}
                              aria-label={`Select ${t.name}`}
                            />
                          </label>
                        </td>
                        <td
                          className="hb-col-task"
                          style={
                            t.depth
                              ? ({
                                  paddingLeft: 12 + t.depth * 22,
                                  ['--tree-x' as string]: `${t.depth * 22 - 2}px`,
                                } as CSSProperties)
                              : undefined
                          }
                        >
                          <div className="hb-task-cell has-peek">
                            <PeekToggle
                              open={open}
                              onToggle={() => peek.toggle(t.id)}
                              name={t.name}
                              controls={`task-peek-${t.id}`}
                            />
                            <Link to={`/tasks/${t.id}`} className="hb-task-name">
                              {t.name}
                            </Link>
                            <span className="hb-task-sub">
                              #{t.id}
                              {t.duty && <> · {dutyLabel(t.duty)}</>}
                              {!!t.depth && t.parentId && <> · sub-task of #{t.parentId}</>}
                              {t.childrenCount > 0 && (
                                <span className="hb-sub-count">
                                  <ListTree size={11} aria-hidden="true" />
                                  {t.childrenCount} sub-task{t.childrenCount === 1 ? '' : 's'}
                                </span>
                              )}
                              {t.dutyMismatch && (
                                <span className="hb-warn-note">
                                  {' '}
                                  · owner doesn’t hold this duty
                                </span>
                              )}
                              {ro && (
                                <span
                                  className="hb-ro"
                                  title={
                                    t.mentionOnly
                                      ? 'You were mentioned: read-only'
                                      : 'Visible through its parent: read-only'
                                  }
                                >
                                  <Lock size={11} aria-hidden="true" /> read-only
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        {showOwner && (
                          <td>
                            {ro ? (
                              <span className="hb-owner">
                                {t.assignee ? (
                                  <Avatar user={t.assignee} px={26} decorative />
                                ) : (
                                  <span className="hb-unassigned">?</span>
                                )}
                                {t.assignee ? userLabel(t.assignee) : 'Unassigned'}
                              </span>
                            ) : (
                              <Select
                                variant="plain"
                                label={`Owner of ${t.name}`}
                                value={t.assignee?.id ?? '__unassigned'}
                                options={owners}
                                searchPlaceholder="Search people…"
                                onChange={(v) =>
                                  onEdit(t, { assigneeId: v === '__unassigned' ? null : v })
                                }
                              />
                            )}
                          </td>
                        )}
                        <td>
                          {ro ? (
                            <span className={cx('hb-due-cell', due?.late && 'late')}>
                              {due?.text ?? '—'}
                            </span>
                          ) : (
                            <DatePicker
                              variant="plain"
                              label={`Due date of ${t.name}`}
                              value={ymdFromIso(t.dueAt)}
                              placeholder="No date"
                              className={cx('hb-due-cell', due?.late && 'late')}
                              renderValue={() => due?.text ?? 'No date'}
                              overdueNote={due?.late ? `Currently ${due.text}` : undefined}
                              onChange={(v) => onEdit(t, { dueYmd: v })}
                            />
                          )}
                        </td>
                        <td>
                          {ro || t.status === 'Review' ? (
                            <StatusPill status={t.status} />
                          ) : (
                            <Select
                              variant="pill"
                              className={`tone-${STATUS_TONE[t.status]}`}
                              label={`Status of ${t.name}`}
                              value={t.status}
                              options={statusOptions(t.status)}
                              onChange={(s) => onEdit(t, { status: s })}
                            />
                          )}
                        </td>
                        <td>
                          {ro ? (
                            <PriorityMark priority={t.priority} />
                          ) : (
                            <Select
                              variant="plain"
                              className={cx('hb-prio', `prio-${t.priority.toLowerCase()}`)}
                              label={`Priority of ${t.name}`}
                              value={t.priority}
                              options={PRIORITY_OPTIONS}
                              onChange={(p) => onEdit(t, { priority: p })}
                            />
                          )}
                        </td>
                        {columns.has('start') && (
                          <td className="hb-muted-cell">
                            {t.startAt
                              ? new Date(t.startAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : '—'}
                          </td>
                        )}
                        {columns.has('created') && (
                          <td className="hb-muted-cell">
                            {new Date(t.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </td>
                        )}
                        {columns.has('tags') && (
                          <td>
                            {t.tags.length === 0 ? (
                              <span className="hb-muted-cell">—</span>
                            ) : (
                              <span className="hb-tags">
                                {t.tags.map((g) => (
                                  <span key={g} className="hb-tag">
                                    {g}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        )}
                        {columns.has('attributes') && (
                          <td className="hb-muted-cell">
                            {[
                              t.alertGroup?.name,
                              t.alertType ? EXCLUSIVES_ALERT_TYPE_LABELS[t.alertType] : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr className="hb-peek-row">
                          <td colSpan={colCount}>
                            <TaskPeek id={t.id} panelId={`task-peek-${t.id}`} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
