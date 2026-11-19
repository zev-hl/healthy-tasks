import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  MAX_PAGE_SIZE,
  type CalendarDto,
  type CalendarScope,
  type EventDto,
  type GhostOccurrenceDto,
  type GoogleEventDto,
  type TaskRowDto,
  type TaskSearchFilters,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TaskCalendar, type CalendarScale } from '../components/TaskCalendar';
import { EventPanel, type NewEventSeed } from '../components/calendar/EventPanel';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Btn, Segmented, cx } from '../components/harbor/ui';
import { useToast } from '../components/harbor/Toast';
import {
  EVENT_COLORS,
  GOOGLE_COLOR,
  LAYER_LABELS,
  REMINDER_COLOR,
  type CalendarLayer,
} from '../lib/calendarKinds';
import { nowContext } from '../lib/taskSearch';

const LAYERS: CalendarLayer[] = ['tasks', 'events', 'reminders', 'google'];
const PREF_KEY = 'hb-calendar';

interface Saved {
  scope: CalendarScope;
  hidden: CalendarLayer[];
  scale: CalendarScale;
}
function readSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Saved>;
    return {
      scope: v.scope === 'team' ? 'team' : 'me',
      hidden: Array.isArray(v.hidden) ? v.hidden : [],
      scale: v.scale === 'week' || v.scale === 'day' ? v.scale : 'month',
    };
  } catch {
    return { scope: 'me', hidden: [], scale: 'month' };
  }
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** A New event opener the "+" menu and a task page can send here. */
export const NEW_EVENT_PARAM = 'new';

/**
 * One calendar (Nov 2026 plan, H3, H4): task due dates, the reader's
 * reminders, events, and their own Google Calendar (read-only), each kind its
 * own colour, with Me / Team. "New event" from here (or a click on an empty
 * spot of a day), from a task, or from the "+ New" menu (H4a).
 */
