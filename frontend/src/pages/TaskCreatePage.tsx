import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Paperclip, Tag, X } from 'lucide-react';
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  TASK_NAME_MIN_LENGTH,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ActiveUserDto,
  type TaskPriority,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { isMismatch, useDutyCatalog } from '../lib/duties';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { DEFAULT_DUE_HOUR, DEFAULT_START_HOUR, defaultTime, partsToIso } from '../lib/datetime';
import { RichTextEditor } from '../components/RichTextEditor';
import { DutyCrossCheck } from '../components/duties/DutyCrossCheck';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { Select, type SelectOption } from '../components/harbor/Select';
import { DatePicker, formatShortDay } from '../components/harbor/DatePicker';
import { Pill, PRIORITY_DOT, STATUS_DOT, STATUS_TONE } from '../components/harbor/ui';
import { PRIORITY_OPTIONS, dueInfo } from '../components/harbor/taskHelpers';

/**
 * New task (§6.3, "#new"): the task page with an empty, focused title and
 * the same chips, and a bar that reads "New task · Not created yet ·
 * Cancel · Create task". Comments and files are added once it exists.
 */
export function TaskCreatePage() {
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const titleRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState(me?.id ?? '');
  const [priority, setPriority] = useState<TaskPriority>(DEFAULT_TASK_PRIORITY);
  // Review is entered by sending an existing task to a reviewer, never at creation.
  const [status, setStatus] = useState<TaskStatus>(DEFAULT_TASK_STATUS);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [dutyId, setDutyId] = useState('');
  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [granting, setGranting] = useState(false);
  const catalog = useDutyCatalog();

  useEffect(() => {
    titleRef.current?.focus();
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const dirty =
    name.trim() !== '' ||
    description.replace(/<[^>]*>/g, '').trim() !== '' ||
    tags.length > 0 ||
    !!dueDate ||
    !!startDate ||
    !!dutyId;
  useUnsavedChangesWarning(dirty && !submitting);

  const doerId = assigneeId || null;
  const doer = users.find((u) => u.id === doerId) ?? null;
  const duty = dutyId ? (catalog.duties.get(dutyId) ?? null) : null;
  const mismatch = !catalog.loading && isMismatch(catalog.holdings, doerId, dutyId || null);
  const byId = new Map(users.map((u) => [u.id, u]));
  const isAbove = (actorId: string, subId: string | null) => {
    const seen = new Set<string>();
    let cur = subId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const sup = byId.get(cur)?.supervisorId ?? null;
      if (sup === actorId) return true;
      cur = sup;
    }
    return false;
  };
  const canGrant = !!me && !!doerId && (me.role === 'Admin' || isAbove(me.id, doerId));
  const supervisorName = (() => {
    const sup = byId.get(byId.get(doerId ?? '')?.supervisorId ?? '');
    return sup ? userLabel(sup) : null;
  })();

  async function grant() {
    if (!doerId || !dutyId) return;
    setGranting(true);
    try {
      await api.grantDuty(doerId, dutyId);
      catalog.grantLocally(doerId, dutyId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not give the duty');
    } finally {
      setGranting(false);
    }
  }

  async function create() {
    setError(null);
    if (name.trim().length < TASK_NAME_MIN_LENGTH) {
      setError('Give the task a title first.');
      titleRef.current?.focus();
      return;
    }
    const startAt = partsToIso(startDate, startTime, DEFAULT_START_HOUR);
    const dueAt = partsToIso(dueDate, dueTime, DEFAULT_DUE_HOUR);
    if (startAt && dueAt && new Date(startAt) >= new Date(dueAt)) {
      setError('Start must be earlier than Due.');
      return;
    }
    const pendingTag = tagDraft.trim();
    setSubmitting(true);
    try {
      const created = await api.createTask({
        name: name.trim(),
        description: description.replace(/<[^>]*>/g, '').trim() === '' ? null : description,
        assigneeId: assigneeId || null,
        priority,
        status,
        tags: pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags,
        startAt,
        dueAt,
        dutyId: dutyId || null,
      });
      navigate(`/tasks/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
      setSubmitting(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void createRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const createRef = useRef(create);
  createRef.current = create;

  const statusChoices: SelectOption<TaskStatus>[] = TASK_STATUSES.filter((s) => s !== 'Review').map(
    (s) => ({
      value: s,
      label: TASK_STATUS_LABELS[s],
      dot: STATUS_DOT[s],
    }),
  );
  const assigneeChoices: SelectOption<string>[] = [
    { value: '', label: 'Unassigned', lead: <span className="hb-unassigned">?</span> },
    ...[...users]
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
      .map((u) => ({
        value: u.id,
        label: u.id === me?.id ? `${userLabel(u)} (me)` : userLabel(u),
        lead: <Avatar user={u} px={24} decorative />,
        hint:
          duty && !catalog.loading && isMismatch(catalog.holdings, u.id, duty.id)
            ? 'doesn’t hold the duty'
            : undefined,
      })),
  ];
  const dutyChoices: SelectOption<string>[] = [
    { value: '', label: 'No duty' },
    ...catalog.departments
      .filter((d) => !d.archived)
      .flatMap((d) =>
        d.duties
          .filter((x) => !x.archived)
          .map((x) => ({
            value: x.id,
            label: `${d.name} › ${x.name}`,
            dot: d.color,
            hint:
              doerId && !catalog.loading && isMismatch(catalog.holdings, doerId, x.id)
                ? 'not held'
                : undefined,
          })),
      ),
  ];
  const due = dueInfo(partsToIso(dueDate, dueTime, DEFAULT_DUE_HOUR), status);
  const assignee = users.find((u) => u.id === assigneeId) ?? null;

  function addTag() {
    const t = tagDraft.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  }

  return (
    <div className="hb-task">
      <div className="hb-taskbar">
        <nav className="hb-crumbs" aria-label="Breadcrumb">
          <Link to="/tasks">
            <ChevronLeft size={16} aria-hidden="true" /> Tasks
          </Link>
          <span aria-hidden="true">/</span>
          <span>New task</span>
        </nav>
      </div>

      <header className="hb-taskhead">
        <div className="hb-taskhead-main">
          <div className="hb-flags">
            <Pill tone="blue">New, not saved yet</Pill>
          </div>
          <input
            ref={titleRef}
            className="hb-title-input is-new"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Task title"
            aria-label="Task title"
            maxLength={300}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
          <p className="hb-meta">
            Fill in what you know; everything but the title can change later.
          </p>
          <div className="hb-chips">
            <Select
              variant="chip"
              hideLabel
              className={`hb-prop tone-${STATUS_TONE[status]}`}
              label="Status"
              value={status}
              options={statusChoices}
              renderValue={(o) => (
                <>
                  <span
                    className="hb-dot"
                    style={{ background: STATUS_DOT[status] }}
                    aria-hidden="true"
                  />{' '}
                  {o?.label}
                </>
              )}
              onChange={setStatus}
            />
            <Select
              variant="chip"
              hideLabel
              className={`hb-prop${mismatch ? ' is-bad' : ''}`}
              label="Assignee"
              value={assigneeId}
              options={assigneeChoices}
              searchPlaceholder="Search people…"
              renderValue={() => (
                <>
                  {assignee ? (
                    <Avatar user={assignee} px={24} decorative />
                  ) : (
                    <span className="hb-unassigned">?</span>
                  )}
                  {assignee ? userLabel(assignee) : 'Unassigned'}
                </>
              )}
              onChange={setAssigneeId}
            />
            <DatePicker
              variant="chip"
              className="hb-prop"
              label="Due date"
              value={dueDate || null}
              placeholder="Due date"
              time={dueTime}
              onTimeChange={setDueTime}
              renderValue={() =>
                due ? `Due ${due.text}${dueTime ? ` · ${dueTime}` : ''}` : 'No due date'
              }
              onChange={(v) => {
                setDueDate(v ?? '');
                if (!v) setDueTime('');
                else if (!dueTime) setDueTime(defaultTime(DEFAULT_DUE_HOUR));
              }}
            />
            <DatePicker
              variant="chip"
              className="hb-prop"
              label="Start date"
              value={startDate || null}
              placeholder="Start date"
              time={startTime}
              onTimeChange={setStartTime}
              renderValue={(v) =>
                v
                  ? `Starts ${formatShortDay(v)}${startTime ? ` · ${startTime}` : ''}`
                  : 'No start date'
              }
              onChange={(v) => {
                setStartDate(v ?? '');
                if (!v) setStartTime('');
                else if (!startTime) setStartTime(defaultTime(DEFAULT_START_HOUR));
              }}
            />
            <Select
              variant="chip"
              hideLabel
              className={`hb-prop hb-prio prio-${priority.toLowerCase()}`}
              label="Priority"
              value={priority}
              options={PRIORITY_OPTIONS}
              renderValue={() => (
                <>
                  <span
                    className="hb-dot"
                    style={{ background: PRIORITY_DOT[priority] }}
                    aria-hidden="true"
                  />{' '}
                  {priority} priority
                </>
              )}
              onChange={setPriority}
            />
            <Select
              variant="chip"
              hideLabel
              className={`hb-prop${mismatch ? ' is-bad' : ''}`}
              label="Duty"
              value={dutyId}
              options={dutyChoices}
              searchPlaceholder="Search duties…"
              renderValue={() => (duty ? `${duty.departmentName} › ${duty.name}` : '+ Duty')}
              onChange={setDutyId}
            />
            {tags.map((t) => (
              <span key={t} className="hb-chip hb-tagchip">
                {t}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <span className="hb-chip hb-addtag">
              <Tag size={13} aria-hidden="true" />
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add tag"
                aria-label="Add a tag"
              />
            </span>
          </div>
          {mismatch && duty && doer && doerId && (
            <DutyCrossCheck
              personName={userLabel(doer)}
              personFirstName={doer.firstName || userLabel(doer)}
              duty={duty}
              blocking
              canGrant={canGrant}
              supervisorName={supervisorName}
              granting={granting}
              onGrant={() => void grant()}
              onPickAssignee={() => undefined}
              onClearDuty={() => setDutyId('')}
            />
          )}
        </div>
      </header>

      <div className="hb-task-body">
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <div className="hb-task-cols">
          <div className="hb-col">
            <section className="hb-card">
              <div className="hb-card-head">
                <h3>Description</h3>
              </div>
              <div className="hb-card-pad">
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  ariaLabel="Task description"
                />
              </div>
            </section>
          </div>
          <div className="hb-col">
            <section className="hb-card hb-soon-card">
              <div className="hb-card-head">
                <span className="hb-ic tone-grey">
                  <MessageSquare size={16} aria-hidden="true" />
                </span>
                <h3>Activity</h3>
              </div>
              <p className="hb-soon-text">
                <Paperclip size={13} aria-hidden="true" /> Comments, files, sub-tasks and links can
                be added as soon as the task is created.
              </p>
            </section>
          </div>
        </div>
      </div>

      <div className="hb-savebar" role="region" aria-label="New task">
        <span className="hb-savebar-dot" aria-hidden="true" />
        <strong>New task</strong>
        <span className="hb-savebar-what">Not created yet</span>
        {mismatch && <span className="hb-savebar-err">Fix the duty mismatch to create it.</span>}
        <span className="hb-grow" />
        <span className="hb-kbd">Ctrl + S</span>
        <button
          type="button"
          className="hb-savebar-discard"
          disabled={submitting}
          onClick={() => navigate(-1)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="hb-savebar-save"
          disabled={submitting || mismatch}
          onClick={() => void create()}
        >
          {submitting ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </div>
  );
}
