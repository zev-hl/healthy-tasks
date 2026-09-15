/** Spanning table row showing the app's inline spinner while data loads. */
export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td className="empty-cell" colSpan={colSpan}>
        <div className="empty-state compact">
          <span className="loading-inline">
            <span className="spinner" />
            <span className="mono">Loading…</span>
          </span>
        </div>
      </td>
    </tr>
  );
}
