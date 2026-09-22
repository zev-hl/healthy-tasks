/**
 * Exclusives — Alert Groups dashboard (HLAI-71 Chunk 8a).
 *
 * Real data: the header numbers come from GET /api/exclusives/summary and the
 * table from POST /api/exclusives/groups/query. Search, sorting and paging all
 * happen on the server, so the screen never holds more than one page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ExclusivesGroupRowDto,
  ExclusivesGroupSortField,
  ExclusivesSummaryDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState, type SortEntry } from '../lib/multiSort';
import { absoluteShort, formatAgo, formatTimestamp } from '../lib/datetime';
import { SortHeader } from '../components/SortHeader';
import { TableEmptyRow } from '../components/ui/EmptyState';
import { GroupTypeBadge } from '../components/exclusives/AlertBadge';
import { ExcPager } from '../components/exclusives/ExcPager';
import { DeleteGroupModal } from '../components/exclusives/DeleteGroupModal';
import { LoadingRow } from '../components/exclusives/LoadingRow';
import { StatusDot } from '../components/exclusives/StatusDot';

const COLUMNS = 9;
/** An alert this recent gets the "hot" treatment in the Latest column. */
const HOT_MS = 3 * 60 * 60 * 1000;

/** ASIN chips: the preview the server sends, plus "+N" for what it left out. */
function asinSummary(group: ExclusivesGroupRowDto): string {
  const shown = group.asinPreview;
  if (shown.length === 0) return '—';
  const head = shown.join(' · ');
  const rest = group.listingCount - shown.length;
  return rest > 0 ? `${head}  +${rest}` : head;
}

function countPillClass(n: number): string {
  if (n >= 14) return 'exc-count hot';
  if (n >= 6) return 'exc-count warm';
  return 'exc-count';
}

/** "last run 2:30 PM · next run 3:00 PM", from the real sweep times. */
function runLine(summary: ExclusivesSummaryDto | null): string {
  if (!summary) return 'Loading…';
  const last = summary.lastSweepAt ? formatTimestamp(summary.lastSweepAt) : 'never';
  if (!summary.sweepEnabled) return `last check ${last} · automatic checks are off`;
  const next = summary.nextSweepAt ? formatTimestamp(summary.nextSweepAt) : 'due now';
  return `last check ${last} · next ${next} · every ${summary.sweepMinutes} min`;
}

