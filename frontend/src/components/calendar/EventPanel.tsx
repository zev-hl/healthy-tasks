import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, MapPin, Trash2, X } from 'lucide-react';
import {
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  EVENT_LOCATION_MAX,
  EVENT_NOTES_MAX,
  EVENT_TITLE_MAX,
  type ActiveUserDto,
  type EventDto,
  type EventKind,
  type SaveEventRequest,
  type TaskRef,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { isoToParts, partsToIso } from '../../lib/datetime';
import { EVENT_COLORS } from '../../lib/calendarKinds';
import { DatePicker, toYmd } from '../harbor/DatePicker';
import { Select, type SelectOption } from '../harbor/Select';
import { Btn, Card, Segmented } from '../harbor/ui';
import { Avatar, userLabel } from '../ui/Avatar';

/** What a new event starts from: a day (from the calendar), a linked task, or nothing. */
export interface NewEventSeed {
  day?: Date;
  task?: { id: number; name: string } | null;
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const isLink = (s: string) => /^https?:\/\//i.test(s.trim());

/** An all-day date is kept at UTC midnight of that calendar day (the server's rule). */
const allDayIso = (ymd: string) => `${ymd}T00:00:00.000Z`;
const allDayYmd = (iso: string) => iso.slice(0, 10);

function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(Math.min(23, (h ?? 9) + 1)).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
}

function fmtWhen(e: EventDto): string {
  const day = (iso: string, utc: boolean) =>
    new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(utc && { timeZone: 'UTC' }),
    });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (e.allDay) {
    const a = day(e.startAt, true);
    const b = day(e.endAt, true);
    return a === b ? `${a} · all day` : `${a} – ${b} · all day`;
  }
  const a = day(e.startAt, false);
  const b = day(e.endAt, false);
  return a === b
    ? `${a} · ${time(e.startAt)} – ${time(e.endAt)}`
    : `${a} ${time(e.startAt)} – ${b} ${time(e.endAt)}`;
}

/**
 * An event in the page's side panel (Nov 2026 plan, H4a): read it, or — for
 * its creator or an Admin — change or cancel it; or make a new one: kind,
 * title, time (or whole days), attendees, a place or link, a linked task and
 * notes. Attendees are told by their settings.
 */
