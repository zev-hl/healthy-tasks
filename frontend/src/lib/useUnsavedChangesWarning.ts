import { useCallback, useEffect } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';

/** What the user is asked before unsaved changes are thrown away. */
export const UNSAVED_CHANGES_MESSAGE =
  'You have unsaved changes. Leave this page and discard them?';

/**
 * Whether what is on screen may be thrown away: nothing changed, or the user
 * said OK. For a modal's Cancel and a click outside it, which ask the same
 * question as leaving the page.
 */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm(UNSAVED_CHANGES_MESSAGE);
}

/**
 * Warn the user about unsaved changes when leaving, in two ways while `when` is
 * true:
 *  - Full-page unloads (refresh, tab close, navigating to another site): the
 *    browser's native "Leave site?" confirmation via `beforeunload`.
 *  - In-app SPA navigation (clicking a link, back/forward): React Router's
 *    `useBlocker` pauses the navigation and asks for confirmation first.
 *
 * Requires a data router (RouterProvider) for the in-app half.
 */
export function useUnsavedChangesWarning(when: boolean): void {
  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // required for Chrome/Safari to show the prompt
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
    [when],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const leave = window.confirm(UNSAVED_CHANGES_MESSAGE);
    if (leave) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
}
