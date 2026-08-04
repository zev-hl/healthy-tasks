import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RECURRENCE_TYPE_LABELS,
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
  type TemplateNodeInput,
  type TemplateSummaryDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { userLabel } from '../components/ui/Avatar';
import { EmptyState } from '../components/ui/EmptyState';
import { WeekdayPicker } from '../components/WeekdayPicker';

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
  return { key, parentKey, name: '', description: '', defaultPriority: 'Medium', startOffsetDays: '', dueOffsetDays: '', assigneeRole: '', tags: '', attachmentCount: 0 };
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
      tags: n.tags.join(', '),
      attachmentCount: n.attachmentCount,
    })),
    dependencies: t.dependencies.map((d) => ({ blockerKey: keyOf(d.blockerNodeId), blockedKey: keyOf(d.blockedNodeId) })),
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

// --- Page ------------------------------------------------------------------

export function TemplatesPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<TemplateSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [instantiating, setInstantiating] = useState<TemplateDto | null>(null);
  const [users, setUsers] = useState<ActiveUserDto[]>([]);

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
    api.listActiveUsers().then(setUsers).catch(() => setUsers([]));
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
      setNotice(`Deleted “${t.name}”.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the template');
    }
  }

  if (editor) {
    return (
      <TemplateEditor
        editor={editor}
        setEditor={setEditor}
        nextKey={nextKey}
        onCancel={() => setEditor(null)}
        onSaved={(msg) => {
          setEditor(null);
          setNotice(msg);
          load();
        }}
      />
    );
  }

  return (
    <div className="tasks-page">
      <div className="tasks-toolbar">
        <h1>Task templates</h1>
        <span className="mono tasks-total">{loading ? '…' : list.length}</span>
        <div className="spacer" />
        <button onClick={newTemplate}>New template</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      {!loading && list.length === 0 ? (
        <EmptyState title="No templates yet" >
          Create a reusable task tree with relative dates, role placeholders, and an optional
          recurrence schedule.
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Recurrence</th>
                <th>Nodes</th>
                <th>Instances</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.description && <div className="muted" style={{ fontSize: '0.8rem' }}>{t.description}</div>}
                  </td>
                  <td>{RECURRENCE_TYPE_LABELS[t.recurrenceType]}</td>
                  <td className="mono">{t.nodeCount}</td>
                  <td className="mono">{t.occurrenceCount}</td>
                  <td>
                    <span className={`badge ${t.isActive ? 'active' : 'inactive'}`}>
                      {t.isActive ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td>
                    <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn-sm"
                        onClick={() => void openInstantiate(t.id)}
                      >
                        Instantiate
                      </button>
                      <button className="secondary btn-sm" onClick={() => void editTemplate(t.id)}>
                        Edit
                      </button>
                      <button className="secondary btn-sm" onClick={() => void removeTemplate(t)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {instantiating && (
        <InstantiateModal
          template={instantiating}
          users={users}
          onClose={() => setInstantiating(null)}
          onDone={(rootTaskId) => {
            setInstantiating(null);
            setNotice('Template instantiated.');
            load();
            navigate(`/tasks/${rootTaskId}`);
          }}
        />
      )}
    </div>
  );

  async function openInstantiate(id: number) {
    setError(null);
    try {
      setInstantiating(await api.getTemplate(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the template');
    }
  }
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
  // Edit-scope ("this and following"): after saving an existing template with
  // materialized future instances, offer to re-sync them (never automatic).
  const [pendingFuture, setPendingFuture] = useState<FutureOccurrenceDto[] | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [showRecurrence, setShowRecurrence] = useState(editor.recurrence.recurrenceType !== 'None');
  // Collapsed node keys (display-only; never affects drag/order). Drag state for
  // sibling reordering within the tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string; pos: TemplateDropPosition } | null>(null);
  // A node is only draggable while its handle is held (so the card's inputs stay
  // fully usable). Collapsing never changes this — a collapsed node still drags.
  const [armed, setArmed] = useState<string | null>(null);

  const r = editor.recurrence;
  const recurrenceSummary =
    r.recurrenceType === 'None'
      ? 'Does not repeat'
      : `Every ${r.intervalCount} ${RECURRENCE_UNIT_LABELS[r.intervalUnit]}`;
  const patch = (p: Partial<EditorState>) => setEditor({ ...editor, ...p });
  const patchRec = (p: Partial<EditorRecurrence>) => setEditor({ ...editor, recurrence: { ...r, ...p } });
  const patchNode = (key: string, p: Partial<EditorNode>) =>
    setEditor({ ...editor, nodes: editor.nodes.map((n) => (n.key === key ? { ...n, ...p } : n)) });

  function addNode() {
    const key = nextKey();
    const root = editor.nodes.find((n) => n.parentKey === null) ?? editor.nodes[0];
    patch({ nodes: [...editor.nodes, blankNode(key, root?.key ?? null)] });
  }
  function removeNode(key: string) {
    const node = editor.nodes.find((n) => n.key === key);
    if (!node) return;
    // Reparent this node's children to its parent; drop deps that touch it.
    const nodes = editor.nodes
      .filter((n) => n.key !== key)
      .map((n) => (n.parentKey === key ? { ...n, parentKey: node.parentKey } : n));
    const dependencies = editor.dependencies.filter((d) => d.blockerKey !== key && d.blockedKey !== key);
    patch({ nodes, dependencies });
  }

  // Stable "Node N" identifiers (like task #ids) so nodes are referenceable in
  // the dependency pickers even before they're named.
  const nodeDisplay = (key: string) => {
    const idx = editor.nodes.findIndex((n) => n.key === key);
    const n = editor.nodes[idx];
    return `Node ${idx + 1}${n?.name ? ` · ${n.name}` : ''}`;
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
  const collapseAll = () => setCollapsed(new Set(editor.nodes.filter((n) => hasChildren(n.key)).map((n) => n.key)));
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

  // Recursive tree render: a node card, indented by depth, followed by its
  // children (hidden when the node is collapsed). Rendering from the derived
  // tree means a Parent change immediately nests the node under its new parent.
  const renderNode = (n: EditorNode, depth: number) => {
    const idx = editor.nodes.findIndex((x) => x.key === n.key);
    const isRoot = n.parentKey === null;
    const kids = childrenOf(n.key);
    const nodeCollapsed = isCollapsed(n.key);
    const hiddenCount = nodeCollapsed ? templateSubtreeKeys(editor.nodes, n.key).size - 1 : 0;
    const hint = dropHint?.key === n.key ? dropHint.pos : null;
    return (
      <div key={n.key} className="tpl-tree-node" style={{ marginLeft: depth * 22 }}>
        <div
          className={`tpl-node${dragKey === n.key ? ' dragging' : ''}${hint ? ` drop-${hint}` : ''}`}
          draggable={armed === n.key}
          onDragStart={(e) => onNodeDragStart(e, n.key)}
          onDragOver={(e) => onNodeDragOver(e, n.key)}
          onDrop={(e) => onNodeDrop(e, n.key)}
          onDragEnd={onNodeDragEnd}
        >
          <div className="tpl-node-head">
            <span className="tpl-node-headleft">
              {isRoot ? (
                <span className="tpl-drag-handle placeholder" aria-hidden="true" />
              ) : (
                <span
                  className="tpl-drag-handle"
                  role="button"
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  onMouseDown={() => setArmed(n.key)}
                  onMouseUp={() => setArmed(null)}
                >
                  ⠿
                </span>
              )}
              {kids.length > 0 ? (
                <button
                  type="button"
                  className="tpl-collapse"
                  aria-expanded={!nodeCollapsed}
                  title={nodeCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() => toggleCollapse(n.key)}
                >
                  {nodeCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="tpl-collapse placeholder" />
              )}
              <strong>
                Node {idx + 1}
                {isRoot && <span className="badge" style={{ marginLeft: 8 }}>Root</span>}
                {n.name ? <span className="muted tpl-node-name"> · {n.name}</span> : null}
                {hiddenCount > 0 && (
                  <span className="muted tpl-collapsed-count"> ({hiddenCount} hidden)</span>
                )}
              </strong>
            </span>
            {!isRoot && (
              <button className="secondary btn-sm" onClick={() => removeNode(n.key)}>
                Remove
              </button>
            )}
          </div>
          <div className="tpl-node-grid">
            <div className="field tpl-node-wide">
              <label>Name</label>
              <input value={n.name} onChange={(e) => patchNode(n.key, { name: e.target.value })} />
            </div>
            <div className="field tpl-node-wide">
              <label>Description</label>
              <textarea
                value={n.description}
                rows={2}
                placeholder="Default description for the generated task…"
                onChange={(e) => patchNode(n.key, { description: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Parent</label>
              {isRoot ? (
                <input value="— (root)" disabled />
              ) : (
                <select
                  value={n.parentKey ?? ''}
                  onChange={(e) => patchNode(n.key, { parentKey: e.target.value })}
                >
                  {parentOptions(n.key).map((o) => (
                    <option key={o.key} value={o.key}>
                      {nodeDisplay(o.key)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={n.defaultPriority} onChange={(e) => patchNode(n.key, { defaultPriority: e.target.value as TaskPriority })}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Role placeholder</label>
              <input value={n.assigneeRole} placeholder="e.g. Inspector" onChange={(e) => patchNode(n.key, { assigneeRole: e.target.value })} />
            </div>
            <div className="field">
              <label>Start (+days)</label>
              <input type="number" value={n.startOffsetDays} onChange={(e) => patchNode(n.key, { startOffsetDays: e.target.value })} />
            </div>
            <div className="field">
              <label>Due (+days)</label>
              <input type="number" value={n.dueOffsetDays} onChange={(e) => patchNode(n.key, { dueOffsetDays: e.target.value })} />
            </div>
            <div className="field tpl-node-wide">
              <label>Tags</label>
              <input
                value={n.tags}
                placeholder="Comma-separated, e.g. inspection, monthly"
                onChange={(e) => patchNode(n.key, { tags: e.target.value })}
              />
            </div>
            {n.attachmentCount > 0 && (
              <div className="field tpl-node-wide">
                <span className="muted tpl-attach-note">
                  📎 {n.attachmentCount} default attachment{n.attachmentCount === 1 ? '' : 's'} copied onto each new task.
                </span>
              </div>
            )}
          </div>

          {/* Dependencies live on the node, mirroring a real task's relationships.
              Each edge shows as "Blocks" on one node and "Blocked by" on the other. */}
          {editor.nodes.length > 1 && (
            <div className="tpl-node-rels">
              <TplRel
                label="Blocked by"
                linked={editor.dependencies.filter((d) => d.blockedKey === n.key).map((d) => d.blockerKey)}
                options={editor.nodes.filter((o) => o.key !== n.key)}
                display={nodeDisplay}
                onAdd={(other) => patch({ dependencies: [...editor.dependencies, { blockerKey: other, blockedKey: n.key }] })}
                onRemove={(other) =>
                  patch({ dependencies: editor.dependencies.filter((d) => !(d.blockerKey === other && d.blockedKey === n.key)) })
                }
              />
              <TplRel
                label="Blocks"
                linked={editor.dependencies.filter((d) => d.blockerKey === n.key).map((d) => d.blockedKey)}
                options={editor.nodes.filter((o) => o.key !== n.key)}
                display={nodeDisplay}
                onAdd={(other) => patch({ dependencies: [...editor.dependencies, { blockerKey: n.key, blockedKey: other }] })}
                onRemove={(other) =>
                  patch({ dependencies: editor.dependencies.filter((d) => !(d.blockerKey === n.key && d.blockedKey === other)) })
                }
              />
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
    if (editor.nodes.some((n) => !n.name.trim())) return setError('Every node needs a name');
    if (r.recurrenceType !== 'None' && !r.anchorDate) return setError('A recurring template needs a start (anchor) date');

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
        await api.applyTemplateToFuture(savedId, pendingFuture.map((f) => f.occurrenceId));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not update future instances');
        setPendingFuture(null);
        return;
      }
    }
    onSaved('Template updated.');
  }

  return (
    <div className="tasks-page">
      <div className="tasks-toolbar">
        <h1>{editor.id ? 'Edit template' : 'New template'}</h1>
        <div className="spacer" />
        <button className="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button onClick={() => void doSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <section className="card panel">
        <div className="field">
          <label htmlFor="tpl-name">Template name</label>
          <input id="tpl-name" value={editor.name} onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tpl-desc">Notes (optional)</label>
          <textarea id="tpl-desc" value={editor.description} onChange={(e) => patch({ description: e.target.value })} rows={2} />
        </div>

        {/* Recurrence — collapsible, at the bottom of Name & Notes. */}
        <div className="recur-collapse">
          <button
            type="button"
            className="recur-collapse-head"
            aria-expanded={showRecurrence}
            onClick={() => setShowRecurrence((v) => !v)}
          >
            <span className="recur-caret" aria-hidden="true">▸</span>
            Recurrence
            <span className="recur-collapse-summary">· {recurrenceSummary}</span>
          </button>
          {showRecurrence && (
            <div className="recur-collapse-body">
              <div className="field">
                <label>Repeat</label>
                <select value={r.recurrenceType} onChange={(e) => patchRec({ recurrenceType: e.target.value as RecurrenceType })}>
                  <option value="None">{RECURRENCE_TYPE_LABELS.None}</option>
                  <option value="Fixed">{RECURRENCE_TYPE_LABELS.Fixed}</option>
                  <option value="RelativeToCompletion">{RECURRENCE_TYPE_LABELS.RelativeToCompletion}</option>
                </select>
              </div>
              {r.recurrenceType !== 'None' && (
                <>
                  <div className="tpl-node-grid">
                    <div className="field">
                      <label>Repeat every</label>
                      <div className="recur-interval">
                        <input type="number" min={1} value={r.intervalCount} onChange={(e) => patchRec({ intervalCount: e.target.value })} style={{ width: 64 }} />
                        <select value={r.intervalUnit} onChange={(e) => patchRec({ intervalUnit: e.target.value as RecurrenceUnit })}>
                          {RECURRENCE_UNITS.map((u) => (
                            <option key={u} value={u}>{RECURRENCE_UNIT_LABELS[u]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>Start (anchor) date</label>
                      <input type="date" value={r.anchorDate} onChange={(e) => patchRec({ anchorDate: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Ends</label>
                      <select value={r.endType} onChange={(e) => patchRec({ endType: e.target.value as RecurrenceEndType })}>
                        <option value="Never">Never</option>
                        <option value="OnDate">On a date</option>
                        <option value="AfterOccurrences">
                          {r.recurrenceType === 'RelativeToCompletion'
                            ? 'Stop after N completions'
                            : 'After N occurrences'}
                        </option>
                      </select>
                    </div>
                    {r.endType === 'OnDate' && (
                      <div className="field">
                        <label>End date</label>
                        <input type="date" value={r.endDate} onChange={(e) => patchRec({ endDate: e.target.value })} />
                      </div>
                    )}
                    {r.endType === 'AfterOccurrences' && (
                      <div className="field">
                        <label>{r.recurrenceType === 'RelativeToCompletion' ? 'Completions' : 'Occurrences'}</label>
                        <input type="number" min={1} value={r.maxOccurrences} onChange={(e) => patchRec({ maxOccurrences: e.target.value })} />
                      </div>
                    )}
                    <div className="field">
                      <label>Label prefix (optional)</label>
                      <input value={r.labelPrefix} placeholder="e.g. BATCH" onChange={(e) => patchRec({ labelPrefix: e.target.value })} />
                    </div>
                    <div className="field">
                      <label>Status</label>
                      <div className="seg" role="group" aria-label="Recurrence status">
                        <button
                          type="button"
                          className={`seg-btn${r.isActive ? ' active' : ''}`}
                          aria-pressed={r.isActive}
                          onClick={() => patchRec({ isActive: true })}
                        >
                          Active
                        </button>
                        <button
                          type="button"
                          className={`seg-btn${!r.isActive ? ' active' : ''}`}
                          aria-pressed={!r.isActive}
                          onClick={() => patchRec({ isActive: false })}
                        >
                          Paused
                        </button>
                      </div>
                    </div>
                  </div>
                  {r.intervalUnit === 'Week' && (
                    <div className="field" style={{ marginTop: '0.6rem' }}>
                      <label>Repeat on</label>
                      <WeekdayPicker value={r.weekdays} onChange={(v) => patchRec({ weekdays: v })} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Nodes */}
      <section className="card panel">
        <div className="section-head">
          <h3>Task tree</h3>
          <span className="muted tpl-tree-hint">Drag the ⠿ handle to reorder siblings; a Parent change nests a node.</span>
          <div className="spacer" />
          <button className="tertiary btn-sm" onClick={collapseAll} disabled={!editor.nodes.some((n) => hasChildren(n.key))}>
            Collapse all
          </button>
          <button className="tertiary btn-sm" onClick={expandAll} disabled={collapsed.size === 0}>
            Expand all
          </button>
          <button className="tertiary btn-sm" onClick={addNode}>
            + Add node
          </button>
        </div>
        <div className="tpl-tree">{rootNode ? renderNode(rootNode, 0) : null}</div>
      </section>

      {pendingFuture && (
        <div className="modal-backdrop" onClick={() => void applyFuture(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Update future instances?</h3>
            <p>
              This template has {pendingFuture.length} already-created future instance
              {pendingFuture.length === 1 ? '' : 's'} that haven’t started yet. Update
              {pendingFuture.length === 1 ? ' it' : ' them'} to match your edit? Completed and
              in-progress work is never changed.
            </p>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => void applyFuture(false)}>
                Leave them
              </button>
              <button onClick={() => void applyFuture(true)}>Update them</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Instantiate modal -----------------------------------------------------

function InstantiateModal({
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
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [label, setLabel] = useState('');
  const [anchor, setAnchor] = useState(today);
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.instantiateTemplate(template.id, {
        instanceLabel: label.trim() || null,
        anchorStart: anchor,
        roleAssignments: template.roles.map((role) => ({ role, assigneeId: roleMap[role] || null })),
      });
      onDone(res.rootTaskId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not instantiate the template');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Instantiate “{template.name}”</h3>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label htmlFor="inst-label">Instance label (optional)</label>
          <input id="inst-label" value={label} placeholder="e.g. PO-4521" onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="inst-anchor">Start date</label>
          <input id="inst-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </div>
        {template.roles.length > 0 && (
          <>
            <div className="u-label" style={{ marginBottom: '0.3rem' }}>Assign roles</div>
            {template.roles.map((role) => (
              <div key={role} className="field">
                <label>{role}</label>
                <select value={roleMap[role] ?? ''} onChange={(e) => setRoleMap((m) => ({ ...m, [role]: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{userLabel(u)}</option>
                  ))}
                </select>
              </div>
            ))}
          </>
        )}
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create tasks'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="tpl-rel">
      <span className="tpl-rel-label">{label}</span>
      <div className="tpl-rel-items">
        {linked.length === 0 && <span className="muted" style={{ fontSize: '0.8rem' }}>None</span>}
        {linked.map((k) => (
          <span key={k} className="filter-chip">
            {display(k)}
            <button type="button" className="chip-x" aria-label={`Remove ${display(k)}`} onClick={() => onRemove(k)}>
              ×
            </button>
          </span>
        ))}
        {available.length > 0 && (
          <select value="" aria-label={`Add ${label}`} onChange={(e) => e.target.value && onAdd(e.target.value)}>
            <option value="">+ add…</option>
            {available.map((o) => (
              <option key={o.key} value={o.key}>
                {display(o.key)}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