export function ExclusivesGroupsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortEntry<ExclusivesGroupSortField>[]>([]);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ExclusivesGroupRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ExclusivesSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ExclusivesGroupRowDto | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  // Filters can change faster than the server answers; only the newest reply
  // is allowed to land.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const [result, stats] = await Promise.all([
        api.queryExclusivesGroups({
          text: debouncedSearch.trim() || undefined,
          sort: sort.length > 0 ? sort : undefined,
          page,
          pageSize,
        }),
        api.getExclusivesSummary(),
      ]);
      if (id !== requestId.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setSummary(stats);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : 'Could not load alert groups');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [debouncedSearch, sort, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSort(field: ExclusivesGroupSortField, additive: boolean) {
    setSort((s) => cycleSort(s, field, additive));
    setPage(1);
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.deleteExclusivesGroup(deleting.id);
      setDeleting(null);
      // The page may now be past the end; step back rather than showing nothing.
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else void load();
    } catch (err) {
      setDeleting(null);
      setError(err instanceof ApiError ? err.message : 'Could not delete the group');
    }
  }

  const searching = debouncedSearch.trim().length > 0;

  return (
    <div className="exc-page">
      <header className="page-head exc-head">
        <div>
          <h1>
            <StatusDot />
            Exclusives monitoring
          </h1>
          <p className="muted mono exc-runline">{runLine(summary)}</p>
        </div>
        <div className="exc-actions">
          <input
            className="exc-search"
            type="search"
            placeholder="Search ASIN, title or group name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Search alert groups"
          />
          <button type="button" onClick={() => navigate('/exclusives/groups/new')}>
            New group
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="exc-stats">
        <div className="exc-stat accent">
          <span className="exc-stat-value">{summary ? summary.alerts24h : '—'}</span>
          <span className="exc-stat-label">Alerts</span>
          <span className="exc-stat-sub">Past 24 hours</span>
        </div>
        <div className="exc-stat">
          <span className="exc-stat-value">{summary ? summary.asinsMonitored : '—'}</span>
          <span className="exc-stat-label">ASINs monitored</span>
          <span className="exc-stat-sub">
            {summary ? `${summary.groupCount} groups · ${summary.individualCount} individual` : ' '}
          </span>
        </div>
      </div>

      <section className="card exc-table-card" aria-label="Alert groups">
        <div className="exc-card-head">
          <span className="exc-card-title">Alert Groups</span>
          <span className="mono muted">{loading ? '…' : `${total} total`}</span>
          <span className="mono exc-card-hint">Click a row to open its log</span>
        </div>

        <div className="exc-table-scroll">
          <table className="results-table exc-table">
            <thead>
              <tr>
                <SortHeader
                  label="ASIN title / group name"
                  multi={sort.length > 1}
                  state={sortState(sort, 'name')}
                  onSort={(additive) => onSort('name', additive)}
                />
                <th>Grp/Ind</th>
                <th>ASINs</th>
                <SortHeader
                  label="Count"
                  multi={sort.length > 1}
                  state={sortState(sort, 'listingCount')}
                  onSort={(additive) => onSort('listingCount', additive)}
                />
                <th className="exc-num">24h</th>
                <th>Alerts on</th>
                <SortHeader
                  label="Updated"
                  multi={sort.length > 1}
                  state={sortState(sort, 'updatedAt')}
                  onSort={(additive) => onSort('updatedAt', additive)}
                />
                <th>Latest alert</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <LoadingRow colSpan={COLUMNS} />}
              {!loading && rows.length === 0 && (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title={searching ? 'No groups match that search' : 'No alert groups yet'}
                >
                  {searching
                    ? 'Try a different ASIN, product title or group name.'
                    : 'Create a group to start watching products on the seller account.'}
                </TableEmptyRow>
              )}
              {rows.map((g) => {
                const hot =
                  g.latestAlertAt !== null && Date.now() - Date.parse(g.latestAlertAt) < HOT_MS;
                return (
                  <tr
                    key={g.id}
                    className="row-clickable"
                    onClick={() =>
                      navigate('/exclusives/log', { state: { gid: g.id, gname: g.name } })
                    }
                  >
                    <td className="exc-col-name">
                      <span className="exc-group-name">{g.name}</span>
                    </td>
                    <td>
                      <GroupTypeBadge type={g.groupType} />
                    </td>
                    <td>
                      <span className="mono exc-asins">{asinSummary(g)}</span>
                    </td>
                    <td className="exc-num mono">{g.listingCount}</td>
                    <td className="exc-num">
                      <span className={countPillClass(g.alerts24h)}>{g.alerts24h}</span>
                    </td>
                    <td className="mono exc-muted">{g.alertTypesOn} of 12</td>
                    <td className="mono exc-muted">{absoluteShort(g.updatedAt)}</td>
                    <td>
                      <span className={`exc-latest${hot ? ' hot' : ''}`}>
                        {g.latestAlertAt ? formatAgo(g.latestAlertAt) : 'No alerts yet'}
                      </span>
                      {g.latestAlertAt && (
                        <span className="mono exc-latest-abs">
                          {absoluteShort(g.latestAlertAt)}
                        </span>
                      )}
                    </td>
                    <td className="exc-row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="exc-act"
                        onClick={() => navigate(`/exclusives/groups/${g.id}/edit`)}
                      >
                        Edit
                      </button>
                      <button type="button" className="exc-act del" onClick={() => setDeleting(g)}>
                        Delete
                      </button>
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

      {deleting && (
        <DeleteGroupModal
          group={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
