import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileStack,
  GripVertical,
  Link2,
  ListTree,
  CornerDownRight,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  RotateCw,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  RECURRENCE_UNIT_LABELS,
  RECURRENCE_UNITS,
  TASK_PRIORITIES,
  moveTemplateNode,
  templateSubtreeKeys,
  type ActiveUserDto,
  type CreateTemplateRequest,
  type FutureOccurrenceDto,
  type RecurrenceEndType,
  type RecurrenceType,
  type RecurrenceUnit,
  type TaskPriority,
  type TemplateDropPosition,
  type TemplateDto,
  type TemplateDutyProblemDto,
  type TemplateNodeInput,
  type TemplateSummaryDto,
  dutyLabel,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { todayLocalDate } from '../lib/datetime';
import { addDays, formatDay } from '../lib/calendar';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { useAuth } from '../auth/AuthContext';
import { ModalShell } from '../components/exclusives/ModalShell';
import { confirmDiscard, useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { DutyTag } from '../components/duties/DutyTag';
import { dutyOptionGroups, holdsDuty, isDutyNotHeldError, useDutyCatalog } from '../lib/duties';
import { WeekdayPicker } from '../components/WeekdayPicker';
import { RichTextEditor } from '../components/RichTextEditor';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { DatePicker } from '../components/harbor/DatePicker';
import { useToast } from '../components/harbor/Toast';
import {
  Btn,
  Card,
  CardHead,
  Empty,
  PRIORITY_DOT,
  Pill,
  PriorityMark,
  Segmented,
  cx,
  type Tone,
} from '../components/harbor/ui';

/**
 * Templates, Harbor redesign. The list is a searchable card of templates
 * with a side panel (how templates work, the repeating schedules). The
 * editor follows the task page: the template's details and its task tree on
 * the left, how it repeats and what it makes on the right, and one Save bar.
 * Each task in the tree is a row (drag handle, name, its settings as chips)
 * that opens in place to edit everything else. "Create tasks" (instantiate)
 * asks for Day 0, a label and who fills each role, then checks duties.
 */

// --- Editor model ----------------------------------------------------------

interface EditorNode {
  key: string;
  id?: number;
  parentKey: string | null;
  name: string;
  description: string;
  defaultPriority: TaskPriority;
  startOffsetDays: string;
  dueOffsetDays: string;
  assigneeRole: string;
  dutyId: string; // Department Duties: '' = no duty
  tags: string; // comma-separated in the form; parsed to string[] on save
  attachmentCount: number; // default attachments carried by this node (read-only)
}
interface EditorRecurrence {
  recurrenceType: RecurrenceType;
  intervalCount: string;
  intervalUnit: RecurrenceUnit;
  weekdays: number[];
  anchorDate: string;
  endType: RecurrenceEndType;
  endDate: string;
  maxOccurrences: string;
  labelPrefix: string;
  isActive: boolean;
}
interface EditorState {
  id?: number;
  name: string;
  description: string;
  nodes: EditorNode[];
  dependencies: { blockerKey: string; blockedKey: string }[];
  recurrence: EditorRecurrence;
}

const emptyRecurrence = (): EditorRecurrence => ({
  recurrenceType: 'None',
  intervalCount: '1',
  intervalUnit: 'Week',
  weekdays: [],
  anchorDate: '',
  endType: 'Never',
  endDate: '',
  maxOccurrences: '3',
  labelPrefix: '',
  isActive: true,
});

function blankNode(key: string, parentKey: string | null): EditorNode {
  return {
    key,
    parentKey,
    name: '',
    description: '',
    defaultPriority: 'Medium',
    startOffsetDays: '',
    dueOffsetDays: '',
    assigneeRole: '',
    dutyId: '',
    tags: '',
    attachmentCount: 0,
  };
}

/** Load an existing template into the editor model. */
function toEditor(t: TemplateDto): EditorState {
  const keyOf = (id: number) => `k${id}`;
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    nodes: t.nodes.map((n) => ({
      key: keyOf(n.id),
      id: n.id,
      parentKey: n.parentNodeId != null ? keyOf(n.parentNodeId) : null,
      name: n.name,
      description: n.description ?? '',
      defaultPriority: n.defaultPriority,
      startOffsetDays: n.startOffsetDays != null ? String(n.startOffsetDays) : '',
      dueOffsetDays: n.dueOffsetDays != null ? String(n.dueOffsetDays) : '',
      assigneeRole: n.assigneeRole ?? '',
      dutyId: n.dutyId ?? '',
      tags: n.tags.join(', '),
      attachmentCount: n.attachmentCount,
    })),
    dependencies: t.dependencies.map((d) => ({
      blockerKey: keyOf(d.blockerNodeId),
      blockedKey: keyOf(d.blockedNodeId),
    })),
    recurrence: {
      recurrenceType: t.recurrenceType,
      intervalCount: String(t.intervalCount ?? 1),
      intervalUnit: t.intervalUnit ?? 'Week',
      weekdays: t.weekdays,
      anchorDate: t.anchorDate?.slice(0, 10) ?? '',
      endType: t.endType,
      endDate: t.endDate?.slice(0, 10) ?? '',
      maxOccurrences: String(t.maxOccurrences ?? 3),
      labelPrefix: t.labelPrefix ?? '',
      isActive: t.isActive,
    },
  };
}

