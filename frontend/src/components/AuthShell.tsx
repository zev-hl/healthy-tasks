import { type ReactNode } from 'react';

/**
 * Two-panel shell for the signed-out screens (Sign in / Forgot / Reset),
 * matching design frame 1h: a solid teal left panel — brand + serif hero +
 * lede — beside the form on the right. Each page supplies the right-hand form
 * content as children. The left panel collapses on narrow viewports (mobile is
 * out of scope for this design).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-split">
        <aside className="auth-aside">
          <div className="auth-aside-brand">
            <img className="auth-aside-mark" src="/hl-logo.png" alt="" aria-hidden="true" />
            <span className="auth-aside-name">HL Central</span>
          </div>

          <div className="auth-aside-copy">
            <p className="auth-hero">
              What to do, when to do it, and how close you are to smashing your growth goals
              today.
            </p>
            <p className="auth-lede">
              Creativity and excellence are up to you — assigned, dated, and visible. No
              spreadsheet archaeology.
            </p>
          </div>
        </aside>

        <main className="auth-main">
          <div className="auth-form-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
