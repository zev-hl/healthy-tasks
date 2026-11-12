import { useState } from 'react';
import { AtSign, Bell, BellRing, ChevronDown, UserPlus } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { Card, CountBadge, Empty, cx } from '../../components/harbor/ui';
import { whenLabel, type FeedItem } from '../../components/harbor/notificationFeed';

type Tab = 'all' | FeedItem['list'];

const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mentioned', label: 'Mentions' },
  { value: 'reminders', label: 'Reminders' },
  { value: 'assigned', label: 'Assigned' },
];

const FOLD_KEY = 'hb-alerts-folded';
const SHOWN = 6;

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The Dashboard's Alerts (meeting decision, Nov 11): one section for what
 * calls for you — mentions, reminders and tasks assigned to you — with a tab
 * for each and their unread counts. It folds away to keep the page clean; that
 * is remembered in this browser. Snoozed tasks join it once snooze exists.
 */
export function AlertsCard({
  feed,
  onOpen,
}: {
  feed: FeedItem[] | null;
  onOpen: (item: FeedItem) => void;
}) {
  const [tab, setTab] = useState<Tab>('all');
  const [folded, setFolded] = useState(readFolded);

  function toggle() {
    setFolded((f) => {
      try {
        localStorage.setItem(FOLD_KEY, f ? '0' : '1');
      } catch {
        // Private mode: the fold just isn't remembered.
      }
      return !f;
    });
  }

  const unread = (t: Tab) =>
    (feed ?? []).filter((f) => !f.read && (t === 'all' || f.list === t)).length;
  const shown = (feed ?? []).filter((f) => tab === 'all' || f.list === tab).slice(0, SHOWN);
  const total = unread('all');

  return (
    <Card className={cx('hb-alerts', folded && 'is-folded')}>
      <button
        type="button"
        className="hb-card-head hb-alerts-head"
        aria-expanded={!folded}
        onClick={toggle}
      >
        <span className="hb-ic tone-blue">
          <Bell size={16} aria-hidden="true" />
        </span>
        <h3>Alerts</h3>
        {total > 0 && <span className="hb-small">{total} unread</span>}
        <ChevronDown size={16} aria-hidden="true" className="hb-alerts-caret" />
      </button>
      {!folded && (
        <>
          <div className="hb-alerts-tabs" role="tablist" aria-label="Kinds of alert">
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                className={cx('hb-alerts-tab', tab === t.value && 'is-on')}
                onClick={() => setTab(t.value)}
              >
                {t.label}
                {unread(t.value) > 0 && <CountBadge n={unread(t.value)} red />}
              </button>
            ))}
          </div>
          {feed === null && <Empty>Loading…</Empty>}
          {feed !== null && shown.length === 0 && (
            <Empty>
              {tab === 'all'
                ? 'You are all caught up.'
                : `No ${TABS.find((t) => t.value === tab)!.label.toLowerCase()} right now.`}
            </Empty>
          )}
          {shown.map((it) => (
            <button
              key={it.key}
              type="button"
              className={cx('hb-row', 'hb-row-btn', 'hov', !it.read && 'unread')}
              onClick={() => onOpen(it)}
            >
              {it.who ? (
                <Avatar user={it.who} px={28} decorative />
              ) : (
                <span className="hb-av-ph">
                  {it.list === 'reminders' ? <BellRing size={14} /> : <Bell size={14} />}
                </span>
              )}
              <span className="hb-stack">
                <span className="hb-sub">
                  {it.list === 'mentioned' && <AtSign size={12} aria-hidden="true" />}
                  {it.list === 'assigned' && <UserPlus size={12} aria-hidden="true" />} {it.text}
                </span>
                <span className="hb-name">{it.taskName}</span>
              </span>
              <span className="hb-small">{whenLabel(it.at)}</span>
            </button>
          ))}
        </>
      )}
    </Card>
  );
}
