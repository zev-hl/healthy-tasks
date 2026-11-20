import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { askConfirm, type ConfirmOptions } from '../components/ui/confirm';

/** What the user is asked before unsaved changes are thrown away. */
export const UNSAVED_CHANGES_MESSAGE =
  'You have changes that aren’t saved. If you go on, they are lost.';

const DISCARD_QUESTION: ConfirmOptions = {
  title: 'Discard your changes?',
  message: UNSAVED_CHANGES_MESSAGE,
  confirmLabel: 'Discard changes',
  cancelLabel: 'Keep editing',
};

/**
 * Throw away what is on screen, asking first when something changed: runs
 * `then` straight away when nothing changed, or once the user says to discard.
 * For a modal's Cancel and a click outside it, which ask the same question as
 * leaving the page.
 */
export function confirmDiscard(dirty: boolean, then: () => void): void {
  if (!dirty) {
    then();
    return;
  }
  void askConfirm(DISCARD_QUESTION).then((ok) => {
    if (ok) then();
  });
}

/**
 * Warn the user about unsaved changes when leaving, in two ways while `when` is
 * true:
 *  - Full-page unloads (refresh, tab close, navigating to another site): the
 *    browser's native "Leave site?" confirmation via `beforeunload` (the
 *    browser allows no other).
 *  - In-app SPA navigation (clicking a link, back/forward): React Router's
 *    `useBlocker` pauses the navigation and the app's own dialog asks first.
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
  const asking = useRef(false);

  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    void askConfirm({
      ...DISCARD_QUESTION,
      title: 'Leave without saving?',
      confirmLabel: 'Leave page',
      cancelLabel: 'Stay',
    }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker]);
}
