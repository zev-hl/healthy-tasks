import { ExternalLink, MessagesSquare } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Card, Empty } from '../components/harbor/ui';
import { useConnect } from '../lib/connect';

/**
 * Where Connect's tile in the nine-dot menu leads before Connect is linked
 * (Nov 2026 plan, K1). Once linked, the tile opens Connect in a tab of its own
 * and this page, if reached by its address, offers the same.
 */
export function ConnectPage() {
  const { available, url } = useConnect();
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Connect" subtitle="Chats and calls" search={false} newTask={false} />
      <PageBody>
        <Card>
          {available && url ? (
            <Empty>
              <MessagesSquare size={18} aria-hidden="true" /> Connect opens in a tab of its own.{' '}
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> Open Connect
              </a>
            </Empty>
          ) : (
            <Empty>
              <MessagesSquare size={18} aria-hidden="true" /> Connect isn’t linked to HL Central
              yet.
              {user?.role === 'Admin'
                ? ' It’s linked in HL Central’s server settings: ask the person who runs the server. Once it is, this tile opens Connect.'
                : ' Ask an Admin if you need it.'}
            </Empty>
          )}
        </Card>
      </PageBody>
    </>
  );
}
