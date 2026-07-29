/**
 * Friendly empty state — Phase 9. Replaces bare blank tables / "No X." lines
 * with a centered icon + plain-language message.
 */
import type { ReactNode } from 'react';

function DefaultIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 8.5 5.2 4.8A2 2 0 0 1 6.9 4h10.2a2 2 0 0 1 1.7.8L21 8.5M3 8.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5M3 8.5h5.2a1 1 0 0 1 .95.68l.2.64a1 1 0 0 0 .95.68h3.4a1 1 0 0 0 .95-.68l.2-.64a1 1 0 0 1 .95-.68H21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyState({
  title,
  children,
  icon,
  compact = false,
}: {
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <div className="empty-state-icon">{icon ?? <DefaultIcon />}</div>
      {title && <div className="empty-state-title">{title}</div>}
      {children && <div className="empty-state-text">{children}</div>}
    </div>
  );
}

/**
 * Empty state that fills a full table width. Renders a single spanning row so it
 * drops straight into an existing `<tbody>`.
 */
export function TableEmptyRow({
  colSpan,
  title,
  children,
  icon,
}: {
  colSpan: number;
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <tr>
      <td className="empty-cell" colSpan={colSpan}>
        <EmptyState title={title} icon={icon} compact>
          {children}
        </EmptyState>
      </td>
    </tr>
  );
}
