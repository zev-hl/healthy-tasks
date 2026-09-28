import { useExclusivesStatus } from '../../lib/useExclusivesStatus';
import { formatTimestamp } from '../../lib/datetime';

/** SP-API health light shown left of the page heading — green = connected,
 *  red = down, grey = still checking. The tooltip also says when Amazon was
 *  last checked successfully, i.e. how current the alerts are. */
export function StatusDot() {
  const { status, loading } = useExclusivesStatus();
  const state = loading || !status ? 'checking' : status.connected ? 'up' : 'down';

  const word = state === 'checking' ? 'Checking…' : status?.connected ? 'Online' : 'Offline';
  const lastCheck = status
    ? ` · Last Amazon check: ${status.lastSweepAt ? formatTimestamp(status.lastSweepAt) : 'never'}`
    : '';
  const title = `SP-API Status: ${word}${lastCheck}`;

  return <span className={`exc-status-dot ${state}`} role="img" aria-label={title} title={title} />;
}
