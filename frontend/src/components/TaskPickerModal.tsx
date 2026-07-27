import { useEffect, useState } from 'react';
import { TASK_STATUS_LABELS, type TaskRef } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

interface Props {
  title: string;
  excludeId?: number;
  onPick: (task: TaskRef) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Search/select popup used to pick a task for a relationship. Matches partial
 * Task Id or Task Name. Deliberately plain — Phase 2/3 scaffolding.
 */
export function TaskPickerModal({ title, excludeId, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search as the user types.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .searchTasks(q, excludeId)
        .then((r) => {
          if (!cancelled) setResults(r);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {error && <div className="alert error">{error}</div>}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by Task Id or Name…"
        />
        <div style={{ marginTop: '0.75rem', maxHeight: '40vh', overflowY: 'auto' }}>
          {loading && <p className="muted">Searching…</p>}
          {!loading && query.trim() !== '' && results.length === 0 && (
            <p className="muted">No matching tasks.</p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {results.map((t) => (
              <li key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="secondary"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    padding: '0.55rem 0.3rem',
                  }}
                  onClick={() => onPick(t)}
                >
                  <strong>#{t.id}</strong> {t.name}{' '}
                  <span className="muted">({TASK_STATUS_LABELS[t.status]})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
