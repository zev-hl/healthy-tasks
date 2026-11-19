import { useState } from 'react';
import { ExternalLink, MessagesSquare, X } from 'lucide-react';
import { useConnect } from '../../lib/connect';
import { cx } from '../harbor/ui';

/**
 * Connect's chat one click away (Nov 2026 plan, K1): a chat button on every
 * page opening our Connect in a pop-up — the real app in a frame, so calls and
 * every Connect feature work in it — or in its own tab. Shows once HL Central
 * is linked to Connect. Connect must allow HL Central's address to frame it
 * (its `frame-ancestors`); until it does, the pop-up stays blank and "Open in
 * Connect" still works.
 */
export function ConnectChat() {
  const { available, url } = useConnect();
  const [open, setOpen] = useState(false);
  // The frame loads on first open and then stays, so it keeps its place.
  const [loaded, setLoaded] = useState(false);
  if (!available || !url) return null;
  return (
    <>
      <button
        type="button"
        className={cx('hb-chat-fab', open && 'is-open')}
        aria-label={open ? 'Close chat' : 'Open chat (Connect)'}
        aria-expanded={open}
        title="Chat in Connect"
        onClick={() => {
          setOpen((o) => !o);
          setLoaded(true);
        }}
      >
        {open ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <MessagesSquare size={22} aria-hidden="true" />
        )}
      </button>
      {loaded && (
        <section
          className={cx('hb-chat-panel', open && 'is-open')}
          aria-label="Connect chat"
          aria-hidden={!open}
        >
          <header className="hb-chat-head">
            <strong>Connect</strong>
            <span className="hb-grow" />
            <a href={url} target="_blank" rel="noopener noreferrer" className="hb-chat-link">
              <ExternalLink size={14} aria-hidden="true" /> Open in Connect
            </a>
            <button
              type="button"
              className="hb-icon-btn hb-icon-btn-sm"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <iframe
            src={`${url}/`}
            title="Connect"
            allow="camera; microphone; display-capture; clipboard-write; autoplay; fullscreen"
          />
        </section>
      )}
    </>
  );
}
