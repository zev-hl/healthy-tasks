/**
 * Exclusives — Alert Log (HLAI-71 Chunk 8b).
 *
 * Real data: rows come from POST /api/exclusives/alerts/query, and every filter
 * here — dates, alert types, group, search — is applied by the server, so the
 * screen never holds more than one page. The header toolbar keeps the reference
 * design: date-range and alert-type popovers, search, and Export.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertQueryRequest,
  type ExclusivesAlertRowDto,
  type ExclusivesAlertType,
} from '@healthy-tasks/shared';
import { api, ApiError, exportExclusivesAlertsToCsv } from '../api/client';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { absoluteShort, formatAgo } from '../lib/datetime';
import { TableEmptyRow } from '../components/ui/EmptyState';
import { AlertTypeBadge } from '../components/exclusives/AlertBadge';
import { ExcPager } from '../components/exclusives/ExcPager';
import { Flag } from '../components/exclusives/Flag';
import { LoadingRow } from '../components/exclusives/LoadingRow';
import { StatusDot } from '../components/exclusives/StatusDot';

const COLUMNS = 5;

/** The Groups screen hands us a group to filter by when a row is clicked. */
interface LogLinkState {
  gid?: number;
  gname?: string;
}

/** A `datetime-local` value is local wall-clock; the API wants an instant. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** "$33.95 → $33.90", when the alert carries both sides of the change. */
function beforeAfter(row: ExclusivesAlertRowDto): string | null {
  if (row.previousValue === null && row.newValue === null) return null;
  return `${row.previousValue ?? '—'} → ${row.newValue ?? '—'}`;
}

