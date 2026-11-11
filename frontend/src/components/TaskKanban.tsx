import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, Lock } from 'lucide-react';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  dutyLabel,
  type TaskRowDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, UnassignedAvatar, userLabel } from './ui/Avatar';
import { CountBadge, PriorityMark, STATUS_DOT, cx } from './harbor/ui';
import { dueInfo } from './harbor/taskHelpers';
import { useToast } from './harbor/Toast';
import { ReviewerPicker } from './ReviewerPicker';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  /** Re-run the search after a successful status change so every view stays in sync. */
  onChanged: () => void;
}

const FOLD_KEY = 'hb-board-folded';
/** Canceled starts folded: it's rarely a place work moves to. */
const DEFAULT_FOLDED: TaskStatus[] = ['Canceled'];

function readFolded(): TaskStatus[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? 'null') as TaskStatus[] | null;
    return Array.isArray(v) ? v : DEFAULT_FOLDED;
  } catch {
    return DEFAULT_FOLDED;
  }
}

/**
 * The Board (Phase 10, Harbor redesign). Six columns in Status order; one card
 * per task (sub-tasks get their own card — Status is per-task). Dragging a card
 * to another column changes its Status through the same update the List and
 * task page use, so the blocked-status rule and the Review workflow apply the
 * same way:
 *  - a refused move (e.g. "blocked by #X") snaps back with the reason in a toast,
 *  - dropping on Review opens the reviewer menu under the card,
 *  - cards in Review are locked: they leave it only from the task page,
 *  - read-only cards (mentioned, or seen through the task tree) can't be moved.
 * Every other move says what happened in a toast with Undo, and the card flashes.
 * A column can be folded to a narrow strip (still a drop target); the choice is
 * remembered in this browser.
 */
