import { useRef, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import type { TaskDetailDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Popover } from './harbor/Popover';
import { Btn } from './harbor/ui';
import { useToast } from './harbor/Toast';
import { userLabel } from './ui/Avatar';

/**
 * Request update (Nov 2026 plan, E3): ask the assignee how it's going, with a
 * note. They get it by their settings (in the app, email); it's logged on the
 * task, and can be asked again after 5 minutes.
 */
export function RequestUpdateButton({
  task,
  onSent,
}: {
  task: TaskDetailDto;
  onSent?: () => void;
}) {
  const toast = useToast();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = task.assignee ? userLabel(task.assignee) : '';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.requestUpdate(task.id, note.trim() || null);
      setOpen(false);
      setNote('');
      toast({ message: `Asked ${who} for an update.`, tone: 'success' });
      onSent?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send it');
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
        <MessageCircleQuestion size={15} aria-hidden="true" /> Request update
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => !busy && setOpen(false)}
        minWidth={320}
        matchWidth={false}
        closeOnTab={false}
        label="Request update"
        className="hb-quicktask"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="hb-quicktask-head">
            <span className="hb-quicktask-title">Ask {who} for an update</span>
            <span className="hb-quicktask-hint">
              They get it in their alerts (and email, if they chose).
            </span>
          </div>
          <textarea
            className="hb-sublines"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A note (optional): what you need to know"
            aria-label="Note for the update request"
          />
          {error && (
            <p className="hb-quicktask-error" role="alert">
              {error}
            </p>
          )}
          <div className="hb-quicktask-foot">
            <span className="hb-grow" />
            <Btn onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Btn>
            <Btn kind="primary" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </Btn>
          </div>
        </form>
      </Popover>
    </>
  );
}
