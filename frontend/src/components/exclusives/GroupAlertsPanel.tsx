/**
 * A group's recent alerts, in a panel over the Groups list (HLAI-71 ticket 1).
 *
 * Opening a group's alerts used to mean leaving the screen. This keeps the list
 * behind it, so someone can look at one group and carry on down the page.
 *
 * The app has no drawer of its own, so this is the first: an overlay pinned to
 * the right, dismissed by the close control, by clicking away, or by Escape.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesAlertRowDto,
  type ExclusivesGroupAlertStatsDto,
  type ExclusivesGroupRowDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { absoluteShort, formatAgo } from '../../lib/datetime';
import { AlertTypeBadge, GroupTypeBadge, alertTone } from './AlertBadge';
import { Flag } from './Flag';

/** Alerts shown in the panel before it sends people to the full log. */
const PANEL_PAGE_SIZE = 50;

/** "Today · 26 Sep", "Yesterday · 25 Sep", or just the date further back. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days === 0) return `Today · ${date}`;
  if (days === 1) return `Yesterday · ${date}`;
  return date;
}

/** Alerts in order, split into the days they fall on. */
function byDay(
  rows: ExclusivesAlertRowDto[],
): { heading: string; rows: ExclusivesAlertRowDto[] }[] {
  const out: { heading: string; rows: ExclusivesAlertRowDto[] }[] = [];
  for (const row of rows) {
    const heading = dayHeading(row.createdAt);
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.rows.push(row);
    else out.push({ heading, rows: [row] });
  }
  return out;
}

export function GroupAlertsPanel({
  group,
  onClose,
  onEdit,
  onOpenLog,
}: {
  group: ExclusivesGroupRowDto;
  onClose: () => void;
  onEdit: () => void;
  onOpenLog: () => void;
}) {
  const [rows, setRows] = useState<ExclusivesAlertRowDto[]>([]);
  const [stats, setStats] = useState<ExclusivesGroupAlertStatsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [page, counts] = await Promise.all([
        api.queryExclusivesAlerts({ groupIds: [group.id], page: 1, pageSize: PANEL_PAGE_SIZE }),
        api.getExclusivesGroupAlertStats(group.id),
      ]);
      setRows(page.rows);
      setStats(counts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this group’s alerts');
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // In the order the settings panel uses, so the chips never jump about.
  const chips = EXCLUSIVES_ALERT_TYPES.filter((t) => (stats?.byType[t] ?? 0) > 0);
  const days = byDay(rows);

  return (
    <div className="exc-panel-backdrop" onClick={onClose}>
      <aside
        className="exc-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exc-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="exc-drawer-head">
          <div className="exc-drawer-title-row">
            <h2 id="exc-drawer-title">{group.name}</h2>
            <GroupTypeBadge type={group.groupType} />
            <div className="exc-drawer-head-btns">
              <button type="button" className="secondary btn-sm" onClick={onEdit}>
                Edit group
              </button>
              <button
                type="button"
                className="exc-drawer-x"
                onClick={onClose}
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
          </div>
          <p className="mono muted exc-drawer-sub">
            {group.listingCount} ASIN{group.listingCount === 1 ? '' : 's'} ·{' '}
            {stats ? stats.total : group.alerts24h} alert
            {(stats ? stats.total : group.alerts24h) === 1 ? '' : 's'} in the past 24 hours
          </p>
          {chips.length > 0 && (
            <div className="exc-drawer-chips">
              {chips.map((t) => (
                <AlertTypeBadge key={t} type={t} count={stats?.byType[t]} showDot={false} />
              ))}
            </div>
          )}
        </header>

        <div className="exc-drawer-body">
          {error && <div className="alert error">{error}</div>}
          {loading && rows.length === 0 && (
            <p className="loading-inline">
              <span className="spinner" /> Loading alerts…
            </p>
          )}
          {!loading && rows.length === 0 && !error && (
            <p className="muted exc-drawer-empty">
              No alerts for this group yet. They appear once a check finds a change on one of its
              products.
            </p>
          )}

          {days.map((day) => (
            <section key={day.heading} className="exc-drawer-day">
              <h3 className="mono muted exc-drawer-day-head">{day.heading}</h3>
              {day.rows.map((row) => (
                <article className="exc-drawer-alert" key={row.id}>
                  {/* The row's one mark of colour; the badge beside it needs none. */}
                  <span
                    className="exc-drawer-dot"
                    style={{ background: alertTone(row.alertType).dot }}
                    aria-hidden="true"
                  />
                  <div className="exc-drawer-alert-main">
                    <div className="exc-drawer-alert-top">
                      <AlertTypeBadge type={row.alertType} showDot={false} />
                      <span className="exc-asin-cell">
                        <Flag platform={row.marketplace} />
                        <span className="mono">{row.asin}</span>
                      </span>
                      <span className="exc-drawer-when">
                        <span className="exc-latest">{formatAgo(row.createdAt)}</span>
                        <span className="mono exc-latest-abs">{absoluteShort(row.createdAt)}</span>
                      </span>
                    </div>
                    <p className="exc-drawer-product">{row.title}</p>
                    <p className="exc-drawer-message">{row.message}</p>
                  </div>
                </article>
              ))}
            </section>
          ))}

          {rows.length === PANEL_PAGE_SIZE && (
            <p className="muted exc-drawer-more">
              Showing the {PANEL_PAGE_SIZE} most recent. Open the Alert Log for the rest.
            </p>
          )}
        </div>

        <footer className="exc-drawer-foot">
          <button type="button" className="exc-drawer-open-log" onClick={onOpenLog}>
            Open in Alert Log →
          </button>
        </footer>
      </aside>
    </div>
  );
}
