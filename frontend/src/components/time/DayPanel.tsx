import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Lock, X } from 'lucide-react';
import {
  TIME_DAY_MAX_MINUTES,
  TIME_DAY_NOTE_MAX,
  dutyLabel,
  formatHM,
  type RelatedTaskDto,
  type TaskUserRef,
  type TimeDayDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { Avatar } from '../ui/Avatar';
import { DutyTag, Swatch } from '../duties/DutyTag';
import type { CatalogDuty } from '../../lib/duties';
import { addDays, formatLongDay, splitMinutes, todayISO } from '../../lib/calendar';
import { isStaleWriteError } from '../../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../../lib/useUnsavedChangesWarning';
import { Btn, Card, Pill, StatusPill, cx } from '../harbor/ui';

/**
 * One day of time, in the page's side panel (Harbor: no pop-ups): minutes per
 * duty, the Completed flag and a note, with the day's related tasks below.
 *
 * Editable for the person's own day: only duties they currently hold can take
 * time; an entry on a duty they no longer hold (or that was archived) can be
 * cleared but not added to. A Completed day is locked until it's reopened —
 * reopening is a deliberate step, after which it edits normally. Read-only for a
 * supervisor looking at someone else's day from Time Review.
 */
export function DayPanel({
  date,
  readOnly,
  person,
  duties,
  heldDutyIds,
  onClose,
  onChanged,
  onNavigate,
}: {
  date: string;
  readOnly: boolean;
  /** The person whose day this is (shown in the read-only header). */
  person: (TaskUserRef & { firstName: string }) | null;
  duties: Map<string, CatalogDuty>;
  /** Duties the person currently holds (editable mode). */
  heldDutyIds: string[];
  onClose: () => void;
  /** After a save or a reopen, with the day as it now stands. */
  onChanged?: (day: TimeDayDto, how: 'saved' | 'reopened') => void;
  onNavigate: (date: string) => void;
}) {
  const [day, setDay] = useState<TimeDayDto | null>(null);
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [markDone, setMarkDone] = useState(false);
  const [related, setRelated] = useState<RelatedTaskDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const userId = readOnly ? person?.id : undefined;

  function adopt(d: TimeDayDto) {
    setDay(d);
    setEntries(Object.fromEntries(d.entries.map((e) => [e.dutyId, e.minutes])));
    setNote(d.note ?? '');
    setMarkDone(false);
  }

  useEffect(() => {
    let alive = true;
    setDay(null);
    setError(null);
    void Promise.all([
      api.listTimeDays(date, date, userId),
      api.listTimeRelatedTasks(date, date, userId),
    ])
      .then(([days, rel]) => {
        if (!alive) return;
        adopt(
          days[0] ?? {
            userId: userId ?? '',
            date,
            entries: [],
            completed: false,
            completedAt: null,
            note: null,
            updatedAt: null,
          },
        );
        setRelated(rel);
      })
      .catch(
        (err) =>
          alive && setError(err instanceof ApiError ? err.message : 'Failed to load this day'),
      );
    return () => {
      alive = false;
    };
  }, [date, userId]);

  const locked = !readOnly && !!day?.completed;
  const total = Object.values(entries).reduce((s, m) => s + m, 0);
  const over = total > TIME_DAY_MAX_MINUTES;
  const shownTotal =
    readOnly || locked ? (day?.entries ?? []).reduce((s, e) => s + e.minutes, 0) : total;
  const original = useMemo(
    () =>
      day
        ? JSON.stringify({
            e: Object.fromEntries(day.entries.map((e) => [e.dutyId, e.minutes])),
            n: day.note ?? '',
          })
        : '',
    [day],
  );
  const dirty = !!day && (JSON.stringify({ e: entries, n: note }) !== original || markDone);
  const next = addDays(date, 1);

  // Leaving the page with unsaved edits — a related-task link below, the
  // sidebar, Back, or a refresh — asks first instead of silently discarding them.
  useUnsavedChangesWarning(dirty);

  // Escape closes — unless there are unsaved edits to lose.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !dirty) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);
  const isFuture = (d: string) => d > todayISO();

  // Duties shown in the editor: the ones held now, plus any that already carry
  // time on this day (no longer held / archived — clear-only).
  const groups = useMemo(() => {
    const held = new Set(heldDutyIds.filter((id) => duties.get(id) && !duties.get(id)!.archived));
    const ids = new Set<string>([...held, ...Object.keys(entries)]);
    const byDept = new Map<
      string,
      { name: string; color: string; rows: { duty: CatalogDuty; gone: boolean }[] }
    >();
    for (const id of ids) {
      const duty = duties.get(id);
      if (!duty) continue;
      const g = byDept.get(duty.departmentId) ?? {
        name: duty.departmentName,
        color: duty.color,
        rows: [],
      };
      g.rows.push({ duty, gone: !held.has(id) });
      byDept.set(duty.departmentId, g);
    }
    return [...byDept.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.duty.name.localeCompare(b.duty.name)) }));
  }, [heldDutyIds, duties, entries]);

  function setMinutes(dutyId: string, minutes: number) {
    setEntries((e) => {
      const n = { ...e };
      const v = Math.max(0, Math.min(TIME_DAY_MAX_MINUTES, Math.round(minutes)));
      if (v > 0) n[dutyId] = v;
      else delete n[dutyId];
      return n;
    });
  }

  async function save() {
    if (!day) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveTimeDay(date, {
        entries: Object.entries(entries).map(([dutyId, minutes]) => ({ dutyId, minutes })),
        note: note.trim() || null,
        completed: markDone || undefined,
        expectedUpdatedAt: day.updatedAt,
      });
      onChanged?.(saved, 'saved');
      onClose();
    } catch (err) {
      if (isStaleWriteError(err)) {
        setError(
          'This day was changed in another window. It has been reloaded — please re-enter your changes.',
        );
        const [fresh] = await api.listTimeDays(date, date);
        if (fresh) adopt(fresh);
      } else setError(err instanceof ApiError ? err.message : 'Failed to save this day');
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    setSaving(true);
    setError(null);
    try {
      const d = await api.setTimeDayCompleted(date, false);
      adopt(d);
      onChanged?.(d, 'reopened');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reopen this day');
    } finally {
      setSaving(false);
    }
  }

  const close = () => {
    // The page's own guard covers navigation; × with typed work asks too.
    if (dirty && !window.confirm('Discard the time you entered for this day?')) return;
    onClose();
  };

  const readOnlyList =
    day && day.entries.length ? (
      <div className="hb-dp2-list">
        {[...day.entries]
          .sort((a, b) => {
            const A = duties.get(a.dutyId);
            const B = duties.get(b.dutyId);
            return (A ? dutyLabel(A) : '').localeCompare(B ? dutyLabel(B) : '');
          })
          .map((e) => (
            <div key={e.dutyId} className="hb-dp2-ro">
              <DutyTag duty={duties.get(e.dutyId)} />
              <span className="hb-dp2-time">{formatHM(e.minutes)}</span>
            </div>
          ))}
      </div>
    ) : (
      <div className="hb-dp2-empty">Nothing logged this day.</div>
    );

  return (
    <Card className="hb-gpanel hb-daypanel">
      <section aria-label={`Time for ${formatLongDay(date)}`}>
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">
              {readOnly && person ? (
                <>
                  <Avatar user={person} size="xs" decorative />
                  {`${person.firstName || person.email} · read-only`}
                </>
              ) : (
                'Log time'
              )}
            </span>
            <h2>{formatLongDay(date)}</h2>
            {day && (
              <span className="hb-dp2-state">
                {day.completed ? (
                  <Pill tone="green">
                    <Check size={12} aria-hidden="true" /> Completed
                  </Pill>
                ) : (
                  <Pill tone="grey">Not completed</Pill>
                )}
              </span>
            )}
          </div>
          <span className="hb-dp2-nav">
            <button
              type="button"
              className="hb-icon-btn hb-icon-btn-sm"
              disabled={dirty}
              title={dirty ? 'Save or cancel first' : 'Previous day'}
              aria-label="Previous day"
              onClick={() => onNavigate(addDays(date, -1))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="hb-icon-btn hb-icon-btn-sm"
              disabled={dirty || isFuture(next)}
              title={dirty ? 'Save or cancel first' : 'Next day'}
              aria-label="Next day"
              onClick={() => onNavigate(next)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="hb-icon-btn hb-icon-btn-sm"
              aria-label="Close day"
              title="Close"
              onClick={close}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </div>

        <div className="hb-gpanel-body">
          {error && (
            <div className="hb-alert" role="alert">
              {error}
            </div>
          )}
          {locked && (
            <div className="hb-dp2-lock">
              <Lock size={14} aria-hidden="true" />
              <span>Completed days are locked. Reopen the day to change it.</span>
            </div>
          )}

          {!day ? (
            <div className="hb-dp2-empty">{error ? '' : 'Loading…'}</div>
          ) : readOnly || locked ? (
            readOnlyList
          ) : groups.length === 0 ? (
            <div className="hb-dp2-empty">
              You don’t hold any duties yet. Ask your supervisor or an Admin to assign some.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="hb-dp2-grp">
                <div className="hb-dp2-grp-h">
                  <Swatch color={g.color} />
                  {g.name}
                </div>
                {g.rows.map(({ duty, gone }) => {
                  const m = entries[duty.id] ?? 0;
                  const { h, m: mm } = splitMinutes(m);
                  return (
                    <div key={duty.id} className={cx('hb-dp2-row', m > 0 && 'has')}>
                      <div className="hb-dp2-name">
                        <b>{duty.name}</b>
                        {gone ? (
                          <small>
                            No longer assigned: you can clear this entry but not add to it
                          </small>
                        ) : duty.description ? (
                          <small>{duty.description}</small>
                        ) : null}
                      </div>
                      <div className="hb-dp2-hm">
                        <input
                          type="number"
                          min={0}
                          max={24}
                          placeholder="0"
                          value={m ? h : ''}
                          readOnly={gone}
                          aria-label={`${duty.name} hours`}
                          onChange={(e) =>
                            setMinutes(duty.id, (Number(e.target.value) || 0) * 60 + mm)
                          }
                        />
                        <span>h</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={5}
                          placeholder="00"
                          value={m ? String(mm).padStart(2, '0') : ''}
                          readOnly={gone}
                          aria-label={`${duty.name} minutes`}
                          onChange={(e) =>
                            setMinutes(duty.id, h * 60 + Math.min(59, Number(e.target.value) || 0))
                          }
                        />
                        <span>m</span>
                        <button
                          type="button"
                          className="hb-dp2-clear"
                          aria-label={`Clear ${duty.name}`}
                          style={m ? undefined : { visibility: 'hidden' }}
                          onClick={() => setMinutes(duty.id, 0)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                      {!gone && (
                        <div className="hb-dp2-quick">
                          {[15, 30, 60].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setMinutes(duty.id, m + n)}
                            >
                              +{n === 60 ? '1h' : `${n}m`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {day && !readOnly && !locked && groups.length > 0 && (
            <span className="hb-small">Only duties you hold can be logged.</span>
          )}
          {day && (
            <div className={cx('hb-dp2-total', over && 'is-over')}>
              <span>Day total</span>
              <b>{shownTotal ? formatHM(shownTotal) : '0:00'}</b>
              {over && <span className="hb-dp-err">More than 24 hours</span>}
            </div>
          )}

          {day && !readOnly && !locked && (
            <>
              <label className="hb-switch hb-dp2-done">
                <input
                  type="checkbox"
                  checked={markDone}
                  onChange={(e) => setMarkDone(e.target.checked)}
                />
                <span className="hb-switch-track" aria-hidden="true" />
                Mark this day as completed
              </label>
              <label className="hb-tpl-field" htmlFor="dd-note">
                <span className="hb-tpl-flabel">Note (optional)</span>
                <input
                  id="dd-note"
                  className="hb-tpl-input"
                  value={note}
                  maxLength={TIME_DAY_NOTE_MAX}
                  placeholder="e.g. covered phones for Yusuf in the afternoon"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
          {day?.note && (readOnly || locked) && (
            <div className="hb-dp2-note">
              <span className="hb-tpl-flabel">Note</span> {day.note}
            </div>
          )}

          <div className="hb-dp2-rel">
            <span className="hb-tpl-flabel">
              Tasks with a duty that fall on this day · {related.length}
            </span>
            {related.length ? (
              related.map((t) => (
                <div key={t.id} className="hb-dp2-relrow">
                  {/* A new tab: these are for reference while logging, and leaving
                      the page would throw away the time being entered. */}
                  <Link
                    to={`/tasks/${t.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Opens in a new tab"
                  >
                    {t.name}
                  </Link>
                  <span className="hb-dp2-relmeta">
                    #{t.id}
                    <DutyTag duty={t.duty} compact />
                    <StatusPill status={t.status} />
                  </span>
                </div>
              ))
            ) : (
              <span className="hb-small">None</span>
            )}
          </div>
        </div>

        <div className="hb-gpanel-foot">
          {readOnly ? (
            <Btn kind="primary" onClick={onClose}>
              Close
            </Btn>
          ) : locked ? (
            <>
              <Btn kind="ghost" onClick={onClose}>
                Close
              </Btn>
              <Btn kind="primary" disabled={saving} onClick={() => void reopen()}>
                {saving ? 'Reopening…' : 'Reopen day'}
              </Btn>
            </>
          ) : (
            <>
              <Btn kind="ghost" onClick={onClose}>
                Cancel
              </Btn>
              <Btn
                kind="primary"
                disabled={!dirty || over || saving || !day}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save day'}
              </Btn>
            </>
          )}
        </div>
      </section>
    </Card>
  );
}
