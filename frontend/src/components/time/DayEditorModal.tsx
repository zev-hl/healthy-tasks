import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { ModalShell } from '../exclusives/ModalShell';
import { Avatar } from '../ui/Avatar';
import { StatusPill } from '../ui/indicators';
import { DutyTag, Swatch } from '../duties/DutyTag';
import type { CatalogDuty } from '../../lib/duties';
import { addDays, formatLongDay, splitMinutes, todayISO } from '../../lib/calendar';
import { isStaleWriteError } from '../../lib/useStaleWriteGuard';

/**
 * One day of time: minutes per duty, the Completed flag and a note.
 *
 * Editable for the person's own day: only duties they currently hold can take
 * time; an entry on a duty they no longer hold (or that was archived) can be
 * cleared but not added to. A Completed day is locked until it's reopened —
 * reopening is a deliberate step, after which it edits normally. Read-only for a
 * supervisor looking at someone else's day from Time Review.
 */
export function DayEditorModal({
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

  const readOnlyTable = (
    <>
      {day && day.entries.length ? (
        <div className="dd-tbl-wrap">
          <table className="dd-tbl">
            <thead>
              <tr>
                <th>Department › Duty</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {[...day.entries]
                .sort((a, b) => {
                  const A = duties.get(a.dutyId);
                  const B = duties.get(b.dutyId);
                  return (A ? dutyLabel(A) : '').localeCompare(B ? dutyLabel(B) : '');
                })
                .map((e) => (
                  <tr key={e.dutyId}>
                    <td>
                      <DutyTag duty={duties.get(e.dutyId)} />
                    </td>
                    <td className="num">{formatHM(e.minutes)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dd-empty">Nothing logged this day.</div>
      )}
      {day?.note && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          <span className="u-label">Note</span> {day.note}
        </div>
      )}
    </>
  );

  return (
    <ModalShell
      title={formatLongDay(date)}
      tone={day?.completed ? 'accent' : 'neutral'}
      width="720px"
      onBackdropClick={dirty ? undefined : onClose}
      hint={
        readOnly
          ? undefined
          : locked
            ? 'Completed days are locked. Reopen the day to change it.'
            : 'Only duties you hold can be logged.'
      }
      actions={
        readOnly ? (
          <button type="button" className="btn-sm" onClick={onClose}>
            Close
          </button>
        ) : locked ? (
          <>
            <button type="button" className="secondary btn-sm" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={saving}
              onClick={() => void reopen()}
            >
              {saving ? 'Reopening…' : 'Reopen day'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={!dirty || over || saving || !day}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save day'}
            </button>
          </>
        )
      }
    >
      <div className="dd-modal-head">
        {readOnly && person && <Avatar user={person} size="xs" decorative />}
        <span className="u-label">
          {readOnly && person ? `${person.firstName || person.email} · read-only` : 'Log time'}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="secondary btn-sm"
          disabled={dirty}
          title={dirty ? 'Save or cancel first' : undefined}
          aria-label="Previous day"
          onClick={() => onNavigate(addDays(date, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="secondary btn-sm"
          disabled={dirty || isFuture(next)}
          aria-label="Next day"
          onClick={() => onNavigate(next)}
        >
          ›
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {!day ? (
        <div className="dd-empty">{error ? '' : 'Loading…'}</div>
      ) : readOnly || locked ? (
        readOnlyTable
      ) : groups.length === 0 ? (
        <div className="dd-empty">
          You don’t hold any duties yet. Ask your supervisor or an Admin to assign some.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.name} className="dd-de-grp">
            <div className="dd-de-grp-h">
              <Swatch color={g.color} />
              {g.name}
            </div>
            {g.rows.map(({ duty, gone }) => {
              const m = entries[duty.id] ?? 0;
              const { h, m: mm } = splitMinutes(m);
              return (
                <div key={duty.id} className={`dd-de-row${m ? ' has' : ''}`}>
                  <div className="dd-de-name">
                    {duty.name}
                    {gone ? (
                      <small>No longer assigned: you can clear this entry but not add to it</small>
                    ) : duty.description ? (
                      <small>{duty.description}</small>
                    ) : null}
                  </div>
                  {!gone && (
                    <div className="dd-quick">
                      {[15, 30, 60].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className="dd-quick-btn"
                          onClick={() => setMinutes(duty.id, m + n)}
                        >
                          +{n === 60 ? '1h' : `${n}m`}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="dd-hm">
                    <input
                      type="number"
                      min={0}
                      max={24}
                      placeholder="0"
                      value={m ? h : ''}
                      readOnly={gone}
                      aria-label={`${duty.name} hours`}
                      onChange={(e) => setMinutes(duty.id, (Number(e.target.value) || 0) * 60 + mm)}
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
                  </div>
                  <button
                    type="button"
                    className="dd-icon-btn"
                    aria-label={`Clear ${duty.name}`}
                    style={m ? undefined : { visibility: 'hidden' }}
                    onClick={() => setMinutes(duty.id, 0)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ))
      )}

      {day && (
        <div className="dd-de-total">
          <span className="u-label">Day total</span>
          <span className="mono">{shownTotal ? formatHM(shownTotal) : '0:00'}</span>
          {over && <span className="dd-inline-err">More than 24 hours</span>}
          <span className="spacer" />
          {readOnly || locked ? (
            <span className={`dd-done${day.completed ? ' on' : ''}`}>
              <span className="ck">{day.completed ? '✓' : ''}</span>
              {day.completed ? 'Completed' : 'Not completed'}
            </span>
          ) : (
            <label className="dd-check" style={{ fontWeight: 600, color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={markDone}
                onChange={(e) => setMarkDone(e.target.checked)}
              />{' '}
              Mark this day as completed
            </label>
          )}
        </div>
      )}

      {day && !readOnly && !locked && (
        <div className="field" style={{ margin: '12px 0 0' }}>
          <label htmlFor="dd-note">Note (optional)</label>
          <input
            id="dd-note"
            value={note}
            maxLength={TIME_DAY_NOTE_MAX}
            placeholder="e.g. covered phones for Yusuf in the afternoon"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}

      <div className="dd-rel">
        <div className="u-label" style={{ marginBottom: 4 }}>
          Tasks with a duty that fall on this day · {related.length}
        </div>
        {related.length ? (
          related.map((t) => (
            <div key={t.id} className="dd-rel-item">
              <span className="dd-task-id">#{t.id}</span>
              <Link to={`/tasks/${t.id}`} style={{ fontWeight: 600 }}>
                {t.name}
              </Link>
              <span className="spacer" />
              <DutyTag duty={t.duty} compact />
              <StatusPill status={t.status} />
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>
            None
          </div>
        )}
      </div>
    </ModalShell>
  );
}
