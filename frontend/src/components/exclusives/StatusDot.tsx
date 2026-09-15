import { useExclusivesStatus } from '../../lib/useExclusivesStatus';

/** SP-API health light shown left of the page heading — green = connected,
 *  red = down, grey = still checking. */
export function StatusDot() {
  const { status, loading } = useExclusivesStatus();
  const state = loading || !status ? 'checking' : status.connected ? 'up' : 'down';

  const word = state === 'checking' ? 'Checking…' : status?.connected ? 'Online' : 'Offline';
  const title = `SP-API Status: ${word}`;

  return <span className={`exc-status-dot ${state}`} role="img" aria-label={title} title={title} />;
}
