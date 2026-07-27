import { useEffect } from 'react';

/**
 * Warn the user before the page is unloaded — browser refresh, tab close, or
 * navigating away to another site — while `when` is true (there are unsaved
 * changes). The browser shows its native "Leave site? Changes you made may not
 * be saved." confirmation.
 *
 * Note: this covers full-page unloads. It does not intercept in-app SPA link
 * navigation (that would require React Router's data-router `useBlocker`).
 */
export function useUnsavedChangesWarning(when: boolean): void {
  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome/Safari to actually show the confirmation prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);
}
