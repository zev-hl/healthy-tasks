import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Lock, MessageSquare, Paperclip } from 'lucide-react';
import { dutyLabel, type TaskDetailDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { RichText } from '../RichText';
import { userLabel } from '../ui/Avatar';
import { StatusPill, cx } from './ui';

/**
 * Expand a task row in place (meeting decision, Nov 11): an arrow before the
 * name opens the task's description and the details people check before
 * opening it — who made it and when, start date, duty, tags, sub-tasks, what
 * it waits on, files and the latest comment — without leaving the page.
 */

/** Which rows are open. One list of rows keeps its own set. */
export function usePeek() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = useCallback(
    (id: number) =>
      setOpen((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  return { isOpen: (id: number) => open.has(id), toggle };
}

export function PeekToggle({
  open,
  onToggle,
  name,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  name: string;
  controls?: string;
}) {
  return (
    <button
      type="button"
      className={cx('hb-peek-btn', open && 'is-open')}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? 'Hide' : 'Show'} details of ${name}`}
      title={open ? 'Hide details' : 'Show details'}
      onClick={onToggle}
    >
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

// Tasks already opened this visit: re-opening a row shows them at once.
const cache = new Map<number, TaskDetailDto>();

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The text of some HTML. DOMParser's document is inert: nothing in it loads or runs. */
function plain(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function TaskPeek({ id, panelId }: { id: number; panelId?: string }) {
  const [task, setTask] = useState<TaskDetailDto | null>(cache.get(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const fallbackId = useId();

  useEffect(() => {
    let alive = true;
    api
      .getTask(id)
      .then((t) => {
        cache.set(id, t);
        if (alive) setTask(t);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load the details.');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const sectionId = panelId ?? fallbackId;
  if (error) {
    return (
      <div id={sectionId} className="hb-peek">
        <p className="hb-peek-none">{error}</p>
      </div>
    );
  }
  if (!task) {
    return (
      <div id={sectionId} className="hb-peek" aria-busy="true">
        <p className="hb-peek-none">Loading…</p>
      </div>
    );
  }

  const last = task.comments.length ? task.comments[task.comments.length - 1] : null;
  const desc = task.description && plain(task.description) ? task.description : null;

  return (
    <div id={sectionId} className="hb-peek">
      <div className="hb-peek-desc">
        <span className="hb-peek-k">
          <FileText size={13} aria-hidden="true" /> Description
        </span>
        {desc ? (
          <RichText html={desc} className="hb-peek-rich" />
        ) : (
          <p className="hb-peek-none">No description.</p>
        )}
      </div>

      <dl className="hb-peek-facts">
        <div>
          <dt>Created</dt>
          <dd>
            {day(task.createdAt)} by {userLabel(task.creator)}
          </dd>
        </div>
        <div>
          <dt>Starts</dt>
          <dd>{task.startAt ? day(task.startAt) : '—'}</dd>
        </div>
        <div>
          <dt>Duty</dt>
          <dd>{task.duty ? dutyLabel(task.duty) : '—'}</dd>
        </div>
        {task.tags.length > 0 && (
          <div>
            <dt>Tags</dt>
            <dd className="hb-peek-tags">
              {task.tags.map((t) => (
                <span key={t} className="hb-tag">
                  {t}
                </span>
              ))}
            </dd>
          </div>
        )}
        {task.isBlockedBy.length > 0 && (
          <div>
            <dt>Waiting on</dt>
            <dd className="hb-peek-list">
              {task.isBlockedBy.map((b) => (
                <span key={b.id}>
                  {b.accessible ? (
                    <Link to={`/tasks/${b.id}`}>
                      #{b.id} {b.name}
                    </Link>
                  ) : (
                    <>
                      <Lock size={11} aria-hidden="true" /> #{b.id}
                    </>
                  )}{' '}
                  <StatusPill status={b.status} />
                </span>
              ))}
            </dd>
          </div>
        )}
        {task.children.length > 0 && (
          <div>
            <dt>Sub-tasks</dt>
            <dd className="hb-peek-list">
              {task.children.slice(0, 5).map((c) => (
                <span key={c.id}>
                  {c.accessible ? (
                    <Link to={`/tasks/${c.id}`}>{c.name}</Link>
                  ) : (
                    <>
                      <Lock size={11} aria-hidden="true" /> #{c.id}
                    </>
                  )}{' '}
                  <StatusPill status={c.status} />
                </span>
              ))}
              {task.children.length > 5 && (
                <span className="hb-peek-more">and {task.children.length - 5} more</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      <div className="hb-peek-foot">
        <span className="hb-peek-meta">
          <Paperclip size={13} aria-hidden="true" />
          {task.attachments.length
            ? `${task.attachments.length} file${task.attachments.length === 1 ? '' : 's'}`
            : 'No files'}
        </span>
        <span className="hb-peek-meta hb-peek-comment">
          <MessageSquare size={13} aria-hidden="true" />
          {last ? (
            <>
              <strong>{userLabel(last.author)}</strong>: {plain(last.body).slice(0, 140)}
              {plain(last.body).length > 140 ? '…' : ''}
            </>
          ) : (
            'No comments yet'
          )}
        </span>
        <Link to={`/tasks/${task.id}`} className="hb-peek-open">
          Open task
        </Link>
      </div>
    </div>
  );
}

/**
 * A card row (`.hb-row`) with the expand arrow first and the details under it.
 * Each row keeps its own open state.
 */
export function PeekRow({
  id,
  name,
  className,
  children,
}: {
  id: number;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `peek-${id}-${useId().replace(/:/g, '')}`;
  return (
    <>
      <div className={cx('hb-row', 'has-peek', open && 'is-peek', className)}>
        <PeekToggle
          open={open}
          onToggle={() => setOpen((o) => !o)}
          name={name}
          controls={panelId}
        />
        {children}
      </div>
      {open && (
        <div className="hb-peek-under">
          <TaskPeek id={id} panelId={panelId} />
        </div>
      )}
    </>
  );
}