export function CalendarPage() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const saved = useRef(readSaved());
  const [scope, setScope] = useState<CalendarScope>(() => {
    const p = params.get('scope');
    return p === 'team' || p === 'me' ? p : saved.current.scope;
  });
  const [hidden, setHidden] = useState<Set<CalendarLayer>>(new Set(saved.current.hidden));
  const [scale, setScale] = useState<CalendarScale>(saved.current.scale);
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null);
  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [ghosts, setGhosts] = useState<GhostOccurrenceDto[]>([]);
  const [cal, setCal] = useState<CalendarDto>({ events: [], reminders: [] });
  const [google, setGoogle] = useState<{
    events: GoogleEventDto[];
    problem: string | null;
    connected: boolean;
  }>({
    events: [],
    problem: null,
    connected: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ event: EventDto | null; seed?: NewEventSeed } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ scope, hidden: [...hidden], scale }));
    } catch {
      /* not remembered */
    }
  }, [scope, hidden, scale]);

  // ?new=1[&task=12&taskName=…] opens New event; ?event=<id> opens one.
  useEffect(() => {
    const eventId = params.get('event');
    if (params.get('scope')) setParams({}, { replace: true });
    if (params.get(NEW_EVENT_PARAM)) {
      const taskId = Number(params.get('task'));
      setPanel({
        event: null,
        seed: taskId
          ? { task: { id: taskId, name: params.get('taskName') ?? `Task #${taskId}` } }
          : {},
      });
      setParams({}, { replace: true });
    } else if (eventId) {
      api
        .getEvent(eventId)
        .then((e) => setPanel({ event: e }))
        .catch((e) =>
          toast({ message: errorText(e, 'That event can’t be opened.'), tone: 'error' }),
        );
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const load = useCallback(async () => {
    if (!range || !me) return;
    setLoading(true);
    const from = range.from.toISOString();
    const to = range.to.toISOString();
    const base: TaskSearchFilters = {
      dueFrom: from,
      dueTo: to,
      includeNoDue: false,
      includeNoStart: true,
    };
    const taskQuery = (filters: TaskSearchFilters) =>
      api.queryTasks({
        filters,
        page: 1,
        pageSize: MAX_PAGE_SIZE,
        includeReadOnly: true,
        ...nowContext(),
      });
    try {
      const [mine, team, calendar, g] = await Promise.all([
        taskQuery({ ...base, assigneeIds: [me] }),
        scope === 'team' ? taskQuery({ ...base, myTeam: true }) : Promise.resolve(null),
        api.getCalendar(from, to, scope),
        api
          .listGoogleEvents(from, to)
          .catch(() => ({ connected: false, events: [], problem: null })),
      ]);
      const all = new Map<number, TaskRowDto>();
      for (const r of [...mine.rows, ...(team?.rows ?? [])]) all.set(r.id, r);
      setRows([...all.values()]);
      setCal(calendar);
      setGoogle(g);
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Could not load the calendar.'));
    } finally {
      setLoading(false);
    }
  }, [range, scope, me]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api
      .getTaskGhosts()
      .then(setGhosts)
      .catch(() => setGhosts([]));
  }, []);

  const show = (l: CalendarLayer) => !hidden.has(l);
  const toggle = (l: CalendarLayer) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });

  const layerColor: Record<CalendarLayer, string> = {
    tasks: 'var(--accent)',
    events: EVENT_COLORS.meeting,
    reminders: REMINDER_COLOR,
    google: GOOGLE_COLOR,
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Due dates, reminders and events in one place."
        actions={
          <Btn kind="primary" onClick={() => setPanel({ event: null, seed: {} })}>
            <Plus size={16} aria-hidden="true" /> New event
          </Btn>
        }
        newTask={false}
      />
      <PageBody>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <div className="hb-cal-bar">
          <Segmented
            small
            label="Whose calendar"
            value={scope}
            options={[
              { value: 'me', label: 'Me' },
              { value: 'team', label: 'Team' },
            ]}
            onChange={setScope}
          />
          <div className="hb-cal-layers" role="group" aria-label="Show on the calendar">
            {LAYERS.map((l) => (
              <button
                key={l}
                type="button"
                className={cx('hb-cal-layer', show(l) && 'is-on')}
                aria-pressed={show(l)}
                onClick={() => toggle(l)}
                title={
                  l === 'google' && !google.connected
                    ? 'Connect your Google Calendar from your profile'
                    : l === 'reminders'
                      ? 'Only you see your reminders'
                      : undefined
                }
              >
                <span className="hb-dot" style={{ background: layerColor[l] }} aria-hidden="true" />
                {LAYER_LABELS[l]}
              </button>
            ))}
          </div>
          {google.problem && show('google') && (
            <span className="hb-small hb-cal-gproblem">
              {google.problem}{' '}
              <Btn kind="link" onClick={() => navigate('/profile#google-calendar')}>
                Open your profile
              </Btn>
            </span>
          )}
        </div>
        <div className={cx('hb-cal-cols', panel && 'has-panel')}>
          <div className="hb-cal-main">
            <TaskCalendar
              rows={show('tasks') ? rows : []}
              ghosts={show('tasks') ? ghosts : []}
              loading={loading}
              scale={scale}
              onScaleChange={setScale}
              events={show('events') ? cal.events : []}
              reminders={show('reminders') ? cal.reminders : []}
              google={show('google') ? google.events : []}
              onOpenEvent={(e) => setPanel({ event: e })}
              onNewEvent={(day) => setPanel({ event: null, seed: { day } })}
              onRangeChange={setRange}
              onChanged={() => void load()}
            />
          </div>
          {panel && (
            <aside className="hb-cal-side">
              <EventPanel
                key={
                  panel.event?.id ??
                  `new-${panel.seed?.day?.getTime() ?? ''}-${panel.seed?.task?.id ?? ''}`
                }
                event={panel.event}
                seed={panel.seed}
                onClose={() => setPanel(null)}
                onSaved={(e) => {
                  setPanel({ event: e });
                  toast({ message: `Saved “${e.title}”.`, tone: 'success' });
                  void load();
                }}
                onCanceled={() => {
                  setPanel(null);
                  toast({ message: 'Event canceled.', tone: 'dark' });
                  void load();
                }}
              />
            </aside>
          )}
        </div>
      </PageBody>
    </>
  );
}
