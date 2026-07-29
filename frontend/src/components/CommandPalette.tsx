/**
 * Command palette (Cmd/Ctrl+K) — Phase 9.
 *
 * Quick-open overlay that can jump to any task by Id or Name and trigger common
 * actions (new task, go to Search, go to Notifications, dashboard, profile,
 * users). Mounted from Layout; it is conditionally rendered so it resets and
 * re-animates on every open.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskRef } from '@healthy-tasks/shared';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { StatusDot } from './ui/indicators';

interface Action {
  id: string;
  title: string;
  hint: string;
  icon: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<TaskRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const actions = useMemo<Action[]>(() => {
    const items: Action[] = [
      {
        id: 'new-task',
        title: 'New task',
        hint: 'Create a task',
        icon: '＋',
        keywords: 'new create add task',
        run: () => go('/tasks/new'),
      },
      {
        id: 'search',
        title: 'Go to Search',
        hint: 'Browse and filter tasks',
        icon: '⌕',
        keywords: 'search tasks find list grid',
        run: () => go('/tasks'),
      },
      {
        id: 'notifications',
        title: 'Go to Notifications',
        hint: 'Mentions, reminders, assignments',
        icon: '◔',
        keywords: 'notifications alerts bell mentions reminders',
        run: () => go('/notifications'),
      },
      {
        id: 'dashboard',
        title: 'Go to Home',
        hint: 'Dashboard and quick actions',
        icon: '⌂',
        keywords: 'home dashboard start overview',
        run: () => go('/'),
      },
      {
        id: 'profile',
        title: 'Go to Profile',
        hint: 'Your account & notification preferences',
        icon: '☺',
        keywords: 'profile account settings preferences me',
        run: () => go('/profile'),
      },
    ];
    if (user?.role === 'Admin') {
      items.push({
        id: 'users',
        title: 'Manage Users',
        hint: 'Admin · user directory',
        icon: '⚇',
        keywords: 'users admin people directory manage',
        run: () => go('/admin/users'),
      });
    }
    return items;
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const filteredActions = useMemo(() => {
    if (!q) return actions;
    return actions.filter(
      (a) => a.title.toLowerCase().includes(q) || a.keywords.includes(q),
    );
  }, [actions, q]);

  // Debounced task search whenever there's a query.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setTasks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .searchTasks(term)
        .then((r) => {
          if (!cancelled) setTasks(r.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setTasks([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  // Flatten to a single navigable list of selectable rows.
  const rows = useMemo(
    () => [
      ...filteredActions.map((a) => ({ kind: 'action' as const, action: a })),
      ...tasks.map((t) => ({ kind: 'task' as const, task: t })),
    ],
    [filteredActions, tasks],
  );

  // Keep the active index in range as the list changes.
  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  // Focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cmdk-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const select = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === 'action') row.action.run();
    else go(`/tasks/${row.task.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(active);
    }
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <svg
            className="cmdk-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search tasks by Id or name, or run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="cmdk-hint">
            <span className="kbd">Esc</span>
          </span>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {filteredActions.length > 0 && <div className="cmdk-group-label">Actions</div>}
          {filteredActions.map((a) => {
            const index = rows.findIndex((r) => r.kind === 'action' && r.action.id === a.id);
            return (
              <div
                key={a.id}
                className={`cmdk-item${index === active ? ' active' : ''}`}
                onMouseMove={() => setActive(index)}
                onClick={() => select(index)}
                role="button"
                tabIndex={-1}
              >
                <span className="cmdk-item-icon">{a.icon}</span>
                <span className="cmdk-item-body">
                  <span className="cmdk-item-title">{a.title}</span>
                  <span className="cmdk-item-sub">{a.hint}</span>
                </span>
              </div>
            );
          })}

          {query.trim() !== '' && (
            <div className="cmdk-group-label">
              Tasks{loading ? ' · searching…' : ''}
            </div>
          )}
          {tasks.map((t) => {
            const index = rows.findIndex((r) => r.kind === 'task' && r.task.id === t.id);
            return (
              <div
                key={t.id}
                className={`cmdk-item${index === active ? ' active' : ''}`}
                onMouseMove={() => setActive(index)}
                onClick={() => select(index)}
                role="button"
                tabIndex={-1}
              >
                <span className="cmdk-item-icon">#</span>
                <span className="cmdk-item-body">
                  <span className="cmdk-item-title">{t.name}</span>
                  <span className="cmdk-item-sub">
                    <StatusDot status={t.status} />
                  </span>
                </span>
                <span className="cmdk-item-meta">#{t.id}</span>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div className="cmdk-empty">
              {loading ? 'Searching…' : 'No matching tasks or commands.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
