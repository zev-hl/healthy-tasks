import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { type TaskRef } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Popover } from './harbor/Popover';
import { StatusPill, cx } from './harbor/ui';

/**
 * Search for a task to link, in a popover under the button that opened it
 * (Harbor redesign; replaces the old TaskPickerModal). Matches a task number
 * or part of a name. Tasks already linked here show but can't be picked.
 */
export function TaskLinkPicker({
  anchorRef,
  title,
  hint,
  excludeId,
  linkedIds,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement>;
  title: string;
  /** One line on what picking a task will do. */
  hint: string;
  excludeId: number;
  /** Tasks already linked this way (shown, marked, not pickable). */
  linkedIds: ReadonlySet<number>;
  onPick: (task: TaskRef) => void | Promise<void>;
  onClose: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkedRef = useRef(linkedIds);
  linkedRef.current = linkedIds;

  // The popover is hidden while it measures, so autoFocus can't land: focus once shown.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const q = query.trim().replace(/^#/, '');
    setError(null);
    if (q === '') {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .searchTasks(q, excludeId)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setHi(
            Math.max(
              0,
              r.findIndex((t) => !linkedRef.current.has(t.id)),
            ),
          );
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : 'Search failed');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, excludeId]);

  function move(step: number) {
    if (results.length === 0) return;
    let i = hi;
    for (let n = 0; n < results.length; n++) {
      i = (i + step + results.length) % results.length;
      if (!linkedIds.has(results[i]!.id)) break;
    }
    setHi(i);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = results[hi];
      if (t && !linkedIds.has(t.id)) void onPick(t);
    }
  }

  const q = query.trim();
  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={onClose}
      label={title}
      minWidth={380}
      matchWidth={false}
      className="hb-linkpick"
    >
      <div className="hb-linkpick-head">
        <span className="hb-linkpick-title">{title}</span>
        <span className="hb-linkpick-hint">{hint}</span>
      </div>
      <label className="hb-menu-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Task number or name"
          aria-label="Search tasks"
          aria-controls={listId}
          aria-activedescendant={results[hi] ? `${listId}-${hi}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
      </label>
      {error && (
        <p className="hb-linkpick-msg is-error" role="alert">
          {error}
        </p>
      )}
      {!error && q === '' && (
        <p className="hb-linkpick-msg">Type a number like 482, or a few letters of the name.</p>
      )}
      {!error && q !== '' && loading && results.length === 0 && (
        <p className="hb-linkpick-msg">Searching…</p>
      )}
      {!error && q !== '' && !loading && results.length === 0 && (
        <p className="hb-linkpick-msg">No tasks match “{q}”.</p>
      )}
      {results.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Tasks" className="hb-menu">
          {results.map((t, i) => {
            const linked = linkedIds.has(t.id);
            return (
              <li
                key={t.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                aria-disabled={linked || undefined}
                className={cx(
                  'hb-menu-row hb-linkpick-row',
                  i === hi && 'hi',
                  linked && 'is-linked',
                )}
                onMouseMove={() => !linked && i !== hi && setHi(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !linked && void onPick(t)}
              >
                <span className="hb-linkpick-id">#{t.id}</span>
                <span className="hb-menu-label">{t.name}</span>
                {linked ? (
                  <span className="hb-menu-hint">Already linked</span>
                ) : (
                  <StatusPill status={t.status} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Popover>
  );
}
