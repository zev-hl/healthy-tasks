/**
 * Shown when a save was rejected because the record changed since it was opened.
 * The Save button (rendered by the parent) is swapped to Refresh; this banner
 * offers Review (keep your edits on screen, unsaved) alongside it.
 */
export function ConflictBanner({
  entity,
  onReview,
}: {
  entity: 'goal' | 'task';
  onReview: () => void;
}) {
  return (
    <div className="alert error conflict-banner" role="alert">
      <p style={{ margin: 0 }}>
        Save failed. The {entity} was updated while viewed here. Click <strong>Review</strong> to
        check your changes before they are lost or <strong>Refresh</strong> to update your screen
        with the current information. Data will be updated on the screen if Refresh is clicked.
        Review retains the stale data and whatever changes you have made on the screen but does not
        save it.
      </p>
      <div className="btn-row" style={{ marginTop: '0.6rem' }}>
        <button type="button" className="secondary" onClick={onReview}>
          Review
        </button>
      </div>
    </div>
  );
}
