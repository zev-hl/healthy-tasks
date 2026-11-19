import { ExternalLink, MessagesSquare } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Card, Empty } from '../components/harbor/ui';
import { useConnect } from '../lib/connect';

/**
 * Connect as an app inside HL Central (Nov 2026 plan, K1): opened from the
 * nine-dot menu, our Connect fills the page — the real app in a frame, so
 * chats, groups and calls all work here — with a link to open it in its own
 * tab. Connect must allow HL Central's address to frame it
 * (docs/connect-changes.md §2); until it does, the frame stays blank and the
 * link still works.
 */
export function ConnectPage() {
  const { available, url } = useConnect();
  const { user } = useAuth();
  if (!available || !url) {
    return (
      <>
        <PageHeader title="Connect" subtitle="Chats and calls" search={false} newTask={false} />
        <PageBody>
          <Card>
            <Empty>
              <MessagesSquare size={18} aria-hidden="true" /> Connect isn’t linked to HL Central
              yet.
              {user?.role === 'Admin' &&
                ' Once our Connect is running, set CONNECT_URL and CONNECT_API_KEY on HL Central’s server (docs/connect-changes.md) and it opens here.'}
            </Empty>
          </Card>
        </PageBody>
      </>
    );
  }
  return (
    <div className="hb-connect-page">
      <div className="hb-connect-bar">
        <strong>Connect</strong>
        <span className="hb-grow" />
        <a href={url} target="_blank" rel="noopener noreferrer" className="hb-chat-link">
          <ExternalLink size={14} aria-hidden="true" /> Open in its own tab
        </a>
      </div>
      <iframe
        src={`${url}/`}
        title="Connect"
        allow="camera; microphone; display-capture; clipboard-write; autoplay; fullscreen"
      />
    </div>
  );
}
