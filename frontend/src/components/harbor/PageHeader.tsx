import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Plus, Search } from 'lucide-react';
import { api } from '../../api/client';
import { useNotifications } from '../../notifications/NotificationContext';
import { Popover } from './Popover';
import { markRead, toFeed, whenLabel, type FeedItem } from './notificationFeed';
import { Avatar } from '../ui/Avatar';
import { cx } from './ui';

/**
 * The white band at the top of every page (§4): title and one-line subtitle on
 * the left, a view switch beside them, then search, the primary New task button
 * and the notifications bell. `tabs` (underline tabs) sit in the same band.
 */
export function PageHeader({
  title,
  subtitle,
  switcher,
  actions,
  tabs,
  search = true,
  newTask = true,
  searchPlaceholder = 'Search tasks by title or #number',
  onSearch,
  searchValue,
  onSearchChange,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  switcher?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  search?: boolean;
  newTask?: boolean;
  searchPlaceholder?: string;
  /** Defaults to opening Tasks with the text. */
  onSearch?: (text: string) => void;
  /** Live search: the page owns the text (the Tasks list filters as you type). */
  searchValue?: string;
  onSearchChange?: (text: string) => void;
}) {
  const navigate = useNavigate();
  const [ownQ, setOwnQ] = useState('');
  const q = searchValue ?? ownQ;
  const setQ = onSearchChange ?? setOwnQ;
  return (
    <header className={cx('hb-top', !!tabs && 'has-tabs')}>
      <div className="hb-top-row">
        <div className="hb-title">
          <h1>{title}</h1>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {switcher}
        <div className="hb-grow" />
        {search && (
          <form
            className="hb-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const text = q.trim();
              if (onSearch) onSearch(text);
              else navigate('/tasks', { state: { text } });
            }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </form>
        )}
        {actions}
        {newTask && (
          <Link to="/tasks/new" className="hb-btn hb-btn-primary">
            <Plus size={18} aria-hidden="true" />
            New task
          </Link>
        )}
        <NotificationBellMenu />
      </div>
      {tabs && <div className="hb-tabs-row">{tabs}</div>}
    </header>
  );
}

/** The bell: a red dot when something is unread, and a popover of the latest. */
export function NotificationBellMenu() {
  const { unread, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const count = unread?.total ?? 0;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .getNotifications('all')
      .then((n) => alive && setItems(toFeed(n).slice(0, 12)))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [open]);

  async function openItem(it: FeedItem) {
    setOpen(false);
    if (!it.read) {
      await markRead(it).catch(() => {});
      refresh();
    }
    navigate(`/tasks/${it.taskId}`);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-icon-btn"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} aria-hidden="true" />
        {count > 0 && <span className="hb-bell-dot" aria-hidden="true" />}
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={360}
        matchWidth={false}
        className="hb-bell-pop"
        label="Notifications"
      >
        <div className="hb-bell-head">
          <strong>Notifications</strong>
          <span>{count > 0 ? `${count} unread` : 'All read'}</span>
        </div>
        {items === null && <p className="hb-bell-empty">Loading…</p>}
        {items?.length === 0 && <p className="hb-bell-empty">You are all caught up.</p>}
        {items && items.length > 0 && (
          <ul className="hb-bell-list">
            {items.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  className={cx('hb-bell-item', !it.read && 'unread')}
                  onClick={() => openItem(it)}
                >
                  {it.who ? (
                    <Avatar user={it.who} px={28} decorative />
                  ) : (
                    <span className="hb-av-ph" aria-hidden="true">
                      <Bell size={14} />
                    </span>
                  )}
                  <span className="hb-bell-text">
                    <span>
                      {it.text} · <strong>{it.taskName}</strong>
                    </span>
                    <span className="hb-small">{whenLabel(it.at)}</span>
                  </span>
                  {!it.read && <span className="hb-unread-dot" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}

/** Content area under the header: 20px 32px 40px, at most 1760px wide. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('hb-content', className)}>{children}</div>;
}