export function TaskKanban({ rows, loading, onChanged }: Props) {
  const toast = useToast();
  const [cards, setCards] = useState<TaskRowDto[]>(rows);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [pendingReview, setPendingReview] = useState<TaskRowDto | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [folded, setFolded] = useState<TaskStatus[]>(readFolded);
  const reviewAnchor = useRef<HTMLElement | null>(null);
  // The dragged card, also kept outside state so a drop never reads a stale value.
  const dragRef = useRef<number | null>(null);

  useEffect(() => setCards(rows), [rows]);

  function toggleFold(s: TaskStatus) {
    setFolded((f) => {
      const next = f.includes(s) ? f.filter((x) => x !== s) : [...f, s];
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the fold just isn't remembered.
      }
      return next;
    });
  }

  async function commitStatus(
    task: TaskRowDto,
    status: TaskStatus,
    opts: { reviewerId?: string; undoable?: boolean } = {},
  ) {
    const from = task.status;
    // Optimistic move; the refetch (onChanged) reconciles with the server truth.
    setCards((cs) => cs.map((c) => (c.id === task.id ? { ...c, status } : c)));
    try {
      await api.updateTask(task.id, {
        status,
        ...(opts.reviewerId ? { reviewerId: opts.reviewerId } : {}),
      });
      onChanged();
      setFlash(task.id);
      window.setTimeout(() => setFlash((f) => (f === task.id ? null : f)), 1600);
      toast({
        message: `“${task.name}” moved to ${TASK_STATUS_LABELS[status]}.`,
        undo:
          opts.undoable === false
            ? undefined
            : () => void commitStatus({ ...task, status }, from, { undoable: false }),
      });
    } catch (err) {
      setCards((cs) => cs.map((c) => (c.id === task.id ? { ...c, status: from } : c)));
      toast({
        message: `“${task.name}” stayed in ${TASK_STATUS_LABELS[from]}: ${
          err instanceof ApiError ? err.message : 'the status could not be changed'
        }`,
        tone: 'error',
      });
    }
  }

  function onDrop(status: TaskStatus) {
    const id = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setOverCol(null);
    if (id == null) return;
    const task = cards.find((c) => c.id === id);
    if (!task || task.status === status) return;
    if (status === 'Review') {
      // Choose a reviewer first; the commit happens on confirm. The menu opens
      // under the dropped card.
      reviewAnchor.current = document.querySelector<HTMLElement>(
        `.hb-bcard[data-task-id="${task.id}"]`,
      );
      reviewAnchor.current?.scrollIntoView({ block: 'nearest' });
      setPendingReview(task);
      return;
    }
    void commitStatus(task, status);
  }

  const dragging = dragId != null;

  return (
    <div className={cx('hb-board', dragging && 'is-dragging')}>
      {TASK_STATUSES.map((status) => {
        const column = cards.filter((c) => c.status === status);
        const isFolded = folded.includes(status);
        const label = TASK_STATUS_LABELS[status];
        const dropProps = {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            if (overCol !== status) setOverCol(status);
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setOverCol((c) => (c === status ? null : c));
            }
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            onDrop(status);
          },
        };

        if (isFolded) {
          return (
            <section
              key={status}
              className={cx('hb-bcol is-folded', overCol === status && 'is-over')}
              aria-label={`${label}, ${column.length} tasks, folded`}
              {...dropProps}
            >
              <button
                type="button"
                className="hb-bcol-unfold"
                onClick={() => toggleFold(status)}
                title={`Show ${label}`}
                aria-label={`Show ${label}`}
              >
                <ChevronRight size={14} aria-hidden="true" />
                <span className="hb-dot" style={{ background: STATUS_DOT[status] }} />
                <span className="hb-bcol-vlabel">{label}</span>
                <CountBadge n={column.length} />
              </button>
            </section>
          );
        }

        return (
          <section
            key={status}
            className={cx('hb-bcol', overCol === status && 'is-over')}
            aria-label={`${label}, ${column.length} tasks`}
            {...dropProps}
          >
            <header className="hb-bcol-head">
              <span className="hb-dot" style={{ background: STATUS_DOT[status] }} />
              <h3>{label}</h3>
              <CountBadge n={column.length} />
              <button
                type="button"
                className="hb-bcol-fold"
                onClick={() => toggleFold(status)}
                title={`Fold ${label}`}
                aria-label={`Fold ${label}`}
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
            </header>
            <div className="hb-bcol-body">
              {column.map((task) => {
                const inReview = task.status === 'Review';
                // Read-only tasks (mention-only or tree-inherited) can't change
                // Status, so they don't drag; commenting still works.
                const readOnly = task.mentionOnly || task.treeOnly;
                const locked = inReview || readOnly;
                const due = dueInfo(task.dueAt, task.status);
                const done = task.status === 'Completed' || task.status === 'Canceled';
                return (
                  <article
                    key={task.id}
                    data-task-id={task.id}
                    className={cx(
                      'hb-bcard',
                      locked && 'is-locked',
                      dragId === task.id && 'is-dragging',
                      flash === task.id && 'is-flash',
                      done && 'is-done',
                    )}
                    draggable={!locked}
                    onDragStart={(e) => {
                      if (locked) return;
                      dragRef.current = task.id;
                      setDragId(task.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(task.id));
                    }}
                    onDragEnd={() => {
                      dragRef.current = null;
                      setDragId(null);
                      setOverCol(null);
                    }}
                  >
                    <Link to={`/tasks/${task.id}`} className="hb-bcard-title">
                      {task.name}
                    </Link>
                    <span className="hb-bcard-sub">
                      #{task.id}
                      {task.duty && <> · {dutyLabel(task.duty)}</>}
                      {task.childrenCount > 0 && (
                        <>
                          {' '}
                          · {task.childrenCount} sub-task{task.childrenCount === 1 ? '' : 's'}
                        </>
                      )}
                    </span>
                    {task.tags.length > 0 && (
                      <span className="hb-bcard-tags">
                        {task.tags.slice(0, 2).map((t) => (
                          <span key={t} className="hb-tag">
                            {t}
                          </span>
                        ))}
                        {task.tags.length > 2 && (
                          <span className="hb-tag" title={task.tags.slice(2).join(', ')}>
                            +{task.tags.length - 2}
                          </span>
                        )}
                      </span>
                    )}
                    <div className="hb-bcard-foot">
                      {due ? (
                        <span className={cx('hb-bcard-due', due.late && 'is-late')}>
                          {due.text}
                        </span>
                      ) : (
                        <span className="hb-bcard-due is-none">No due date</span>
                      )}
                      {(task.priority === 'High' || task.priority === 'Urgent') && !done && (
                        <PriorityMark priority={task.priority} />
                      )}
                      {inReview && (
                        <span className="hb-bcard-flag" title="Locked while in review">
                          <Lock size={12} aria-hidden="true" /> In review
                        </span>
                      )}
                      {!inReview && readOnly && (
                        <span
                          className="hb-bcard-flag"
                          title={
                            task.treeOnly && !task.mentionOnly
                              ? 'Read-only: you see it through its parent or sub-task'
                              : 'Read-only: you see it because you were mentioned'
                          }
                        >
                          <Eye size={12} aria-hidden="true" /> View only
                        </span>
                      )}
                      <span
                        className="hb-bcard-who"
                        title={task.assignee ? userLabel(task.assignee) : 'Unassigned'}
                      >
                        {task.assignee ? (
                          <Avatar user={task.assignee} px={24} decorative />
                        ) : (
                          <UnassignedAvatar size="xs" />
                        )}
                      </span>
                    </div>
                  </article>
                );
              })}
              {column.length === 0 && (
                <div className="hb-bcol-empty">{loading ? 'Loading…' : 'None in this view'}</div>
              )}
              {dragging && column.length > 0 && <div className="hb-bcol-drop">Drop here</div>}
            </div>
          </section>
        );
      })}

      {pendingReview && (
        <ReviewerPicker
          anchorRef={reviewAnchor}
          taskId={pendingReview.id}
          taskRef={`#${pendingReview.id}`}
          taskName={pendingReview.name}
          currentAssignee={pendingReview.assignee ? userLabel(pendingReview.assignee) : null}
          returnStatus={TASK_STATUS_LABELS[pendingReview.status]}
          onClose={() => setPendingReview(null)}
          onPick={async (reviewerId) => {
            const task = pendingReview;
            setPendingReview(null);
            await commitStatus(task, 'Review', { reviewerId, undoable: false });
          }}
        />
      )}
    </div>
  );
}
