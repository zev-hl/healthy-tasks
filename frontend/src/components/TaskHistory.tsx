import { useEffect, useState } from 'react';
import {
  TASK_HISTORY_FIELD_LABELS,
  TASK_STATUS_LABELS,
  type TaskHistoryEntryDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';
import { EmptyState } from './ui/EmptyState';

interface Props {
  taskId: number;
  /** Bumped by the parent after each mutation so the log refetches. */
  version: number;
}

function fieldLabel(field: string): string {
  return TASK_HISTORY_FIELD_LABELS[field] ?? field;
}

/** Format a stored `updated` value for display, per-field. */
function formatValue(field: string, value: string | null): string {
  if (value === null || value === '') {
    if (field === 'assignee') return 'Unassigned';
    if (field === 'startAt' || field === 'dueAt') return 'None';
    return '—';
  }
  if (field === 'status') return TASK_STATUS_LABELS[value as TaskStatus] ?? value;
  if (field === 'startAt' || field === 'dueAt') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
  return value;
}

/** Turn one entry into a human-readable sentence describing the change. */
function describe(entry: TaskHistoryEntryDto): string {
  const label = fieldLabel(entry.field);

  if (entry.field === 'comment') {
    if (entry.changeType === 'added') return 'Added a comment';
    if (entry.changeType === 'updated') return 'Edited a comment';
    return 'Deleted a comment';
  }

  if (entry.field === 'merge' && entry.changeType === 'updated') {
    return `Account merge: reassigned ${entry.previousValue ?? '—'} → ${entry.newValue ?? '—'}`;
  }

  if (entry.changeType === 'added') {
    return entry.detail ? `Added ${label.toLowerCase()}: ${entry.detail}` : `Added ${label.toLowerCase()}`;
  }
  if (entry.changeType === 'removed') {
    return entry.detail
      ? `Removed ${label.toLowerCase()}: ${entry.detail}`
      : `Removed ${label.toLowerCase()}`;
  }

  // updated
  if (entry.field === 'description') return 'Updated the description';
  const from = formatValue(entry.field, entry.previousValue);
  const to = formatValue(entry.field, entry.newValue);
  return `Changed ${label} from “${from}” to “${to}”`;
}

/**
 * The change-history log for a task (Phase 5). Shows who changed what and when,
 * most recent first. Visible to anyone who can see the task.
 */
export function TaskHistory({ taskId, version }: Props) {
  const [entries, setEntries] = useState<TaskHistoryEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getTaskHistory(taskId)
      .then((e) => {
        if (!cancelled) {
          setEntries(e);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, version]);

  if (loading && entries.length === 0)
    return (
      <span className="loading-inline">
        <span className="spinner" /> Loading history…
      </span>
    );
  if (error) return <div className="alert error">{error}</div>;
  if (entries.length === 0)
    return (
      <EmptyState compact title="No history yet">
        Changes to this task will show up here.
      </EmptyState>
    );

  return (
    <ul className="history-list">
      {entries.map((entry) => {
        const actor = entry.user ?? {};
        return (
          <li key={entry.id} className="history-entry">
            <Avatar user={actor} size="xs" decorative />
            <div className="history-body">
              <div className="history-what">{describe(entry)}</div>
              <div className="muted history-meta">
                {entry.user ? userLabel(entry.user) : 'Unknown user'} ·{' '}
                {new Date(entry.changedAt).toLocaleString()}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