export function EventPanel({
  event,
  seed,
  onClose,
  onSaved,
  onCanceled,
}: {
  /** The event to show; null for a new one. */
  event: EventDto | null;
  seed?: NewEventSeed;
  onClose: () => void;
  onSaved: (e: EventDto) => void;
  onCanceled?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(!event);
  if (event && !editing) {
    return (
      <EventView
        event={event}
        onClose={onClose}
        onEdit={() => setEditing(true)}
        onCanceled={onCanceled}
      />
    );
  }
  return (
    <EventForm
      event={event}
      seed={seed}
      onClose={event ? () => setEditing(false) : onClose}
      onSaved={(e) => {
        setEditing(false);
        onSaved(e);
      }}
    />
  );
}

function EventView({
  event,
  onClose,
  onEdit,
  onCanceled,
}: {
  event: EventDto;
  onClose: () => void;
  onEdit: () => void;
  onCanceled?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    if (
      !window.confirm(
        `Cancel “${event.title}”?${event.attendees.length ? ' Everyone in it is told.' : ''}`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.cancelEvent(event.id);
      onCanceled?.(event.id);
    } catch (e) {
      setError(errorText(e, 'Could not cancel it.'));
      setBusy(false);
    }
  }
  return (
    <Card className="hb-gpanel hb-evpanel">
      <section aria-label={`Event: ${event.title}`}>
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">
              <span
                className="hb-dot"
                style={{ background: EVENT_COLORS[event.kind] }}
                aria-hidden="true"
              />
              {EVENT_KIND_LABELS[event.kind]}
              {event.isPrivate && (
                <>
                  {' · '}
                  <Lock size={11} aria-hidden="true" /> Private
                </>
              )}
            </span>
            <h2>{event.title}</h2>
            <span className="hb-small">{fmtWhen(event)}</span>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="hb-gpanel-body hb-ev-body">
          {error && (
            <div className="hb-alert" role="alert">
              {error}
            </div>
          )}
          {event.location && (
            <p className="hb-ev-line">
              <MapPin size={14} aria-hidden="true" />
              {isLink(event.location) ? (
                <a href={event.location} target="_blank" rel="noopener noreferrer">
                  {event.location}
                </a>
              ) : (
                event.location
              )}
            </p>
          )}
          {event.task && (
            <p className="hb-ev-line">
              Task:{' '}
              <Link to={`/tasks/${event.task.id}`}>
                #{event.task.id} {event.task.name}
              </Link>
            </p>
          )}
          <div>
            <span className="hb-tpl-flabel">Who</span>
            <div className="hb-ev-people">
              <span className="hb-ev-person">
                <Avatar user={event.createdBy} px={22} decorative />
                {userLabel(event.createdBy)} <span className="hb-small">(made it)</span>
              </span>
              {event.attendees.map((a) => (
                <span key={a.id} className="hb-ev-person">
                  <Avatar user={a} px={22} decorative />
                  {userLabel(a)}
                </span>
              ))}
            </div>
          </div>
          {event.notes && (
            <div>
              <span className="hb-tpl-flabel">Notes</span>
              <p className="hb-ev-notes">{event.notes}</p>
            </div>
          )}
        </div>
        <div className="hb-gpanel-foot">
          {event.canEdit ? (
            <>
              <Btn onClick={() => void cancel()} disabled={busy}>
                <Trash2 size={14} aria-hidden="true" /> Cancel event
              </Btn>
              <span className="hb-grow" />
              <Btn kind="primary" onClick={onEdit} disabled={busy}>
                Edit
              </Btn>
            </>
          ) : (
            <span className="hb-small">
              Only {userLabel(event.createdBy)} or an Admin can change it.
            </span>
          )}
        </div>
      </section>
    </Card>
  );
}

function EventForm({
  event,
  seed,
  onClose,
  onSaved,
}: {
  event: EventDto | null;
  seed?: NewEventSeed;
  onClose: () => void;
  onSaved: (e: EventDto) => void;
}) {
  const startParts = event
    ? event.allDay
      ? { date: allDayYmd(event.startAt), time: '' }
      : isoToParts(event.startAt)
    : { date: toYmd(seed?.day ?? new Date()), time: '09:00' };
  const endParts = event
    ? event.allDay
      ? { date: allDayYmd(event.endAt), time: '' }
      : isoToParts(event.endAt)
    : { date: startParts.date, time: '10:00' };

  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'meeting');
  const [title, setTitle] = useState(event?.title ?? '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startDate, setStartDate] = useState(startParts.date);
  const [startTime, setStartTime] = useState(startParts.time || '09:00');
  const [endDate, setEndDate] = useState(endParts.date);
  const [endTime, setEndTime] = useState(endParts.time || '10:00');
  const [location, setLocation] = useState(event?.location ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [isPrivate, setIsPrivate] = useState(event?.isPrivate ?? false);
  const [task, setTask] = useState<{ id: number; name: string } | null>(
    event?.task ?? seed?.task ?? null,
  );
  const [attendees, setAttendees] = useState<string[]>(event?.attendees.map((a) => a.id) ?? []);
  const [people, setPeople] = useState<ActiveUserDto[]>([]);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskHits, setTaskHits] = useState<TaskRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listActiveUsers()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);
  useEffect(() => {
    const q = taskQuery.trim();
    if (q.length < 2) {
      setTaskHits([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api
        .searchTasks(q)
        .then((r) => alive && setTaskHits(r.slice(0, 6)))
        .catch(() => alive && setTaskHits([]));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [taskQuery]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const addable: SelectOption<string>[] = people
    .filter((p) => !attendees.includes(p.id))
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
    .map((p) => ({
      value: p.id,
      label: userLabel(p),
      lead: <Avatar user={p} px={22} decorative />,
    }));

  const startIso = allDay ? allDayIso(startDate) : partsToIso(startDate, startTime, 9);
  const endIso = allDay
    ? allDayIso(endDate || startDate)
    : partsToIso(endDate || startDate, endTime, 10);
  const order =
    startIso && endIso && new Date(endIso) < new Date(startIso)
      ? 'It has to end after it starts.'
      : null;
  const ok = title.trim().length > 0 && !!startIso && !!endIso && !order;

  function moveStart(d: string | null) {
    if (!d) return;
    // Keep the length: the end moves with the start.
    const len = new Date(endDate).getTime() - new Date(startDate).getTime();
    setStartDate(d);
    setEndDate(toYmd(new Date(new Date(d).getTime() + Math.max(0, len) + 12 * 3600_000)));
  }

  async function save() {
    if (!ok || !startIso || !endIso) return;
    setBusy(true);
    setError(null);
    const body: SaveEventRequest = {
      kind,
      title: title.trim(),
      startAt: startIso,
      endAt: endIso,
      allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
      isPrivate,
      taskId: task?.id ?? null,
      attendeeIds: attendees,
      ...(event && { expectedUpdatedAt: event.updatedAt }),
    };
    try {
      onSaved(event ? await api.updateEvent(event.id, body) : await api.createEvent(body));
    } catch (e) {
      setError(errorText(e, 'Could not save the event.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="hb-gpanel hb-evpanel">
      <form
        aria-label={event ? 'Edit event' : 'New event'}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">{event ? 'Edit event' : 'New event'}</span>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="hb-gpanel-body hb-ev-body">
          {error && (
            <div className="hb-alert" role="alert">
              {error}
            </div>
          )}
          <Segmented
            small
            label="Kind"
            value={kind}
            options={EVENT_KINDS.map((k) => ({ value: k, label: EVENT_KIND_LABELS[k] }))}
            onChange={setKind}
          />
          <input
            className="hb-title-input"
            value={title}
            maxLength={EVENT_TITLE_MAX}
            placeholder="Title"
            aria-label="Title"
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="hb-switch">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className="hb-switch-track" aria-hidden="true" />
            All day
          </label>
          <div className="hb-ev-when">
            <DatePicker
              variant="field"
              label="Starts"
              value={startDate}
              allowClear={false}
              onChange={moveStart}
              {...(!allDay && {
                time: startTime,
                onTimeChange: (t: string) => {
                  setStartTime(t);
                  if (endDate === startDate && endTime <= t) setEndTime(addHour(t));
                },
              })}
              renderValue={(v) =>
                v
                  ? `${new Date(`${v}T12:00`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}${allDay ? '' : ` · ${startTime}`}`
                  : 'Start'
              }
            />
            <span className="hb-small">to</span>
            <DatePicker
              variant="field"
              label="Ends"
              value={endDate}
              allowClear={false}
              onChange={(v) => v && setEndDate(v)}
              {...(!allDay && { time: endTime, onTimeChange: setEndTime })}
              renderValue={(v) =>
                v
                  ? `${new Date(`${v}T12:00`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}${allDay ? '' : ` · ${endTime}`}`
                  : 'End'
              }
            />
          </div>
          {order && <p className="hb-quicktask-error">{order}</p>}

          <div>
            <span className="hb-tpl-flabel">Who’s in it</span>
            <div className="hb-ev-people">
              {attendees.map((id) => {
                const p = byId.get(id) ?? event?.attendees.find((a) => a.id === id);
                return (
                  <span key={id} className="hb-ev-person">
                    {p && <Avatar user={p} px={22} decorative />}
                    {p ? userLabel(p) : 'Someone'}
                    <button
                      type="button"
                      className="rel-x"
                      aria-label={`Remove ${p ? userLabel(p) : 'them'}`}
                      onClick={() => setAttendees((a) => a.filter((x) => x !== id))}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>
            <Select
              label="Add someone"
              value=""
              placeholder="Add someone…"
              searchPlaceholder="Search people…"
              options={addable}
              onChange={(id) => id && setAttendees((a) => [...a, id])}
            />
          </div>

          <label className="hb-tpl-field">
            <span className="hb-tpl-flabel">Place or link</span>
            <input
              className="hb-tpl-input"
              value={location}
              maxLength={EVENT_LOCATION_MAX}
              placeholder="A room, an address, or a meeting link"
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>

          <div>
            <span className="hb-tpl-flabel">Linked task</span>
            {task ? (
              <span className="hb-ev-person">
                #{task.id} {task.name}
                <button
                  type="button"
                  className="rel-x"
                  aria-label="Unlink the task"
                  onClick={() => setTask(null)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ) : (
              <>
                <input
                  className="hb-tpl-input"
                  value={taskQuery}
                  placeholder="Search tasks by name or #number"
                  aria-label="Find a task to link"
                  onChange={(e) => setTaskQuery(e.target.value)}
                />
                {taskHits.length > 0 && (
                  <div className="hb-ev-hits" role="listbox" aria-label="Tasks">
                    {taskHits.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setTask({ id: t.id, name: t.name });
                          setTaskQuery('');
                        }}
                      >
                        #{t.id} {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <label className="hb-tpl-field">
            <span className="hb-tpl-flabel">Notes</span>
            <textarea
              className="hb-tpl-input"
              rows={3}
              value={notes}
              maxLength={EVENT_NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="hb-switch">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            <span className="hb-switch-track" aria-hidden="true" />
            Private: only the people in it (and Admins) see it
          </label>
        </div>
        <div className="hb-gpanel-foot">
          <Btn kind="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <span className="hb-grow" />
          <Btn kind="primary" type="submit" disabled={!ok || busy}>
            {busy ? 'Saving…' : event ? 'Save' : 'Add event'}
          </Btn>
        </div>
      </form>
    </Card>
  );
}
