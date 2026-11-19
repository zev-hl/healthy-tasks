import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import { EVENT_KIND_LABELS, type EventDto } from '@healthy-tasks/shared';
import { api } from '../../api/client';
import { EVENT_COLORS } from '../../lib/calendarKinds';

function when(e: EventDto): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (e.allDay)
    return new Date(e.startAt).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
  return new Date(e.startAt).toLocaleString(undefined, {
    ...opts,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A task's coming events (Nov 2026 plan, H4a), and "New event" for it: it opens
 * on the Calendar page with the task already linked.
 */
export function TaskEvents({ taskId, taskName }: { taskId: number; taskName: string }) {
  const [events, setEvents] = useState<EventDto[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .listTaskEvents(taskId)
      .then((e) => alive && setEvents(Array.isArray(e) ? e : []))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [taskId]);
  const newLink = `/calendar?new=1&task=${taskId}&taskName=${encodeURIComponent(taskName)}`;
  return (
    <div className="hb-task-events">
      {events && events.length > 0 && (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <span
                className="hb-dot"
                style={{ background: EVENT_COLORS[e.kind] }}
                aria-hidden="true"
              />
              <Link to={`/calendar?event=${e.id}`}>{e.title}</Link>
              <span className="hb-small">
                {EVENT_KIND_LABELS[e.kind]} · {when(e)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {events && events.length === 0 && <p className="hb-small">No events for this task yet.</p>}
      <Link to={newLink} className="hb-btn hb-btn-sm">
        <CalendarPlus size={14} aria-hidden="true" /> New event
      </Link>
    </div>
  );
}
