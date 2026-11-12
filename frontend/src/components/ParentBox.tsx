import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CornerLeftUp, Lock } from 'lucide-react';
import type { TaskDetailDto, TaskRef } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { userLabel } from './ui/Avatar';
import { PriorityMark, StatusPill, cx } from './harbor/ui';
import { dueInfo } from './harbor/taskHelpers';

/** The text of some HTML. DOMParser's document is inert: nothing in it loads or runs. */
function plain(html: string | null): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * On a sub-task's page, a read-only box with its parent's main facts (meeting
 * decision, Nov 11), so whoever does the sub-task sees the bigger picture: the
 * parent's due date, priority, status, owner and description, with a link.
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
  const desc = detail ? plain(detail.description) : '';

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
          </>
        )}
      </div>
      {desc && <p className="hb-parentbox-desc">{desc}</p>}
    </section>
  );
}
