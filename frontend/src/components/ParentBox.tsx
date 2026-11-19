import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CornerLeftUp, Lock, MessageSquare } from 'lucide-react';
import type { TaskDetailDto, TaskRef } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { userLabel } from './ui/Avatar';
import { PriorityMark, StatusPill, cx } from './harbor/ui';
import { dueInfo } from './harbor/taskHelpers';

/**
 * On a sub-task's page, a read-only box with its parent's main facts (Nov 2026
 * plan, F2), so whoever does the sub-task sees the bigger picture: the parent's
 * title, status, assignee, due date and priority, how many comments it has and,
 * in red, how many of them mention you unread. No description.
 */
export function ParentBox({ parent }: { parent: TaskRef }) {
  const [detail, setDetail] = useState<TaskDetailDto | null>(null);

  useEffect(() => {
    if (!parent.accessible) return;
    let alive = true;
    api
      .getTask(parent.id)
      .then((t) => alive && setDetail(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [parent.id, parent.accessible]);

  if (!parent.accessible) {
    return (
      <section className="hb-card hb-parentbox" aria-label="Parent task">
        <div className="hb-parentbox-head">
          <CornerLeftUp size={14} aria-hidden="true" /> Sub-task of
          <span className="hb-parentbox-locked">
            <Lock size={12} aria-hidden="true" /> #{parent.id}, which you can’t open
          </span>
        </div>
      </section>
    );
  }

  const due = detail ? dueInfo(detail.dueAt, detail.status) : null;

  return (
    <section className="hb-card hb-parentbox" aria-label="Parent task">
      <div className="hb-parentbox-head">
        <CornerLeftUp size={14} aria-hidden="true" /> Sub-task of
      </div>
      <Link to={`/tasks/${parent.id}`} className="hb-parentbox-name">
        #{parent.id} {parent.name}
      </Link>
      <div className="hb-parentbox-facts">
        <StatusPill status={detail?.status ?? parent.status} />
        {detail && (
          <>
            <span className={cx('hb-parentbox-due', due?.late && 'is-late')}>
              {due ? `Due ${due.text}` : 'No due date'}
            </span>
            <PriorityMark priority={detail.priority} />
            <span className="hb-parentbox-who">
              {detail.assignee ? userLabel(detail.assignee) : 'Unassigned'}
            </span>
            <Link
              to={`/tasks/${parent.id}`}
              className="hb-parentbox-comments"
              title={
                detail.unreadMentions > 0
                  ? `${detail.unreadMentions} unread mention${detail.unreadMentions === 1 ? '' : 's'} of you`
                  : undefined
              }
            >
              <MessageSquare size={13} aria-hidden="true" />
              {detail.comments.length} comment{detail.comments.length === 1 ? '' : 's'}
              {detail.unreadMentions > 0 && (
                <span
                  className="hb-parentbox-unread"
                  aria-label={`${detail.unreadMentions} unread mention${detail.unreadMentions === 1 ? '' : 's'}`}
                >
                  {detail.unreadMentions}
                </span>
              )}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