export function ExclusivesLogPage() {
  const link = (useLocation().state ?? {}) as LogLinkState;

  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Set<ExclusivesAlertType>>(new Set());
  const [datesOpen, setDatesOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Seeded from the Groups screen's row click, and clearable from the chip.
  const [groupId, setGroupId] = useState<number | null>(link.gid ?? null);

  const [rows, setRows] = useState<ExclusivesAlertRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 350);
  // Filters change faster than the server answers; only the newest reply lands.
  const requestId = useRef(0);

  // Built from the individual filters rather than held in state, so the effect
  // below can depend on the values instead of an object that changes identity
  // on every render.
  const buildQuery = useCallback(
    (): ExclusivesAlertQueryRequest => ({
      text: debouncedSearch.trim() || undefined,
      alertTypes: active.size > 0 ? [...active] : undefined,
      groupIds: groupId !== null ? [groupId] : undefined,
      from: toIso(dateFrom),
      to: toIso(dateTo),
      page,
      pageSize,
    }),
    [debouncedSearch, active, groupId, dateFrom, dateTo, page, pageSize],
  );

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.queryExclusivesAlerts(buildQuery());
      if (id !== requestId.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : 'Could not load the alert log');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleType(t: ExclusivesAlertType) {
    setPage(1);
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function closePopovers() {
    setDatesOpen(false);
    setTypesOpen(false);
  }

  async function onExport() {
    setExporting(true);
    try {
      // Everything on screen, not just this page — the server caps it at 10,000.
      await exportExclusivesAlertsToCsv({ ...buildQuery(), page: undefined });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const filtered =
    debouncedSearch.trim().length > 0 ||
    active.size > 0 ||
    groupId !== null ||
    dateFrom !== '' ||
    dateTo !== '';
  const groupName = link.gname ?? rows[0]?.groupName ?? 'one group';

  return (
    <div className="exc-page">
      <header className="page-head exc-head">
        <div>
          <h1>
            <StatusDot />
            Exclusives Alert Log
          </h1>
          <p className="muted mono">
            {loading ? 'Loading…' : `${total} alert${total === 1 ? '' : 's'}`} · newest first
          </p>
        </div>
        <div className="exc-actions">
          <div className="exc-filter-wrap">
            <button
              type="button"
              className={`exc-toolbtn${datesOpen ? ' open' : ''}`}
              aria-expanded={datesOpen}
              onClick={() => {
                setTypesOpen(false);
                setDatesOpen((o) => !o);
              }}
            >
              <span aria-hidden="true">🗓</span>
              Filter by date / time
              {(dateFrom || dateTo) && <span className="exc-filter-count">1</span>}
              <span className="exc-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {datesOpen && (
              <div className="exc-filter-pop exc-date-pop">
                <div className="exc-filter-pop-head">
                  <span>Date / time range</span>
                  {(dateFrom || dateTo) && (
                    <button
                      type="button"
                      className="exc-clear"
                      onClick={() => {
                        setDateFrom('');
                        setDateTo('');
                        setPage(1);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <label className="exc-date-field">
                  <span>From</span>
                  <input
                    type="datetime-local"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <label className="exc-date-field">
                  <span>To</span>
                  <input
                    type="datetime-local"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="exc-filter-wrap">
            <button
              type="button"
              className={`exc-toolbtn${typesOpen ? ' open' : ''}`}
              aria-expanded={typesOpen}
              onClick={() => {
                setDatesOpen(false);
                setTypesOpen((o) => !o);
              }}
            >
              Filter by alert type
              {active.size > 0 && <span className="exc-filter-count">{active.size}</span>}
              <span className="exc-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {typesOpen && (
              <div className="exc-filter-pop exc-type-pop">
                <div className="exc-filter-pop-head">
                  <span>Alert types</span>
                  {active.size > 0 && (
                    <button
                      type="button"
                      className="exc-clear"
                      onClick={() => {
                        setActive(new Set());
                        setPage(1);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="exc-filter-chips">
                  {EXCLUSIVES_ALERT_TYPES.map((t) => {
                    const on = active.has(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`exc-legend-chip${on ? ' active' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleType(t)}
                        title={EXCLUSIVES_ALERT_TYPE_LABELS[t]}
                      >
                        <AlertTypeBadge type={t} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <input
            className="exc-search exc-search-log"
            type="search"
            placeholder="Search ASIN, title or group name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search alerts"
          />
          <button
            type="button"
            className="exc-toolbtn"
            onClick={() => void onExport()}
            disabled={exporting || total === 0}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="exc-sortline">
        <span className="mono">Sort: Date / time ↓</span>
        {groupId !== null && (
          <button
            type="button"
            className="exc-clear"
            onClick={() => {
              setGroupId(null);
              setPage(1);
            }}
          >
            Showing “{groupName}” only — show all ✕
          </button>
        )}
      </div>

      <section className="card exc-table-card" aria-label="Alert log">
        <div className="exc-table-scroll">
          <table className="results-table exc-table exc-log-table">
            <thead>
              <tr>
                <th className="exc-col-asin">ASIN</th>
                <th className="exc-col-name">ASIN title</th>
                <th>Group</th>
                <th>Alert type</th>
                <th>Date / time ↓</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <LoadingRow colSpan={COLUMNS} />}
              {!loading && rows.length === 0 && (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title={filtered ? 'No alerts match these filters' : 'No alerts yet'}
                >
                  {filtered
                    ? 'Try a wider date range, or clear a filter.'
                    : 'Alerts appear here once a check finds a change on a watched product.'}
                </TableEmptyRow>
              )}
              {rows.map((row) => {
                const change = beforeAfter(row);
                return (
                  <tr key={row.id}>
                    <td className="exc-col-asin">
                      <span className="exc-asin-cell">
                        <Flag platform={row.marketplace} />
                        <span className="mono">{row.asin}</span>
                      </span>
                    </td>
                    <td className="exc-col-name">
                      <span className="exc-log-title">{row.title}</span>
                      <span className="exc-log-detail">{row.message}</span>
                    </td>
                    <td className="exc-muted">{row.groupName}</td>
                    <td>
                      <AlertTypeBadge type={row.alertType} />
                      {change && <span className="mono exc-log-detail">{change}</span>}
                    </td>
                    <td>
                      <span className="exc-latest">{formatAgo(row.createdAt)}</span>
                      <span className="mono exc-latest-abs">{absoluteShort(row.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ExcPager
          total={total}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </section>

      {(datesOpen || typesOpen) && (
        <div className="exc-pop-backdrop" onClick={closePopovers} aria-hidden="true" />
      )}
    </div>
  );
}
