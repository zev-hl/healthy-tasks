import { useEffect, useRef, useState } from 'react';
import { Phone, X } from 'lucide-react';
import {
  CALL_LENGTHS,
  type ActiveUserDto,
  type ScheduleCallResultDto,
  type TaskDetailDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { partsToIso } from '../../lib/datetime';
import { DatePicker, toYmd } from '../harbor/DatePicker';
import { Popover } from '../harbor/Popover';
import { Select, type SelectOption } from '../harbor/Select';
import { Btn, Segmented } from '../harbor/ui';
import { useToast } from '../harbor/Toast';
import { Avatar, userLabel } from '../ui/Avatar';

type When = 'now' | 'in15' | 'in60' | 'tomorrow' | 'pick';

/** The quick times, as a moment (null: ring now, or pick one). */
function whenAt(w: When): Date | null {
  const now = new Date();
  if (w === 'in15') return new Date(now.getTime() + 15 * 60_000);
  if (w === 'in60') return new Date(now.getTime() + 60 * 60_000);
  if (w === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return null;
}

/**
 * "Schedule call" on a task (Nov 2026 plan, K2): ring now, or book a Connect
 * call at a quick time or one you pick, with the people you choose (the
 * assignee and creator to start with). It is saved on the task and the
 * calendar as a Call with its join link; if Connect can't book it, it's kept
 * as a meeting and you're told why.
 */
export function ScheduleCallButton({
  task,
  meId,
  onBooked,
}: {
  task: TaskDetailDto;
  meId: string;
  onBooked?: (r: ScheduleCallResultDto) => void;
}) {
  const toast = useToast();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ActiveUserDto[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [when, setWhen] = useState<When>('now');
  const [day, setDay] = useState<string | null>(toYmd(new Date()));
  const [time, setTime] = useState('14:00');
  const [minutes, setMinutes] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .listActiveUsers()
      .then(setPeople)
      .catch(() => setPeople([]));
    setWho(
      [...new Set([task.assigneeId, task.creatorId])].filter((x): x is string => !!x && x !== meId),
    );
    setError(null);
  }, [open, task.assigneeId, task.creatorId, meId]);

  const byId = new Map(people.map((p) => [p.id, p]));
  const addable: SelectOption<string>[] = people
    .filter((p) => p.id !== meId && !who.includes(p.id))
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
    .map((p) => ({
      value: p.id,
      label: userLabel(p),
      lead: <Avatar user={p} px={22} decorative />,
    }));

  async function book() {
    const at =
      when === 'now'
        ? 'now'
        : when === 'pick'
          ? partsToIso(day ?? '', time, 14)
          : whenAt(when)!.toISOString();
    if (!at) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.scheduleTaskCall(task.id, { when: at, minutes, participantIds: who });
      setOpen(false);
      const join = r.event.connect?.joinUrl;
      toast(
        r.booked
          ? {
              message:
                when === 'now'
                  ? 'Ringing them in Connect now.'
                  : 'Call booked in Connect. It rings everyone at its time.',
              tone: 'success',
              ...(join && {
                action: { label: 'Open', run: () => window.open(join, '_blank', 'noopener') },
              }),
            }
          : {
              message: `Saved as a meeting on the calendar, not a Connect call: ${
                r.reason ?? 'Connect couldn’t book it'
              }.`,
              tone: 'error',
            },
      );
      onBooked?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not book the call.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Phone size={15} aria-hidden="true" /> Call
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => !busy && setOpen(false)}
        minWidth={500}
        matchWidth={false}
        closeOnTab={false}
        className="hb-quicktask hb-callpop"
        label="Schedule a call"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void book();
          }}
        >
          <span className="hb-quicktask-title">Call about this task</span>
          <Segmented
            small
            label="When"
            value={when}
            options={[
              { value: 'now', label: 'Now' },
              { value: 'in15', label: 'In 15 min' },
              { value: 'in60', label: 'In 1 hour' },
              { value: 'tomorrow', label: 'Tomorrow 9:00' },
              { value: 'pick', label: 'Pick…' },
            ]}
            onChange={setWhen}
          />
          {when === 'pick' && (
            <DatePicker
              variant="field"
              label="Day and time"
              value={day}
              onChange={setDay}
              time={time}
              onTimeChange={setTime}
              allowClear={false}
            />
          )}
          {when !== 'now' && (
            <Segmented
              small
              label="How long"
              value={String(minutes)}
              options={CALL_LENGTHS.map((m) => ({ value: String(m), label: `${m} min` }))}
              onChange={(v) => setMinutes(Number(v))}
            />
          )}
          <div>
            <span className="hb-tpl-flabel">Who</span>
            <div className="hb-ev-people">
              {who.map((id) => {
                const p = byId.get(id);
                return (
                  <span key={id} className="hb-ev-person">
                    {p && <Avatar user={p} px={22} decorative />}
                    {p ? userLabel(p) : '…'}
                    <button
                      type="button"
                      className="rel-x"
                      aria-label={`Remove ${p ? userLabel(p) : 'them'}`}
                      onClick={() => setWho((w) => w.filter((x) => x !== id))}
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
              onChange={(id) => id && setWho((w) => [...w, id])}
            />
          </div>
          {error && (
            <p className="hb-quicktask-error" role="alert">
              {error}
            </p>
          )}
          <div className="hb-quicktask-foot">
            <span className="hb-small">You host it, in Connect.</span>
            <span className="hb-grow" />
            <Btn onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Btn>
            <Btn kind="primary" type="submit" disabled={busy || who.length === 0}>
              {busy ? 'Booking…' : when === 'now' ? 'Ring now' : 'Book call'}
            </Btn>
          </div>
        </form>
      </Popover>
    </>
  );
}