function parseOffset(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

/** Build the API payload from the editor model. */
function toRequest(e: EditorState): CreateTemplateRequest {
  const nodes: TemplateNodeInput[] = e.nodes.map((n, i) => ({
    id: n.id,
    key: n.key,
    parentKey: n.parentKey,
    name: n.name.trim(),
    description: n.description.trim() || null,
    defaultPriority: n.defaultPriority,
    startOffsetDays: parseOffset(n.startOffsetDays),
    dueOffsetDays: parseOffset(n.dueOffsetDays),
    assigneeRole: n.assigneeRole.trim() || null,
    dutyId: n.dutyId || null,
    tags: n.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    orderIndex: i,
  }));
  const r = e.recurrence;
  return {
    name: e.name.trim(),
    description: e.description.trim() || null,
    nodes,
    dependencies: e.dependencies,
    recurrence: {
      recurrenceType: r.recurrenceType,
      intervalCount: Number(r.intervalCount) || 1,
      intervalUnit: r.intervalUnit,
      weekdays: r.intervalUnit === 'Week' ? r.weekdays : [],
      anchorDate: r.recurrenceType !== 'None' ? r.anchorDate || null : null,
      endType: r.endType,
      endDate: r.endType === 'OnDate' ? r.endDate || null : null,
      maxOccurrences: r.endType === 'AfterOccurrences' ? Number(r.maxOccurrences) || null : null,
      labelPrefix: r.labelPrefix.trim() || null,
      isActive: r.isActive,
    },
  };
}

// --- Small shared bits -------------------------------------------------------

const REC_TONE: Record<RecurrenceType, Tone> = {
  None: 'grey',
  Fixed: 'blue',
  RelativeToCompletion: 'review',
};

/** Short words for the list, where the long labels would crowd the name. */
const REC_SHORT: Record<RecurrenceType, string> = {
  None: 'One-off',
  Fixed: 'On a schedule',
  RelativeToCompletion: 'After completion',
};

/**
 * The list in sections (meeting decision, Nov 11), by how a template is used.
 * Sections by the main task's department need the department in the list's
 * data (backend job 12); until then, by repeat.
 */
const SECTIONS: {
  key: string;
  title: string;
  hint: string;
  test: (t: TemplateSummaryDto) => boolean;
}[] = [
  {
    key: 'repeat',
    title: 'Repeating',
    hint: 'Make their tasks on their own',
    test: (t) => t.recurrenceType !== 'None' && t.isActive,
  },
  {
    key: 'oneoff',
    title: 'Used when needed',
    hint: 'You make their tasks with “Create tasks”',
    test: (t) => t.recurrenceType === 'None',
  },
  {
    key: 'paused',
    title: 'Paused',
    hint: 'Repeating, switched off for now',
    test: (t) => t.recurrenceType !== 'None' && !t.isActive,
  },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Day 2 → 5", "Due day 5", "Starts day 2", or null when no dates are set. */
function offsetsLabel(start: number | null, due: number | null): string | null {
  if (start != null && due != null) return `Day ${start} → ${due}`;
  if (due != null) return `Due day ${due}`;
  if (start != null) return `Starts day ${start}`;
  return null;
}

// --- Page ------------------------------------------------------------------

export function TemplatesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [list, setList] = useState<TemplateSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [instantiating, setInstantiating] = useState<TemplateDto | null>(null);
  // Below 1360px the side column sits under the list: bring the panel into view.
  useEffect(() => {
    if (instantiating) {
      document.querySelector('.hb-tpl-instpanel')?.scrollIntoView({ block: 'nearest' });
    }
  }, [instantiating]);
  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [q, setQ] = useState('');

  const load = () => {
    setLoading(true);
    api
      .listTemplates()
      .then(setList)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load templates'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const keyCounter = useRef(0);
  const nextKey = () => `n${(keyCounter.current += 1)}`;

  function newTemplate() {
    keyCounter.current = 0;
    const rootKey = nextKey();
    setEditor({
      name: '',
      description: '',
      nodes: [blankNode(rootKey, null)],
      dependencies: [],
      recurrence: emptyRecurrence(),
    });
  }

  async function editTemplate(id: number) {
    setError(null);
    try {
      const t = await api.getTemplate(id);
      keyCounter.current = 0;
      setEditor(toEditor(t));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the template');
    }
  }

  async function removeTemplate(t: TemplateSummaryDto) {
    if (!window.confirm(`Delete template “${t.name}”? Already-created tasks are kept.`)) return;
    try {
      await api.deleteTemplate(t.id);
      toast({ message: `Deleted “${t.name}”. Tasks it made are kept.`, tone: 'success' });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the template');
    }
  }

  async function openInstantiate(id: number) {
    setError(null);
    try {
      setInstantiating(await api.getTemplate(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the template');
    }
  }

  const made = list.reduce((sum, t) => sum + t.occurrenceCount, 0);
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return list.filter(
      (t) =>
        !text ||
        t.name.toLowerCase().includes(text) ||
        (t.description ?? '').toLowerCase().includes(text),
    );
  }, [list, q]);
  const repeating = list.filter((t) => t.recurrenceType !== 'None');

  if (editor) {
    return (
      <TemplateEditor
        editor={editor}
        setEditor={setEditor}
        nextKey={nextKey}
        onCancel={() => setEditor(null)}
        onSaved={(msg) => {
          setEditor(null);
          toast({ message: msg, tone: 'success' });
          load();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle={
          <>
            <Link to="/tasks">Tasks</Link> ›{' '}
            {loading
              ? 'Reusable sets of tasks'
              : `${plural(list.length, 'template')} · reusable sets of tasks with their own dates, people and repeats`}
          </>
        }
        newTask={false}
        searchPlaceholder="Search templates"
        searchLabel="Search templates"
        searchValue={q}
        onSearchChange={setQ}
        actions={
          <Btn kind="primary" onClick={newTemplate}>
            <Plus size={16} aria-hidden="true" /> New template
          </Btn>
        }
      />
      <PageBody>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className={cx('hb-cols', instantiating && 'hb-users-cols')}>
          <div className="hb-col">
            <Card className="hb-tpl-list">
              <CardHead
                icon={<FileStack size={16} aria-hidden="true" />}
                title="Templates"
                right={
                  <span className="hb-small">
                    {loading
                      ? 'Loading…'
                      : q.trim()
                        ? `${shown.length} of ${list.length}`
                        : plural(list.length, 'template')}
                  </span>
                }
              />
              {loading ? (
                <Empty>Loading templates…</Empty>
              ) : list.length === 0 ? (
                <div className="hb-tpl-empty">
                  <strong>No templates yet</strong>
                  <span>
                    A template is a task tree you reuse: dates count from a Day 0, people are roles
                    you fill when you use it, and it can repeat on a schedule.
                  </span>
                  <Btn kind="primary" onClick={newTemplate}>
                    <Plus size={16} aria-hidden="true" /> New template
                  </Btn>
                </div>
              ) : shown.length === 0 ? (
                <Empty>No templates match{q.trim() ? ` “${q.trim()}”` : ''}.</Empty>
              ) : (
                SECTIONS.map((sec) => {
                  const items = shown.filter(sec.test);
                  if (items.length === 0) return null;
                  return (
                    <section key={sec.key} className="hb-tpl-section" aria-label={sec.title}>
                      <h4 className="hb-tpl-section-head">
                        {sec.title}
                        <span className="hb-tpl-section-count">{items.length}</span>
                        <span className="hb-tpl-section-hint">{sec.hint}</span>
                      </h4>
                      <div role="list">
                        {items.map((t) => (
                          <div key={t.id} role="listitem" className="hb-row hb-tpl-row">
                            <span
                              className={cx('hb-ic', `tone-${REC_TONE[t.recurrenceType]}`)}
                              aria-hidden="true"
                            >
                              {t.recurrenceType === 'None' ? (
                                <ListTree size={16} />
                              ) : (
                                <Repeat size={16} />
                              )}
                            </span>
                            <div className="hb-stack">
                              <button
                                type="button"
                                className="hb-linklike hb-name"
                                onClick={() => void editTemplate(t.id)}
                              >
                                {t.name}
                              </button>
                              <span
                                className="hb-sub hb-tpl-desc"
                                title={t.description ?? undefined}
                              >
                                {plural(t.nodeCount, 'task')} ·{' '}
                                {t.occurrenceCount
                                  ? `used ${plural(t.occurrenceCount, 'time')}`
                                  : 'not used yet'}
                                {' · '}
                                {t.description || `by ${userLabel(t.createdBy)}`}
                              </span>
                            </div>
                            <div className="hb-tpl-facts">
                              <span title={REPEAT_LABEL[t.recurrenceType]}>
                                <Pill tone={REC_TONE[t.recurrenceType]}>
                                  {REC_SHORT[t.recurrenceType]}
                                </Pill>
                              </span>
                              {t.recurrenceType !== 'None' && !t.isActive && (
                                <Pill tone="amber">Paused</Pill>
                              )}
                            </div>
                            <div className="hb-tpl-actions">
                              <Btn
                                kind="primary"
                                className="hb-btn-sm"
                                onClick={() => void openInstantiate(t.id)}
                              >
                                Create tasks
                              </Btn>
                              <button
                                type="button"
                                className="hb-icon-btn hb-icon-btn-sm"
                                aria-label={`Edit ${t.name}`}
                                title="Edit"
                                onClick={() => void editTemplate(t.id)}
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="hb-icon-btn hb-icon-btn-sm hb-tpl-del"
                                aria-label={`Delete ${t.name}`}
                                title="Delete"
                                onClick={() => void removeTemplate(t)}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </Card>
          </div>

          <aside className={cx('hb-col', instantiating && 'hb-gside')}>
            {instantiating ? (
              <InstantiatePanel
                template={instantiating}
                users={users}
                onClose={() => setInstantiating(null)}
                onDone={(rootTaskId) => {
                  setInstantiating(null);
                  toast({ message: 'Tasks created from the template.', tone: 'success' });
                  load();
                  navigate(`/tasks/${rootTaskId}`);
                }}
              />
            ) : (
              <>
                <Card>
                  <CardHead
                    icon={<Repeat size={16} aria-hidden="true" />}
                    title="Repeating schedules"
                    right={
                      made > 0 ? (
                        <span className="hb-small">Used {plural(made, 'time')} in all</span>
                      ) : undefined
                    }
                  />
                  {repeating.length === 0 ? (
                    <Empty>
                      No template repeats yet. Turn on Repeat in a template to schedule it.
                    </Empty>
                  ) : (
                    repeating.map((t) => (
                      <div key={t.id} className="hb-row">
                        <div className="hb-stack">
                          <button
                            type="button"
                            className="hb-linklike hb-name"
                            onClick={() => void editTemplate(t.id)}
                          >
                            {t.name}
                          </button>
                          <span className="hb-sub">
                            {REPEAT_LABEL[t.recurrenceType]} ·{' '}
                            {t.occurrenceCount
                              ? `made ${plural(t.occurrenceCount, 'time')}`
                              : 'not made yet'}
                          </span>
                        </div>
                        <Pill tone={t.isActive ? 'green' : 'amber'}>
                          {t.isActive ? 'Active' : 'Paused'}
                        </Pill>
                      </div>
                    ))
                  )}
                </Card>
                <Card>
                  <CardHead
                    icon={<ListTree size={16} aria-hidden="true" />}
                    tone="grey"
                    title="How templates work"
                  />
                  <ol className="hb-tpl-how">
                    <li>
                      <strong>Build the tasks.</strong> Each task can have sub-tasks, a duty, a
                      priority, tags and tasks it waits on.
                    </li>
                    <li>
                      <strong>Dates count from Day 0.</strong> “Due day 5” means five days after the
                      start date you pick when you use it.
                    </li>
                    <li>
                      <strong>People are roles.</strong> Name a role (Inspector, Buyer); you pick
                      who fills it each time.
                    </li>
                    <li>
                      <strong>Repeat it, or use it by hand.</strong> A repeating template makes its
                      tasks on schedule; Create tasks makes them now.
                    </li>
                  </ol>
                </Card>
              </>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}

// --- Editor ----------------------------------------------------------------

function TemplateEditor({
  editor,
  setEditor,
  nextKey,
  onCancel,
  onSaved,
}: {
  editor: EditorState;
  setEditor: (e: EditorState) => void;
  nextKey: () => string;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Department Duties: each template task may carry a duty.
  const catalog = useDutyCatalog();
  // Edit-scope ("this and following"): after saving an existing template with
  // materialized future instances, offer to re-sync them (never automatic).
  const [pendingFuture, setPendingFuture] = useState<FutureOccurrenceDto[] | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  // Unsaved-work guard: the whole template (nodes, descriptions, dependencies,
  // recurrence) lives only here until saved, so leaving the page asks first.
  // Once saved (incl. while the "update future instances?" prompt is up) it's clean.
  const [original] = useState(() => JSON.stringify(editor));
  const dirty = savedId === null && JSON.stringify(editor) !== original;
  useUnsavedChangesWarning(dirty && !saving);
  // Collapsed node keys (display-only; never affects drag/order). Drag state for
  // sibling reordering within the tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string; pos: TemplateDropPosition } | null>(null);
  // A node is only draggable while its handle is held (so the row's inputs stay
  // fully usable). Collapsing never changes this — a collapsed node still drags.
  const [armed, setArmed] = useState<string | null>(null);
  // Which tasks are open for editing. A new template opens its first task.
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(editor.id ? [] : editor.nodes.slice(0, 1).map((n) => n.key)),
  );

  const r = editor.recurrence;
  const recurrenceSummary =
    r.recurrenceType === 'None'
      ? 'Does not repeat'
      : `Every ${r.intervalCount} ${RECURRENCE_UNIT_LABELS[r.intervalUnit]}`;
  const patch = (p: Partial<EditorState>) => setEditor({ ...editor, ...p });
  const patchRec = (p: Partial<EditorRecurrence>) =>
    setEditor({ ...editor, recurrence: { ...r, ...p } });
  const patchNode = (key: string, p: Partial<EditorNode>) =>
    setEditor({ ...editor, nodes: editor.nodes.map((n) => (n.key === key ? { ...n, ...p } : n)) });

  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  // Expand `key` and every node above it, so a node just added or re-parented
  // under it is visible rather than silently hidden in a collapsed branch.
  function revealUnder(key: string | null) {
    const chain = new Set<string>();
    let k = key;
    while (k && !chain.has(k)) {
      const cur = k;
      chain.add(cur);
      k = editor.nodes.find((n) => n.key === cur)?.parentKey ?? null;
    }
    setCollapsed((prev) => {
      if (![...chain].some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of chain) next.delete(k);
      return next;
    });
  }

  function addNode(parentKey?: string) {
    const key = nextKey();
    const root = editor.nodes.find((n) => n.parentKey === null) ?? editor.nodes[0];
    const parent = parentKey ?? root?.key ?? null;
    patch({ nodes: [...editor.nodes, blankNode(key, parent)] });
    revealUnder(parent);
    setOpen(key, true);
  }
  function removeNode(key: string) {
    const node = editor.nodes.find((n) => n.key === key);
    if (!node) return;
    // A node with anything typed into it asks first; a blank one just goes.
    const hasContent = node.name.trim() !== '' || node.description !== '';
    if (
      hasContent &&
      !window.confirm(
        `Remove “${node.name.trim() || 'this node'}” and its description and settings?`,
      )
    ) {
      return;
    }
    // Reparent this node's children to its parent; drop deps that touch it.
    const nodes = editor.nodes
      .filter((n) => n.key !== key)
      .map((n) => (n.parentKey === key ? { ...n, parentKey: node.parentKey } : n));
    const dependencies = editor.dependencies.filter(
      (d) => d.blockerKey !== key && d.blockedKey !== key,
    );
    patch({ nodes, dependencies });
  }

  // Stable "Task N" identifiers (like task #ids) so nodes are referenceable in
  // the dependency pickers even before they're named.
  const nodeDisplay = (key: string) => {
    const idx = editor.nodes.findIndex((n) => n.key === key);
    const n = editor.nodes[idx];
    return `Task ${idx + 1}${n?.name ? ` · ${n.name}` : ''}`;
  };

  // --- Tree structure (derived from parentKey, so a Parent change auto-nests) ---
  const rootNode = editor.nodes.find((n) => n.parentKey === null) ?? editor.nodes[0];
  const childrenOf = (key: string) => editor.nodes.filter((n) => n.parentKey === key);
  const hasChildren = (key: string) => editor.nodes.some((n) => n.parentKey === key);

  // Parent options for a node exclude itself and its own descendants (a cycle).
  const parentOptions = (key: string) => {
    const sub = templateSubtreeKeys(editor.nodes, key);
    return editor.nodes.filter((o) => !sub.has(o.key));
  };

  // --- Collapse / expand ---
  const isCollapsed = (key: string) => collapsed.has(key);
  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const collapseAll = () =>
    setCollapsed(new Set(editor.nodes.filter((n) => hasChildren(n.key)).map((n) => n.key)));
  const expandAll = () => setCollapsed(new Set());

  // --- Sibling drag-and-drop reordering ---
  // A drop is accepted only when the target is a sibling of the dragged node
  // (same parent) — reparenting is done via the Parent dropdown. The dragged
  // node's whole subtree moves with it (moveTemplateNode keeps it intact), so a
  // collapsed node reorders exactly like an expanded one.
  const onNodeDragStart = (e: DragEvent, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const onNodeDragOver = (e: DragEvent, key: string) => {
    if (!dragKey || dragKey === key) return;
    const drag = editor.nodes.find((n) => n.key === dragKey);
    const target = editor.nodes.find((n) => n.key === key);
    if (!drag || !target || drag.parentKey !== target.parentKey) return; // siblings only
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: TemplateDropPosition = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropHint({ key, pos });
  };
  const onNodeDrop = (e: DragEvent, key: string) => {
    e.preventDefault();
    const hint = dropHint;
    setDropHint(null);
    if (!dragKey || dragKey === key || !hint || hint.key !== key) {
      setDragKey(null);
      return;
    }
    patch({ nodes: moveTemplateNode(editor.nodes, dragKey, key, hint.pos) });
    setDragKey(null);
  };
  const onNodeDragEnd = () => {
    setDragKey(null);
    setDropHint(null);
    setArmed(null);
  };

  // --- Choices for the pickers ---
  const priorityOptions: SelectOption<TaskPriority>[] = TASK_PRIORITIES.map((p) => ({
    value: p,
    label: p,
    dot: PRIORITY_DOT[p],
  }));
  const dutyOptions = (selected: string): SelectOption<string>[] => [
    { value: '', label: 'No duty' },
    ...dutyOptionGroups(catalog.departments, {
      holdings: catalog.holdings,
      selectedId: selected || null,
    }).flatMap((g) => g.options.map((o) => ({ value: o.value, label: o.label }))),
  ];

  // --- What the template makes (side panel) ---
  const roles = [...new Set(editor.nodes.map((n) => n.assigneeRole.trim()).filter(Boolean))];
  const dutyCount = new Set(editor.nodes.map((n) => n.dutyId).filter(Boolean)).size;
  const offsets = editor.nodes
    .flatMap((n) => [parseOffset(n.startOffsetDays), parseOffset(n.dueOffsetDays)])
    .filter((v): v is number => v != null);
  const span = offsets.length ? Math.max(...offsets) - Math.min(0, ...offsets) : null;
  const attachments = editor.nodes.reduce((s, n) => s + n.attachmentCount, 0);

  // Recursive tree render: a row per task, indented by depth, followed by its
  // children (hidden when the node is collapsed). Rendering from the derived
  // tree means a Parent change immediately nests the node under its new parent.
  const renderNode = (n: EditorNode, depth: number) => {
    const idx = editor.nodes.findIndex((x) => x.key === n.key);
    const isRoot = n.parentKey === null;
    const kids = childrenOf(n.key);
    const nodeCollapsed = isCollapsed(n.key);
    const hiddenCount = nodeCollapsed ? templateSubtreeKeys(editor.nodes, n.key).size - 1 : 0;
    const hint = dropHint?.key === n.key ? dropHint.pos : null;
    const open = openKeys.has(n.key);
    const dates = offsetsLabel(parseOffset(n.startOffsetDays), parseOffset(n.dueOffsetDays));
    const blockedBy = editor.dependencies
      .filter((d) => d.blockedKey === n.key)
      .map((d) => d.blockerKey);
    const blocks = editor.dependencies
      .filter((d) => d.blockerKey === n.key)
      .map((d) => d.blockedKey);
    const duty = n.dutyId ? (catalog.duties.get(n.dutyId) ?? null) : null;
    const tags = n.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return (
      <div
        key={n.key}
        className="hb-tpl-branch"
        style={{ ['--depth' as string]: depth } as CSSProperties}
      >
        <div
          className={cx(
            'hb-tpl-node',
            isRoot ? 'is-root' : 'is-sub',
            open && 'is-open',
            dragKey === n.key && 'is-dragging',
            hint && `drop-${hint}`,
          )}
          draggable={armed === n.key}
          onDragStart={(e) => onNodeDragStart(e, n.key)}
          onDragOver={(e) => onNodeDragOver(e, n.key)}
          onDrop={(e) => onNodeDrop(e, n.key)}
          onDragEnd={onNodeDragEnd}
        >
          <div className="hb-tpl-node-row">
            {isRoot ? (
              <span className="hb-tpl-grip is-blank" aria-hidden="true" />
            ) : (
              <span
                className="hb-tpl-grip"
                role="button"
                aria-label="Drag to reorder"
                title="Drag to reorder"
                onMouseDown={() => setArmed(n.key)}
                onMouseUp={() => setArmed(null)}
              >
                <GripVertical size={16} aria-hidden="true" />
              </span>
            )}
            {kids.length > 0 ? (
              <button
                type="button"
                className="hb-tpl-caret"
                aria-expanded={!nodeCollapsed}
                aria-label={nodeCollapsed ? 'Show sub-tasks' : 'Hide sub-tasks'}
                title={nodeCollapsed ? 'Expand' : 'Collapse'}
                onClick={() => toggleCollapse(n.key)}
              >
                {nodeCollapsed ? (
                  <ChevronRight size={16} aria-hidden="true" />
                ) : (
                  <ChevronDown size={16} aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="hb-tpl-caret is-blank" aria-hidden="true" />
            )}
            {/* Main task and sub-tasks look different (Nov 11): the main task has a
                tinted header card, each sub-task a ↳ marker and its number. */}
            {isRoot ? (
              <span className="hb-tpl-num is-root" title="The main task">
                <ListTree size={14} aria-hidden="true" />
              </span>
            ) : (
              <span className="hb-tpl-num" title={`Task ${idx + 1}, a sub-task`}>
                <CornerDownRight size={12} aria-hidden="true" />
                {idx + 1}
              </span>
            )}
            <input
              className="hb-tpl-name"
              value={n.name}
              placeholder={isRoot ? 'Main task name' : 'Task name'}
              aria-label={isRoot ? 'Name of the main task' : `Name of task ${idx + 1}`}
              onChange={(e) => patchNode(n.key, { name: e.target.value })}
            />
            <span className="hb-tpl-chips">
              {isRoot && <span className="hb-tpl-chip is-root">Main task</span>}
              {n.defaultPriority !== 'Medium' && <PriorityMark priority={n.defaultPriority} />}
              {n.assigneeRole.trim() && (
                <span className="hb-tpl-chip">
                  <UserRound size={13} aria-hidden="true" /> {n.assigneeRole.trim()}
                </span>
              )}
              {duty && <DutyTag duty={duty} compact />}
              {dates && (
                <span className="hb-tpl-chip">
                  <CalendarDays size={13} aria-hidden="true" /> {dates}
                </span>
              )}
              {blockedBy.length + blocks.length > 0 && (
                <span
                  className="hb-tpl-chip"
                  title={`Waits on ${blockedBy.length}, holds up ${blocks.length}`}
                >
                  <Link2 size={13} aria-hidden="true" /> {blockedBy.length + blocks.length}
                </span>
              )}
              {n.attachmentCount > 0 && (
                <span className="hb-tpl-chip" title="Default attachments">
                  <Paperclip size={13} aria-hidden="true" /> {n.attachmentCount}
                </span>
              )}
              {hiddenCount > 0 && (
                <span className="hb-tpl-chip is-muted">{hiddenCount} hidden</span>
              )}
            </span>
            <button
              type="button"
              className={cx('hb-tpl-edit', open && 'is-on')}
              aria-expanded={open}
              aria-label={`${open ? 'Close' : 'Edit'} details for task ${idx + 1}`}
              onClick={() => setOpen(n.key, !open)}
            >
              {open ? 'Done' : 'Details'}
            </button>
            {!isRoot && (
              <button
                type="button"
                className="hb-icon-btn hb-icon-btn-sm hb-tpl-del"
                aria-label={`Remove task ${idx + 1}`}
                title="Remove"
                onClick={() => removeNode(n.key)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          {open && (
            <div className="hb-tpl-node-body">
              <div className="hb-tpl-grid">
                <div className="hb-tpl-field is-wide">
                  <span className="hb-tpl-flabel">Description</span>
                  <RichTextEditor
                    value={n.description}
                    onChange={(html) => patchNode(n.key, { description: html })}
                    ariaLabel={`Description for task ${idx + 1}`}
                  />
                </div>
                <div className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Sub-task of</span>
                  {isRoot ? (
                    <span className="hb-tpl-static">The main task (not under another)</span>
                  ) : (
                    <Select
                      label={`Task ${idx + 1} is a sub-task of`}
                      value={n.parentKey ?? ''}
                      options={parentOptions(n.key).map((o) => ({
                        value: o.key,
                        label: nodeDisplay(o.key),
                      }))}
                      onChange={(v) => {
                        patchNode(n.key, { parentKey: v });
                        revealUnder(v);
                      }}
                    />
                  )}
                </div>
                <div className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Priority</span>
                  <Select
                    label={`Priority for task ${idx + 1}`}
                    value={n.defaultPriority}
                    options={priorityOptions}
                    onChange={(v) => patchNode(n.key, { defaultPriority: v })}
                  />
                </div>
                <label className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Role (who does it)</span>
                  <input
                    className="hb-tpl-input"
                    value={n.assigneeRole}
                    placeholder="e.g. Inspector"
                    onChange={(e) => patchNode(n.key, { assigneeRole: e.target.value })}
                  />
                </label>
                <div className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Department › Duty</span>
                  <Select
                    label={`Department › Duty for task ${idx + 1}`}
                    value={n.dutyId}
                    options={dutyOptions(n.dutyId)}
                    searchPlaceholder="Search duties"
                    onChange={(v) => patchNode(n.key, { dutyId: v })}
                  />
                </div>
                <label className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Starts on day</span>
                  <span className="hb-tpl-day">
                    <span aria-hidden="true">Day</span>
                    <input
                      className="hb-tpl-input"
                      type="number"
                      value={n.startOffsetDays}
                      placeholder="—"
                      onChange={(e) => patchNode(n.key, { startOffsetDays: e.target.value })}
                    />
                  </span>
                </label>
                <label className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Due on day</span>
                  <span className="hb-tpl-day">
                    <span aria-hidden="true">Day</span>
                    <input
                      className="hb-tpl-input"
                      type="number"
                      value={n.dueOffsetDays}
                      placeholder="—"
                      onChange={(e) => patchNode(n.key, { dueOffsetDays: e.target.value })}
                    />
                  </span>
                </label>
                <label className="hb-tpl-field is-wide">
                  <span className="hb-tpl-flabel">Tags</span>
                  <input
                    className="hb-tpl-input"
                    value={n.tags}
                    placeholder="Comma-separated, e.g. inspection, monthly"
                    onChange={(e) => patchNode(n.key, { tags: e.target.value })}
                  />
                  {tags.length > 0 && (
                    <span className="hb-tpl-tags">
                      {tags.map((t) => (
                        <span key={t} className="hb-tpl-chip is-tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </label>
                {n.attachmentCount > 0 && (
                  <div className="hb-tpl-field is-wide hb-tpl-attach">
                    <Paperclip size={14} aria-hidden="true" />
                    {plural(n.attachmentCount, 'default attachment')} copied onto each new task.
                  </div>
                )}
              </div>

              {/* Dependencies live on the node, mirroring a real task's relationships.
                  Each edge shows as "Blocks" on one node and "Blocked by" on the other. */}
              {editor.nodes.length > 1 && (
                <div className="hb-tpl-rels">
                  <TplRel
                    label="Blocked by"
                    linked={blockedBy}
                    options={editor.nodes.filter((o) => o.key !== n.key)}
                    display={nodeDisplay}
                    onAdd={(other) =>
                      patch({
                        dependencies: [
                          ...editor.dependencies,
                          { blockerKey: other, blockedKey: n.key },
                        ],
                      })
                    }
                    onRemove={(other) =>
                      patch({
                        dependencies: editor.dependencies.filter(
                          (d) => !(d.blockerKey === other && d.blockedKey === n.key),
                        ),
                      })
                    }
                  />
                  <TplRel
                    label="Blocks"
                    linked={blocks}
                    options={editor.nodes.filter((o) => o.key !== n.key)}
                    display={nodeDisplay}
                    onAdd={(other) =>
                      patch({
                        dependencies: [
                          ...editor.dependencies,
                          { blockerKey: n.key, blockedKey: other },
                        ],
                      })
                    }
                    onRemove={(other) =>
                      patch({
                        dependencies: editor.dependencies.filter(
                          (d) => !(d.blockerKey === n.key && d.blockedKey === other),
                        ),
                      })
                    }
                  />
                </div>
              )}
              <div className="hb-tpl-node-foot">
                <Btn kind="ghost" className="hb-btn-sm" onClick={() => addNode(n.key)}>
                  <Plus size={15} aria-hidden="true" /> Add a sub-task here
                </Btn>
              </div>
            </div>
          )}
        </div>
        {!nodeCollapsed && kids.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  async function doSave() {
    setError(null);
    if (!editor.name.trim()) return setError('A template name is required');
    const unnamed = editor.nodes.find((n) => !n.name.trim());
    if (unnamed) {
      revealUnder(unnamed.parentKey);
      return setError('Every node needs a name');
    }
    if (r.recurrenceType !== 'None' && !r.anchorDate)
      return setError('A recurring template needs a start (anchor) date');

    setSaving(true);
    try {
      const body = toRequest(editor);
      const saved = editor.id
        ? await api.updateTemplate(editor.id, body)
        : await api.createTemplate(body);
      // "This and following": if editing an existing series, check for
      // already-materialized future instances and prompt before touching them.
      if (editor.id) {
        const future = await api.getTemplateFuture(saved.id);
        if (future.length > 0) {
          setSavedId(saved.id);
          setPendingFuture(future);
          setSaving(false);
          return;
        }
      }
      onSaved(editor.id ? 'Template updated.' : 'Template created.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the template');
      setSaving(false);
    }
  }

  async function applyFuture(apply: boolean) {
    if (apply && savedId && pendingFuture) {
      try {
        await api.applyTemplateToFuture(
          savedId,
          pendingFuture.map((f) => f.occurrenceId),
        );
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : 'Could not update the task sets already created',
        );
        setPendingFuture(null);
        return;
      }
    }
    onSaved('Template updated.');
  }

  // Ctrl/⌘ + S saves, as on the task page.
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  const canSaveRef = useRef(false);
  canSaveRef.current = dirty && !saving;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSaveRef.current) void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recTypeOptions: SelectOption<RecurrenceType>[] = (
    ['None', 'Fixed', 'RelativeToCompletion'] as RecurrenceType[]
  ).map((t) => ({ value: t, label: REPEAT_LABEL[t] }));
  const unitOptions: SelectOption<RecurrenceUnit>[] = RECURRENCE_UNITS.map((u) => ({
    value: u,
    label: RECURRENCE_UNIT_LABELS[u],
  }));
  const endOptions: SelectOption<RecurrenceEndType>[] = [
    { value: 'Never', label: 'Never' },
    { value: 'OnDate', label: 'On a date' },
    {
      value: 'AfterOccurrences',
      label:
        r.recurrenceType === 'RelativeToCompletion'
          ? 'After it’s done a number of times'
          : 'After a number of times',
    },
  ];
  const showBar = dirty || !!error;

  return (
    <>
      <PageHeader
        title={editor.name.trim() || (editor.id ? 'Untitled template' : 'New template')}
        subtitle={
          <>
            <Link to="/tasks">Tasks</Link> ›{' '}
            <button
              type="button"
              className="hb-tpl-crumb"
              onClick={() => {
                if (confirmDiscard(dirty)) onCancel();
              }}
            >
              Templates
            </button>{' '}
            › {editor.id ? 'Edit template' : 'New template'}
          </>
        }
        search={false}
        newTask={false}
        actions={
          <Btn
            onClick={() => {
              if (confirmDiscard(dirty)) onCancel();
            }}
            disabled={saving}
          >
            <ArrowLeft size={16} aria-hidden="true" /> All templates
          </Btn>
        }
      />
      <PageBody className={cx(showBar && 'hb-has-savebar')}>
        <div className="hb-cols">
          <div className="hb-col">
            <Card>
              <div className="hb-card-pad hb-tpl-details">
                <label className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Template name</span>
                  <input
                    className="hb-tpl-input hb-tpl-title"
                    value={editor.name}
                    placeholder="e.g. Monthly warehouse inspection"
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <label className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Notes (optional)</span>
                  <textarea
                    className="hb-tpl-input"
                    value={editor.description}
                    rows={2}
                    placeholder="What this template is for, shown in the list"
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
              </div>
            </Card>

            <Card className="hb-tpl-tree-card">
              <CardHead
                icon={<ListTree size={16} aria-hidden="true" />}
                title="Tasks and sub-tasks"
                right={
                  <span className="hb-tpl-tree-tools">
                    <Btn
                      kind="ghost"
                      className="hb-btn-sm"
                      onClick={collapseAll}
                      disabled={!editor.nodes.some((n) => hasChildren(n.key))}
                    >
                      Collapse all
                    </Btn>
                    <Btn
                      kind="ghost"
                      className="hb-btn-sm"
                      onClick={expandAll}
                      disabled={collapsed.size === 0}
                    >
                      Expand all
                    </Btn>
                    <Btn className="hb-btn-sm" onClick={() => addNode()}>
                      <Plus size={15} aria-hidden="true" /> Add task
                    </Btn>
                  </span>
                }
              />
              <p className="hb-tpl-tree-hint">
                The first task is the main one; the rest are its sub-tasks. Drag a row by its handle
                to reorder it among its siblings; “Sub-task of” moves it elsewhere.
              </p>
              <div className="hb-tpl-tree">{rootNode ? renderNode(rootNode, 0) : null}</div>
            </Card>
          </div>

          <aside className="hb-col">
            <Card>
              <CardHead
                icon={<Repeat size={16} aria-hidden="true" />}
                title="Repeat"
                right={<span className="hb-small">{recurrenceSummary}</span>}
              />
              <div className="hb-card-pad hb-tpl-rec">
                <div className="hb-tpl-field">
                  <span className="hb-tpl-flabel">Repeat</span>
                  <Select
                    label="Repeat"
                    value={r.recurrenceType}
                    options={recTypeOptions}
                    onChange={(v) => patchRec({ recurrenceType: v })}
                  />
                </div>
                {r.recurrenceType === 'None' ? (
                  <p className="hb-tpl-note">
                    Used by hand only: Create tasks on the Templates list makes a new set.
                  </p>
                ) : (
                  <>
                    <div className="hb-tpl-field">
                      <span className="hb-tpl-flabel">Repeat every</span>
                      <span className="hb-tpl-every">
                        <input
                          className="hb-tpl-input"
                          type="number"
                          min={1}
                          aria-label="Repeat every"
                          value={r.intervalCount}
                          onChange={(e) => patchRec({ intervalCount: e.target.value })}
                        />
                        <Select
                          label="Repeat unit"
                          value={r.intervalUnit}
                          options={unitOptions}
                          onChange={(v) => patchRec({ intervalUnit: v })}
                        />
                      </span>
                    </div>
                    {r.intervalUnit === 'Week' && (
                      <div className="hb-tpl-field">
                        <span className="hb-tpl-flabel">Repeat on</span>
                        <WeekdayPicker
                          value={r.weekdays}
                          onChange={(v) => patchRec({ weekdays: v })}
                        />
                      </div>
                    )}
                    <div className="hb-tpl-field">
                      <span className="hb-tpl-flabel">Start date</span>
                      <DatePicker
                        label="Start date"
                        value={r.anchorDate || null}
                        allowClear={false}
                        placeholder="Pick the first Day 0"
                        onChange={(v) => patchRec({ anchorDate: v ?? '' })}
                      />
                    </div>
                    <div className="hb-tpl-field">
                      <span className="hb-tpl-flabel">Ends</span>
                      <Select
                        label="Ends"
                        value={r.endType}
                        options={endOptions}
                        onChange={(v) => patchRec({ endType: v })}
                      />
                    </div>
                    {r.endType === 'OnDate' && (
                      <div className="hb-tpl-field">
                        <span className="hb-tpl-flabel">End date</span>
                        <DatePicker
                          label="End date"
                          value={r.endDate || null}
                          onChange={(v) => patchRec({ endDate: v ?? '' })}
                        />
                      </div>
                    )}
                    {r.endType === 'AfterOccurrences' && (
                      <label className="hb-tpl-field">
                        <span className="hb-tpl-flabel">
                          {r.recurrenceType === 'RelativeToCompletion'
                            ? 'Completions'
                            : 'Occurrences'}
                        </span>
                        <input
                          className="hb-tpl-input"
                          type="number"
                          min={1}
                          value={r.maxOccurrences}
                          onChange={(e) => patchRec({ maxOccurrences: e.target.value })}
                        />
                      </label>
                    )}
                    <label className="hb-tpl-field">
                      <span className="hb-tpl-flabel">Label prefix (optional)</span>
                      <input
                        className="hb-tpl-input"
                        value={r.labelPrefix}
                        placeholder="e.g. BATCH"
                        onChange={(e) => patchRec({ labelPrefix: e.target.value })}
                      />
                    </label>
                    <div className="hb-tpl-field">
                      <span className="hb-tpl-flabel">Status</span>
                      <Segmented
                        label="Repeat status"
                        value={r.isActive ? 'on' : 'off'}
                        options={[
                          { value: 'on', label: 'Active' },
                          { value: 'off', label: 'Paused' },
                        ]}
                        onChange={(v) => patchRec({ isActive: v === 'on' })}
                      />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card>
              <CardHead
                icon={<FileStack size={16} aria-hidden="true" />}
                tone="grey"
                title="Each use makes"
              />
              <div className="hb-tpl-sum">
                <div className="hb-kv">
                  <span>Tasks</span>
                  <strong>{editor.nodes.length}</strong>
                </div>
                <div className="hb-kv">
                  <span>Spread over</span>
                  <strong>{span == null ? 'No dates set' : plural(span + 1, 'day')}</strong>
                </div>
                <div className="hb-kv">
                  <span>Dependencies</span>
                  <strong>{editor.dependencies.length}</strong>
                </div>
                <div className="hb-kv">
                  <span>Duties needed</span>
                  <strong>{dutyCount}</strong>
                </div>
                {attachments > 0 && (
                  <div className="hb-kv">
                    <span>Attachments</span>
                    <strong>{attachments}</strong>
                  </div>
                )}
                <div className="hb-tpl-sum-roles">
                  <span className="hb-label">Roles you fill each time</span>
                  {roles.length === 0 ? (
                    <span className="hb-small">
                      None yet. Tasks without a role are made unassigned.
                    </span>
                  ) : (
                    <span className="hb-tpl-tags">
                      {roles.map((role) => (
                        <span key={role} className="hb-tpl-chip">
                          <UserRound size={13} aria-hidden="true" /> {role}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </PageBody>

      {/* The one Save bar */}
      {showBar && !pendingFuture && (
        <div className="hb-savebar" role="region" aria-label="Unsaved changes">
          <span className="hb-savebar-dot" aria-hidden="true" />
          <strong>{dirty ? 'Unsaved changes' : 'Not saved'}</strong>
          <span className="hb-savebar-what">
            {editor.id ? 'to this template' : 'New template, not saved yet'}
          </span>
          {error && <span className="hb-savebar-err">{error}</span>}
          <span className="hb-grow" />
          <span className="hb-kbd">Ctrl + S</span>
          <button
            type="button"
            className="hb-savebar-discard"
            disabled={saving}
            onClick={() => {
              // An edit goes back to what was saved; a new template is left.
              if (editor.id) {
                setError(null);
                setEditor(JSON.parse(original) as EditorState);
              } else if (confirmDiscard(dirty)) onCancel();
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="hb-savebar-save"
            onClick={() => void doSave()}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      )}

      {pendingFuture && (
        <ModalShell
          title="Update the tasks already created?"
          width="520px"
          onBackdropClick={() => void applyFuture(false)}
          actions={
            <>
              <Btn onClick={() => void applyFuture(false)}>Leave them</Btn>
              <Btn kind="primary" onClick={() => void applyFuture(true)}>
                Update them
              </Btn>
            </>
          }
        >
          <p className="exc-confirm-sub">
            This template has {pendingFuture.length} task
            {pendingFuture.length === 1 ? ' set' : ' sets'} already created for later dates that
            haven’t started yet. Update
            {pendingFuture.length === 1 ? ' it' : ' them'} to match your edit? Completed and
            in-progress work is never changed.
          </p>
        </ModalShell>
      )}
    </>
  );
}

/** Plain words for how a template repeats (the shared labels stay as they are). */
const REPEAT_LABEL: Record<RecurrenceType, string> = {
  None: 'Doesn’t repeat (create by hand)',
  Fixed: 'On a fixed schedule',
  RelativeToCompletion: 'After the last one is done',
};

// --- Instantiate panel ("Create tasks"), in the page's side column ------------

function InstantiatePanel({
  template,
  users,
  onClose,
  onDone,
}: {
  template: TemplateDto;
  users: ActiveUserDto[];
  onClose: () => void;
  onDone: (rootTaskId: number) => void;
}) {
  // The user's own calendar date, not the UTC one: `toISOString()` would
  // pre-fill tomorrow for anyone whose evening is already the next day in UTC.
  const today = useMemo(() => todayLocalDate(), []);
  const [label, setLabel] = useState('');
  const [anchor, setAnchor] = useState(today);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Department Duties: everyone filling a role must hold the duties that role's
  // template tasks carry. Checked live as people are chosen (✓ / ⚠), and again
  // on Create — any remaining problems open the "missing duties" step, where
  // Proceed stays disabled until each one is fixed.
  const { user: me } = useAuth();
  const catalog = useDutyCatalog();
  const [problems, setProblems] = useState<TemplateDutyProblemDto[] | null>(null);
  const [fixed, setFixed] = useState<TemplateDutyProblemDto[]>([]);
  const [granting, setGranting] = useState<string | null>(null);

  const roleNeeds = (role: string) => [
    ...new Set(
      template.nodes
        .filter((n) => n.assigneeRole === role && n.dutyId)
        .map((n) => n.dutyId as string),
    ),
  ];
  const nodeById = new Map(template.nodes.map((n) => [n.id, n]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const roleAssignments = () =>
    template.roles.map((role) => ({ role, assigneeId: roleMap[role] || null }));
  const canManage = (userId: string): boolean => {
    if (!me) return false;
    if (me.role === 'Admin') return true;
    const seen = new Set<string>();
    let cur: string | null = userId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const sup: string | null = userById.get(cur)?.supervisorId ?? null;
      if (sup === me.id) return true;
      cur = sup;
    }
    return false;
  };
  const supervisorName = (userId: string) => {
    const sup = userById.get(userById.get(userId)?.supervisorId ?? '');
    return sup ? userLabel(sup) : 'an Admin';
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.instantiateTemplate(template.id, {
        instanceLabel: label.trim() || null,
        anchorStart: anchor,
        roleAssignments: roleAssignments(),
      });
      onDone(res.rootTaskId);
    } catch (e) {
      if (isDutyNotHeldError(e)) {
        // Someone's duties changed since the check: show what's missing now.
        setProblems((e.details as { problems: TemplateDutyProblemDto[] }).problems ?? []);
      } else setError(e instanceof ApiError ? e.message : 'Could not create the tasks');
      setBusy(false);
    }
  }

  async function check(): Promise<TemplateDutyProblemDto[]> {
    const res = await api.checkTemplateDuties(template.id, { roleAssignments: roleAssignments() });
    return res.problems;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const found = await check();
      if (found.length > 0) {
        setProblems(found);
        setFixed([]);
        setBusy(false);
        return;
      }
      await create();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check the duties');
      setBusy(false);
    }
  }

  async function grant(p: TemplateDutyProblemDto) {
    setGranting(`${p.userId}:${p.dutyId}`);
    try {
      await api.grantDuty(p.userId, p.dutyId);
      catalog.grantLocally(p.userId, p.dutyId);
      setFixed((f) => [...f, p]);
      setProblems((list) =>
        (list ?? []).filter((x) => !(x.userId === p.userId && x.dutyId === p.dutyId)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not give the duty');
    } finally {
      setGranting(null);
    }
  }

  async function recheck() {
    setBusy(true);
    setError(null);
    try {
      await catalog.reload();
      const found = await check();
      setFixed((f) => [
        ...f,
        ...(problems ?? []).filter(
          (p) => !found.some((x) => x.userId === p.userId && x.dutyId === p.dutyId),
        ),
      ]);
      setProblems(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check the duties');
    } finally {
      setBusy(false);
    }
  }

  const nodeCount = template.nodes.length;

  // --- Step 2: the missing-duties pop-up -------------------------------------
  if (problems) {
    const open = problems.length;
    const rows = [
      ...problems.map((p) => ({ p, ok: false })),
      ...fixed.map((p) => ({ p, ok: true })),
    ];
    return (
      <InstPanel
        onClose={onClose}
        busy={busy}
        title={
          open
            ? `${open} required ${open === 1 ? 'duty isn’t' : 'duties aren’t'} held`
            : 'All required duties are now held'
        }
        hint={
          <Btn
            kind="link"
            disabled={busy}
            onClick={() => void recheck()}
            title="Check again after duties were added somewhere else"
          >
            <RotateCw size={14} aria-hidden="true" /> Re-check
          </Btn>
        }
        actions={
          <>
            <Btn disabled={busy} onClick={() => setProblems(null)}>
              Back
            </Btn>
            <Btn kind="primary" disabled={busy || open > 0} onClick={() => void create()}>
              {busy ? 'Creating…' : `Create ${nodeCount} ${nodeCount === 1 ? 'task' : 'tasks'}`}
            </Btn>
          </>
        }
      >
        <p className="exc-confirm-sub">
          {open
            ? 'Each template task goes to the person filling its role, and that person must hold the task’s duty. Add the missing duties below, or cancel and choose different people.'
            : 'You can now create the tasks.'}
        </p>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <div className="hb-tpl-problems">
          {rows.map(({ p, ok }) => {
            const person = userById.get(p.userId);
            const duty = catalog.duties.get(p.dutyId) ?? null;
            const name = person ? userLabel(person) : 'Someone';
            const first = person?.firstName || name;
            return (
              <div
                key={`${p.role}:${p.userId}:${p.dutyId}`}
                className={cx('hb-tpl-problem', ok && 'is-ok')}
              >
                {person && <Avatar user={person} decorative />}
                <div className="hb-stack">
                  <div>
                    <b>{name}</b> <span className="hb-small">as</span>{' '}
                    <span className="hb-tpl-chip">{p.role}</span>
                  </div>
                  <div className="hb-tpl-problem-duty">
                    {ok ? <Pill tone="green">Now holds</Pill> : <Pill tone="red">Missing</Pill>}{' '}
                    <DutyTag duty={duty} />
                  </div>
                  <span className="hb-sub">
                    Needed for:{' '}
                    {p.nodeIds.map((id) => nodeById.get(id)?.name ?? `#${id}`).join('; ')}
                  </span>
                </div>
                <div className="hb-tpl-problem-act">
                  {ok ? null : canManage(p.userId) ? (
                    <Btn
                      kind="primary"
                      className="hb-btn-sm"
                      disabled={granting !== null}
                      onClick={() => void grant(p)}
                    >
                      {granting === `${p.userId}:${p.dutyId}`
                        ? 'Giving…'
                        : `Give ${first} this duty`}
                    </Btn>
                  ) : (
                    <>
                      <span className="hb-small">
                        Only {supervisorName(p.userId)} or an Admin can give {first} duties.
                      </span>
                      {me?.role !== 'Member' && (
                        <a
                          href={`/admin/organization?view=person&person=${p.userId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hb-tpl-orglink"
                        >
                          Open in Organization ↗
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </InstPanel>
    );
  }

  // --- Step 1: anchor, label and who fills each role ----------------------------
  const sortedUsers = [...users].sort((a, b) => userLabel(a).localeCompare(userLabel(b)));
  // The tasks it will make, in tree order, with their real dates for this Day 0.
  const ordered: { id: number; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    template.nodes
      .filter((n) => n.parentNodeId === parent)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((n) => {
        ordered.push({ id: n.id, depth });
        walk(n.id, depth + 1);
      });
  };
  walk(null, 0);
  const dayOf = (offset: number | null) =>
    offset == null || !anchor ? null : formatDay(addDays(anchor, offset));

  return (
    <InstPanel
      onClose={onClose}
      busy={busy}
      title={`Create tasks from “${template.name}”`}
      hint={`${nodeCount} ${nodeCount === 1 ? 'task' : 'tasks'} will be created`}
      actions={
        <>
          <Btn onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn kind="primary" onClick={() => void submit()} disabled={busy || !anchor}>
            {busy ? 'Checking…' : `Create ${nodeCount} ${nodeCount === 1 ? 'task' : 'tasks'}`}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}
      <div className="hb-tpl-inst">
        <div className="hb-tpl-inst-top">
          <div className="hb-tpl-field">
            <span className="hb-tpl-flabel">Start date (Day 0)</span>
            <DatePicker
              label="Start date (Day 0)"
              value={anchor || null}
              allowClear={false}
              onChange={(v) => setAnchor(v ?? today)}
            />
          </div>
          <label className="hb-tpl-field">
            <span className="hb-tpl-flabel">Batch label (optional)</span>
            <input
              className="hb-tpl-input"
              value={label}
              placeholder="e.g. PO-4521"
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        </div>

        {template.roles.length > 0 && (
          <div className="hb-tpl-inst-sec">
            <span className="hb-label">Who fills each role</span>
            {template.roles.map((role) => {
              const nodes = template.nodes.filter((n) => n.assigneeRole === role);
              const needs = roleNeeds(role);
              const pid = roleMap[role] ?? '';
              const missing = pid ? needs.filter((u) => !holdsDuty(catalog.holdings, pid, u)) : [];
              const options: SelectOption<string>[] = [
                { value: '', label: 'Leave unassigned' },
                ...sortedUsers.map((u) => {
                  const ok = needs.every((d) => holdsDuty(catalog.holdings, u.id, d));
                  return {
                    value: u.id,
                    label: userLabel(u),
                    lead: <Avatar user={u} size="xs" decorative />,
                    hint: ok ? undefined : '⚠ missing a duty',
                  };
                }),
              ];
              return (
                <div key={role} className="hb-tpl-role">
                  <div className="hb-stack">
                    <span className="hb-tpl-chip">
                      <UserRound size={13} aria-hidden="true" /> {role}
                    </span>
                    <span className="hb-sub">
                      {plural(nodes.length, 'task')} · needs{' '}
                      {plural(needs.length, 'duty', 'duties')}
                    </span>
                  </div>
                  <Select
                    label={`Person for ${role}`}
                    value={pid}
                    options={options}
                    searchPlaceholder="Search people"
                    onChange={(v) => setRoleMap((m) => ({ ...m, [role]: v }))}
                  />
                  <div className="hb-tpl-role-state">
                    {!pid ? (
                      <span className="hb-small">Tasks will be unassigned</span>
                    ) : missing.length ? (
                      missing.map((d) => {
                        const duty = catalog.duties.get(d);
                        return (
                          <span key={d} className="hb-tpl-warn">
                            Doesn’t hold {duty ? dutyLabel(duty) : 'a required duty'}
                          </span>
                        );
                      })
                    ) : (
                      <Pill tone="green">✓ Holds every duty needed</Pill>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="hb-tpl-inst-sec">
          <span className="hb-label">What it makes</span>
          <div className="hb-tpl-preview">
            {ordered.map(({ id, depth }) => {
              const n = nodeById.get(id)!;
              const due = dayOf(n.dueOffsetDays);
              const start = dayOf(n.startOffsetDays);
              const filler = n.assigneeRole
                ? userById.get(roleMap[n.assigneeRole] ?? '')
                : undefined;
              const who = filler ? userLabel(filler) : n.assigneeRole;
              return (
                <div key={id} className="hb-tpl-prow" style={{ paddingLeft: 12 + depth * 18 }}>
                  <span className="hb-tpl-pname">
                    {label.trim() && depth === 0 ? `${label.trim()} · ` : ''}
                    {n.name}
                  </span>
                  {who && <span className="hb-small">{who}</span>}
                  <span className="hb-tpl-pdate">
                    {start && due
                      ? `${start} → ${due}`
                      : due
                        ? `Due ${due}`
                        : start
                          ? `Starts ${start}`
                          : 'No dates'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </InstPanel>
  );
}

/** The side panel the two steps of Create tasks sit in. */
function InstPanel({
  title,
  hint,
  actions,
  busy,
  onClose,
  children,
}: {
  title: string;
  hint?: ReactNode;
  actions: ReactNode;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="hb-gpanel hb-tpl-instpanel">
      <section aria-label={title}>
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">Create tasks</span>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="hb-gpanel-body">{children}</div>
        <div className="hb-gpanel-foot">
          {hint && <span className="hb-tpl-insthint">{hint}</span>}
          {actions}
        </div>
      </section>
    </Card>
  );
}

// --- Per-node dependency editor (Blocked by / Blocks) ----------------------

function TplRel({
  label,
  linked,
  options,
  display,
  onAdd,
  onRemove,
}: {
  label: string;
  linked: string[];
  options: EditorNode[];
  display: (key: string) => string;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const available = options.filter((o) => !linked.includes(o.key));
  return (
    <div className="hb-tpl-rel">
      <span className="hb-tpl-flabel">{label}</span>
      <div className="hb-tpl-rel-items">
        {linked.length === 0 && <span className="hb-small">None</span>}
        {linked.map((k) => (
          <span key={k} className="hb-tpl-chip">
            {display(k)}
            <button
              type="button"
              className="hb-tpl-chip-x"
              aria-label={`Remove ${display(k)}`}
              onClick={() => onRemove(k)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        {available.length > 0 && (
          <Select
            variant="chip"
            hideLabel
            className="hb-tpl-rel-add"
            label={`Add ${label}`}
            value={null}
            placeholder="+ Add"
            options={available.map((o) => ({ value: o.key, label: display(o.key) }))}
            onChange={(v) => onAdd(v)}
          />
        )}
      </div>
    </div>
  );
}
