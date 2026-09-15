/**
 * Exclusives — Alert Groups dashboard (HLAI-71).
 *
 * Populated with static mock data (see lib/exclusivesMock) so it matches the
 * reference design while the backend does not exist yet. Rows/counts/search are
 * client-side over the mock; "New group" and Edit navigate to the editor.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MOCK_GROUPS,
  MONITORED_ASINS,
  RUN_HEADER,
  fmtAbs,
  fmtRel,
  latestDate,
  total24h,
  type MockGroup,
} from '../lib/exclusivesMock';
import { GroupTypeBadge } from '../components/exclusives/AlertBadge';
import { ExcPager } from '../components/exclusives/ExcPager';
import { DeleteGroupModal } from '../components/exclusives/DeleteGroupModal';
import { LoadingRow } from '../components/exclusives/LoadingRow';

/** ASIN chips: single code for individuals, first 3 + "+N" for groups. */
function asinSummary(g: MockGroup): string {
  const codes = g.asins.map((a) => a.asin);
  if (g.kind === 'INDIVIDUAL') return codes[0] ?? '';
  const head = codes.slice(0, 3).join(' · ');
  return codes.length > 3 ? `${head}  +${codes.length - 3}` : head;
}

function countPillClass(n: number): string {
  if (n >= 14) return 'exc-count hot';
  if (n >= 6) return 'exc-count warm';
  return 'exc-count';
}

export function ExclusivesGroupsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<MockGroup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  const all = useMemo(() => MOCK_GROUPS.filter((g) => !removed.has(g.id)), [removed]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.asins.some((a) => a.asin.toLowerCase().includes(q) || a.title.toLowerCase().includes(q)),
    );
  }, [search, all]);

  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="exc-page">
      <header className="page-head exc-head">
        <div>
          <h1>Exclusives monitoring</h1>
          <p className="muted mono exc-runline">{RUN_HEADER}</p>
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

      <div className="exc-stats">
        <div className="exc-stat accent">
          <span className="exc-stat-value">{total24h()}</span>
          <span className="exc-stat-label">Alerts</span>
          <span className="exc-stat-sub">Past 24 hours</span>
        </div>
        <div className="exc-stat">
          <span className="exc-stat-value">{MONITORED_ASINS}</span>
          <span className="exc-stat-label">ASINs monitored</span>
          <span className="exc-stat-sub">
            {MOCK_GROUPS.length} groups ·{' '}
            {MOCK_GROUPS.filter((g) => g.kind === 'INDIVIDUAL').length} individual
          </span>
        </div>
      </div>

      <section className="card exc-table-card" aria-label="Alert groups">
        <div className="exc-card-head">
          <span className="exc-card-title">Alert Groups</span>
          <span className="mono muted">
            {rows.length} of {all.length} shown
          </span>
          <span className="mono exc-card-hint">Click a row to open its log</span>
        </div>

        <div className="exc-table-scroll">
          <table className="results-table exc-table">
            <thead>
              <tr>
                <th className="exc-col-name">ASIN title / group name</th>
                <th>Grp/Ind</th>
                <th>ASINs</th>
                <th className="exc-num">Count</th>
                <th className="exc-num">24h</th>
                <th>Alerts on</th>
                <th>Updated</th>
                <th>Latest alert</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRow colSpan={9} />}
              {!loading &&
                shown.map((g) => {
                const latest = latestDate(g);
                const hot = g.latestHrs < 3;
                return (
                  <tr
                    key={g.id}
                    className="row-clickable"
                    onClick={() => navigate('/exclusives/log', { state: { gid: g.id } })}
                  >
                    <td className="exc-col-name">
                      <span className="exc-group-name">{g.name}</span>
                    </td>
                    <td>
                      <GroupTypeBadge type={g.kind} />
                    </td>
                    <td>
                      <span className="mono exc-asins">{asinSummary(g)}</span>
                    </td>
                    <td className="exc-num mono">{g.asins.length}</td>
                    <td className="exc-num">
                      <span className={countPillClass(g.notif)}>{g.notif}</span>
                    </td>
                    <td className="mono exc-muted">{g.onCount} of 12</td>
                    <td className="mono exc-muted">{g.updated}</td>
                    <td>
                      <span className={`exc-latest${hot ? ' hot' : ''}`}>{fmtRel(latest)}</span>
                      <span className="mono exc-latest-abs">{fmtAbs(latest)}</span>
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
          total={rows.length}
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
          onConfirm={() => {
            setRemoved((prev) => new Set(prev).add(deleting.id));
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
