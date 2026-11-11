import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grip, ListChecks, ScrollText, Search, X, type LucideIcon } from 'lucide-react';

export type AppKey = 'central' | 'exclusives';

interface AppTile {
  key: AppKey;
  name: string;
  to: string;
  icon: LucideIcon;
  tone: 'blue' | 'peach' | 'green' | 'purple' | 'yellow' | 'grey';
}

/**
 * The apps the launcher lists. HL Central's own sections are in its sidebar;
 * the launcher holds the other apps (for now Exclusive Alerts), plus HL Central
 * itself as the way back.
 */
const APPS: AppTile[] = [
  { key: 'central', name: 'HL Central', to: '/', icon: ListChecks, tone: 'blue' },
  { key: 'exclusives', name: 'Exclusive Alerts', to: '/exclusives/log', icon: ScrollText, tone: 'peach' },
];

export function appForPath(pathname: string): AppKey {
  return pathname.startsWith('/exclusives') ? 'exclusives' : 'central';
}

/** Google-style "All apps" popover, opened from the nine-dot button in the sidebar. */
export function AppLauncher({ current }: { current: AppKey }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const titleId = useId();

  const shown = APPS.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  function close(returnFocus = true) {
    setOpen(false);
    setQuery('');
    if (returnFocus) buttonRef.current?.focus();
  }

  function go(app: AppTile) {
    close(false);
    navigate(app.to);
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Arrow keys move through the grid (3 columns).
  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.launcher-tile'));
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    tiles[Math.min(tiles.length - 1, Math.max(0, i + step))]?.focus();
  }

  return (
    <div className="launcher-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`side-nav-item${open ? ' active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
        title="All apps"
      >
        <Grip size={18} strokeWidth={1.7} aria-hidden="true" />
        <span className="side-label">All apps</span>
      </button>
      {open && (
        <div ref={panelRef} className="launcher" role="dialog" aria-labelledby={titleId}>
          <div className="launcher-head">
            <h2 id={titleId}>Apps</h2>
            <button type="button" className="launcher-close" onClick={() => close()} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <label className="launcher-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) go(shown[0]);
              }}
              placeholder="Find an app"
              aria-label="Find an app"
            />
          </label>
          <div className="launcher-grid" onKeyDown={onGridKey}>
            {shown.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.key}
                  type="button"
                  className={`launcher-tile${a.key === current ? ' current' : ''}`}
                  aria-current={a.key === current ? 'true' : undefined}
                  onClick={() => go(a)}
                >
                  <span className={`launcher-icon tone-${a.tone}`} aria-hidden="true">
                    <Icon size={24} strokeWidth={2} />
                  </span>
                  <span className="launcher-name">{a.name}</span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="launcher-empty">No app matches “{query}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
