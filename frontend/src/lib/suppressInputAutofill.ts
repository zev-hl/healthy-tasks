// Browsers show a dropdown of previously-entered values on text inputs (form
// history / autofill). We suppress that app-wide by defaulting every text input
// and textarea to autocomplete="off".
//
// Fields that set their OWN autocomplete are left untouched — that's how the
// sign-in and reset-password inputs (autoComplete="current-password" /
// "new-password" / "username") keep working with password managers. A
// MutationObserver covers inputs that mount later (modals, route changes) and
// any added in the future, so this stays comprehensive without touching each
// input individually.

// Input types with no free-text history to suppress; skipped so we only ever
// touch genuine text-entry fields.
const SKIP_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
  'submit',
  'button',
  'image',
  'reset',
  'hidden',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

function applyTo(el: Element): void {
  const isInput = el instanceof HTMLInputElement;
  if (!isInput && !(el instanceof HTMLTextAreaElement)) return;
  // Respect fields that opt in explicitly (e.g. autoComplete="current-password").
  if (el.hasAttribute('autocomplete')) return;
  if (isInput && SKIP_INPUT_TYPES.has(el.type)) return;
  el.setAttribute('autocomplete', 'off');
}

function scan(root: ParentNode): void {
  root.querySelectorAll('input, textarea').forEach(applyTo);
}

/**
 * Turn off browser autocomplete/history for every text input & textarea in the
 * app (except those that declare their own autocomplete). Idempotent; call once
 * at startup. The observer lives for the app's lifetime by design.
 */
export function suppressInputAutofill(): void {
  if (typeof document === 'undefined') return;
  scan(document.body);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        applyTo(node); // the node itself may be an input/textarea…
        scan(node); // …or contain some.
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
