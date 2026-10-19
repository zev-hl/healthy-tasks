import { useRef, type MouseEvent } from 'react';

/**
 * Props for a modal's backdrop `<div>`: close on a genuine click on the
 * backdrop itself, and never while `blocked` (the modal holds unsaved edits).
 *
 * "Genuine" means the press AND the release both landed on the backdrop. A
 * plain `onClick` also fires when someone selects text in a field and lets go
 * of the mouse outside the modal — the browser targets that click at the
 * backdrop — which silently threw away whatever was being typed.
 */
export function useBackdropDismiss(onDismiss: () => void, blocked = false) {
  const pressedOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressedOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const genuine = pressedOnBackdrop.current && e.target === e.currentTarget;
      pressedOnBackdrop.current = false;
      if (genuine && !blocked) onDismiss();
    },
  };
}
