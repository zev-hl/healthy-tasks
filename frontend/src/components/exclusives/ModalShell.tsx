/**
 * The shared shape of every Exclusives modal (HLAI-71 Chunk 9, ticket 2).
 *
 * Taken from the supplied design: a small coloured dot before the title, the
 * explanation beneath it, room for a highlighted detail card, and a footer band
 * carrying a plain-language hint on the left with the buttons on the right.
 *
 * Presentational on purpose. Each modal keeps its own behaviour — whether
 * clicking away dismisses it, what Escape does — because those differ and
 * should stay visible at the call site.
 */
import { useId, type ReactNode } from 'react';

export type ModalTone = 'warn' | 'danger' | 'accent' | 'neutral';

const DOT: Record<ModalTone, string> = {
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
  neutral: 'var(--faint-2)',
};

export function ModalShell({
  title,
  tone = 'accent',
  children,
  hint,
  actions,
  onBackdropClick,
  role = 'dialog',
  width,
}: {
  title: string;
  /** Colour of the dot before the title. */
  tone?: ModalTone;
  children: ReactNode;
  /** Quiet line on the left of the footer, explaining the rule behind the choice. */
  hint?: ReactNode;
  /** The buttons, in reading order. Omit for a modal that needs no footer. */
  actions?: ReactNode;
  /** Left out entirely when clicking away must not dismiss. */
  onBackdropClick?: () => void;
  role?: 'dialog' | 'alertdialog';
  /** For the wider ones, such as the import preview. */
  width?: string;
}) {
  const titleId = useId();

  return (
    <div className="modal-backdrop" onClick={onBackdropClick}>
      <div
        className="modal exc-confirm exc-modal"
        style={width ? { width, maxWidth: 'none' } : undefined}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="exc-confirm-body">
          <h2 className="exc-confirm-title exc-modal-title" id={titleId}>
            <span className="exc-modal-dot" style={{ background: DOT[tone] }} aria-hidden="true" />
            {title}
          </h2>
          {children}
        </div>
        {(hint || actions) && (
          <div className="exc-confirm-foot exc-modal-foot">
            {hint ? <span className="exc-modal-hint">{hint}</span> : <span />}
            <span className="exc-modal-actions">{actions}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The highlighted card inside a modal: the thing being talked about, set apart
 * from the prose so it can be checked at a glance.
 */
export function ModalDetailCard({
  tone = 'warn',
  children,
}: {
  tone?: ModalTone;
  children: ReactNode;
}) {
  return <div className={`exc-modal-card ${tone}`}>{children}</div>;
}
