/**
 * Exclusives — Alert Log (HLAI-71).
 *
 * Populated with static mock data (lib/exclusivesMock.buildLog) so it matches
 * the reference design. Header toolbar = date-range filter, alert-type filter
 * (colour chips live in a popover, not an inline strip), search and export.
 * Filtering/search run client-side over the mock; export is a placeholder.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertType,
} from '@healthy-tasks/shared';
import { ALERT_DETAILS, buildLog, fmtAbs, fmtRel } from '../lib/exclusivesMock';
import { AlertTypeBadge } from '../components/exclusives/AlertBadge';
import { ExcPager } from '../components/exclusives/ExcPager';
import { Flag } from '../components/exclusives/Flag';
import { LoadingRow } from '../components/exclusives/LoadingRow';

export function ExclusivesLogPage() {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Set<ExclusivesAlertType>>(new Set());
  const [datesOpen, setDatesOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  const allEntries = useMemo(() => buildLog(), []);

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo).getTime() : null;
    return allEntries.filter((e) => {
      if (active.size > 0 && !active.has(e.type)) return false;
      const t = e.date.getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      if (!q) return true;
      return (
        e.asin.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.group.toLowerCase().includes(q)
      );
    });
  }, [allEntries, search, active, dateFrom, dateTo]);

  const shown = entries.slice((page - 1) * pageSize, page * pageSize);

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

  return (
    <div className="exc-page">
      <header className="page-head exc-head">
        <div>
          <h1>Exclusives Alert Log</h1>
          <p className="muted mono">
            {entries.length} alerts · newest first · runs at :00 and :30
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
              <span className="exc-caret" aria-hidden="true">▾</span>
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
              <span className="exc-caret" aria-hidden="true">▾</span>
            </button>
            {typesOpen && (
              <div className="exc-filter-pop exc-type-pop">
                <div className="exc-filter-pop-head">
                  <span>Alert types</span>
                  {active.size > 0 && (
                    <button type="button" className="exc-clear" onClick={() => setActive(new Set())}>
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
          <button type="button" className="exc-toolbtn" disabled>
            Export
          </button>
        </div>
      </header>

      <div className="exc-sortline">
        <span className="mono">Sort: Date / time ↓</span>
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
              {loading && <LoadingRow colSpan={5} />}
              {!loading &&
                shown.map((e, i) => (
                <tr key={`${e.asin}-${i}`}>
                  <td className="exc-col-asin">
                    <span className="exc-asin-cell">
                      <Flag platform={e.platform} />
                      <span className="mono">{e.asin}</span>
                    </span>
                  </td>
                  <td className="exc-col-name">
                    <span className="exc-log-title">{e.title}</span>
                    <span className="exc-log-detail">{ALERT_DETAILS[e.type]}</span>
                  </td>
                  <td className="exc-muted">{e.group}</td>
                  <td>
                    <AlertTypeBadge type={e.type} />
                  </td>
                  <td>
                    <span className="exc-latest">{fmtRel(e.date)}</span>
                    <span className="mono exc-latest-abs">{fmtAbs(e.date)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ExcPager
          total={entries.length}
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
