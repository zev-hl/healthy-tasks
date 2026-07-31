import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskRowDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, UnassignedAvatar, userLabel } from './ui/Avatar';
import { PriorityRamp, statusColor } from './ui/indicators';
import { DueDate } from './ui/dates';
import { ReviewerPickerModal } from './ReviewerPickerModal';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  /** Re-run the search after a successful status change so every view stays in sync. */
  onChanged: () => void;
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 3);
  const extra = tags.length - shown.length;
  return (
    <div className="tags-cell">
      {shown.map((t) => (
        <span key={t} className="badge tag">
          {t}
        </span>
      ))}
      {extra > 0 && (
        <span className="badge tag-more" title={tags.slice(3).join(', ')}>
          +{extra}
        </span>
      )}
    </div>
  );
}

/**
 * Kanban board (Phase 10). Six fixed columns in Status order; one card per task
 * (sub-tasks get their own card — Status is per-task). Dragging a card to another
 * column changes that task's Status through the same PATCH the List/Detail views
 * use, so the blocked-status rule and Review workflow apply identically:
 *  - dropping a blocked task on Review/Completed is rejected with the server's
 *    "blocked by #X" message (shown in place),
 *  - dropping on Review opens the reviewer picker,
 *  - cards already in Review are locked (not draggable) — they leave Review only
 *    via the Task Detail Reviewed / Recall buttons.
 */
export function TaskKanban({ rows, loading, onChanged }: Props) {
  const [cards, setCards] = useState<TaskRowDto[]>(rows);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<TaskRowDto | null>(null);

  useEffect(() => setCards(rows), [rows]);

  const byStatus = (status: TaskStatus): TaskRowDto[] => cards.filter((c) => c.status === status);

  async function commitStatus(task: TaskRowDto, status: TaskStatus, reviewerId?: string) {
    setError(null);
    // Optimistic move; the refetch (onChanged) reconciles with the server truth.
    setCards((cs) => cs.map((c) => (c.id === task.id ? { ...c, status } : c)));
    try {
      await api.updateTask(task.id, { status, ...(reviewerId ? { reviewerId } : {}) });
      onChanged();
    } catch (err) {
      // Revert and surface the reason (e.g. blocked by #X).
      setCards(rows);
      setError(err instanceof ApiError ? err.message : 'Could not update status');
    }
  }

  function onDrop(status: TaskStatus) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (id == null) return;
    const task = cards.find((c) => c.id === id);
    if (!task || task.status === status) return;
    if (status === 'Review') {
      // Choose a reviewer first; the commit happens on confirm.
      setPendingReview(task);
      return;
    }
    void commitStatus(task, status);
  }

  return (
    <div className="kanban-wrap">
      {error && <div className="alert error">{error}</div>}
      <div className="kanban-board">
        {TASK_STATUSES.map((status) => {
          const column = byStatus(status);
          return (
            <section
              key={status}
              className={`kanban-col${overCol === status ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== status) setOverCol(status);
              }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={() => onDrop(status)}
            >
              <header className="kanban-col-head">
                <span className="kanban-col-dot" style={{ background: statusColor(status) }} />
                <span className="kanban-col-title">{TASK_STATUS_LABELS[status]}</span>
                <span className="mono kanban-col-count">{column.length}</span>
              </header>
              <div className="kanban-col-body">
                {column.map((task) => {
                  const inReview = task.status === 'Review';
                  // Phase 13: mention-only tasks are read-only for Status/dates —
                  // not draggable — but commenting still works via Task Detail.
                  const readOnly = task.mentionOnly;
                  const locked = inReview || readOnly;
                  return (
                    <article
                      key={task.id}
                      className={`kanban-card${locked ? ' locked' : ''}${dragId === task.id ? ' dragging' : ''}`}
                      draggable={!locked}
                      onDragStart={(e) => {
                        if (locked) return;
                        setDragId(task.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(task.id));
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                    >
                      <div className="kanban-card-top">
                        <Link to={`/tasks/${task.id}`} className="mono task-id-link">
                          #{task.id}
                        </Link>
                        <PriorityRamp
                          priority={task.priority}
                          dimmed={task.status === 'Completed'}
                        />
                      </div>
                      <Link to={`/tasks/${task.id}`} className="kanban-card-title">
                        {task.name}
                      </Link>
                      <TagChips tags={task.tags} />
                      <div className="kanban-card-foot">
                        <DueDate iso={task.dueAt} inline />
                        {task.assignee ? (
                          <Avatar user={task.assignee} size="xs" />
                        ) : (
                          <UnassignedAvatar size="xs" />
                        )}
                      </div>
                      {inReview && (
                        <span className="kanban-lock" title="Locked while in Review">
                          🔒
                        </span>
                      )}
                      {readOnly && !inReview && (
                        <span
                          className="kanban-lock mention-only-cue"
                          title="Read-only — you can see this because you're mentioned"
                        >
                          👁
                        </span>
                      )}
                    </article>
                  );
                })}
                {column.length === 0 && (
                  <div className="kanban-col-empty">{loading ? '…' : 'Drop here'}</div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {pendingReview && (
        <ReviewerPickerModal
          taskId={pendingReview.id}
          taskRef={`#${pendingReview.id}`}
          taskName={pendingReview.name}
          currentAssignee={pendingReview.assignee ? userLabel(pendingReview.assignee) : null}
          returnStatus={TASK_STATUS_LABELS[pendingReview.status]}
          onClose={() => setPendingReview(null)}
          onPick={async (reviewerId) => {
            const task = pendingReview;
            setPendingReview(null);
            await commitStatus(task, 'Review', reviewerId);
          }}
        />
      )}
    </div>
  );
}
