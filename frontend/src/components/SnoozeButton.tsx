import { useRef, useState } from 'react';
import { BellOff } from 'lucide-react';
import { SNOOZE_MAX_DAYS, type TaskDetailDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Popover } from './harbor/Popover';
import { DatePicker, toYmd } from './harbor/DatePicker';
import { Btn } from './harbor/ui';
import { useToast } from './harbor/Toast';

/** At 9:00 on the day `days` from today. */
function morning(days: number, now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

export const SNOOZE_PRESETS: { label: string; at: (now?: Date) => Date }[] = [
  { label: 'Tomorrow', at: (n) => morning(1, n) },
  { label: 'In 3 days', at: (n) => morning(3, n) },
  { label: 'Next week', at: (n) => morning(7, n) },
  { label: 'In 2 weeks', at: (n) => morning(14, n) },
];

export function snoozeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Snooze (Nov 2026 plan, E1): park a task for up to 30 days. It leaves the
 * active lists and comes back by itself as a reminder in Alerts; the due date
 * stays as it is. For the assignee, the creator or someone above them.
 */
export function SnoozeButton({
  task,
  onChanged,
}: {
  task: TaskDetailDto;
  onChanged: (t: TaskDetailDto) => void;
}) {
  const toast = useToast();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const max = new Date(Date.now() + SNOOZE_MAX_DAYS * 86_400_000);

  async function snooze(at: Date) {
    setBusy(true);
    try {
      const t = await api.snoozeTask(task.id, at.toISOString());
      onChanged(t);
      setOpen(false);
      toast({
        message: `Snoozed until ${snoozeLabel(at.toISOString())}. It comes back as a reminder.`,
        tone: 'success',
        undo: async () => onChanged(await api.unsnoozeTask(task.id)),
      });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : 'Could not snooze it',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function wake() {
    setBusy(true);
    try {
      onChanged(await api.unsnoozeTask(task.id));
      setOpen(false);
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : 'Could not bring it back',
        tone: 'error',
      });
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
        <BellOff size={15} aria-hidden="true" /> {task.snoozedUntil ? 'Snoozed' : 'Snooze'}
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => !busy && setOpen(false)}
        minWidth={260}
        matchWidth={false}
        closeOnTab={false}
        label="Snooze"
        className="hb-snooze-pop"
      >
        {task.snoozedUntil && (
          <div className="hb-snooze-now">
            <span>Snoozed until {snoozeLabel(task.snoozedUntil)}</span>
            <Btn kind="link" disabled={busy} onClick={() => void wake()}>
              Bring it back now
            </Btn>
          </div>
        )}
        <div className="hb-actions-menu">
          {SNOOZE_PRESETS.map((p) => (
            <button key={p.label} type="button" disabled={busy} onClick={() => void snooze(p.at())}>
              {p.label}
              <span className="hb-actions-why">{snoozeLabel(p.at().toISOString())}</span>
            </button>
          ))}
        </div>
        <div className="hb-snooze-pick">
          <DatePicker
            variant="field"
            label="Snooze until"
            placeholder={`Pick a day (up to ${SNOOZE_MAX_DAYS} days)`}
            value={day}
            onChange={setDay}
          />
          <Btn
            kind="primary"
            disabled={busy || !day || new Date(`${day}T09:00`) > max || day <= toYmd(new Date())}
            onClick={() => day && void snooze(new Date(`${day}T09:00`))}
          >
            Snooze
          </Btn>
        </div>
        <p className="hb-small">
          It comes back by itself as a reminder. The due date stays as it is.
        </p>
      </Popover>
    </>
  );
}
