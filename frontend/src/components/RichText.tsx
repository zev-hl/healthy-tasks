import { useEffect, useRef, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { isAlertLogHref } from '@healthy-tasks/shared';

// HLAI-112: the only link rich text may hold opens the Alert Log (the Daily
// alert task's "View these alerts"); any other <a> loses its address here too.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && !isAlertLogHref(node.getAttribute('href') ?? '')) {
    node.removeAttribute('href');
  }
});

interface Props {
  html: string;
  className?: string;
}

// Read-only render of server-sanitized rich-text HTML. The server is the
// authoritative sanitizer; we re-sanitize here as defense in depth before using
// dangerouslySetInnerHTML, allowing only the same tags/attributes.
export function RichText(props: Props) {
  // In the app, an Alert Log link opens in place (no page reload).
  return useInRouterContext() ? <RoutedRichText {...props} /> : <RichTextBody {...props} />;
}

function RoutedRichText(props: Props) {
  const navigate = useNavigate();
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const href = (e.target as HTMLElement).closest('a')?.getAttribute('href');
    // A new-tab click (Ctrl/⌘, middle button) is left to the browser.
    if (
      !href ||
      !isAlertLogHref(href) ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    navigate(href);
  }
  return <RichTextBody {...props} onClick={onClick} />;
}

function RichTextBody({
  html,
  className,
  onClick,
}: Props & { onClick?: (e: MouseEvent<HTMLDivElement>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      ...['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'ul', 'ol', 'li', 'a'],
      ...['table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ],
    // `style` is kept for text color; DOMPurify sanitizes the CSS itself, and the
    // server has already restricted it to `color`. `data-checked` carries a task
    // item's state (rendered as a checkbox via CSS). `href` only survives on an
    // Alert Log link (the hook above). A table cell keeps how far it spans.
    ALLOWED_ATTR: [
      ...['data-type', 'data-id', 'data-label', 'data-checked', 'class', 'style', 'href'],
      ...['colspan', 'rowspan'],
    ],
  });
  // A table's long last-column cells fold to a few lines (see foldLongCells).
  useEffect(() => (ref.current ? foldLongCells(ref.current) : undefined), [clean]);

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const toggle = (e.target as HTMLElement).closest('.rt-fold-toggle');
    if (toggle) {
      e.preventDefault();
      setFolded(toggle, !toggle.closest('td')?.classList.contains('is-open'));
      return;
    }
    onClick?.(e);
  }

  return (
    <div
      ref={ref}
      className={`rich-text${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

// --- Long cells in a table's last column ------------------------------------------
// HLAI-112: a Daily alert task's table ends with each alert's description, which
// can run to several hundred characters. In any table, a last-column cell longer
// than FOLD_LINES lines shows that many, ending in "…", with an arrow that opens
// it in full and folds it back. Display only: what is stored stays as written.

/** How many lines a long last-column cell shows while folded (see styles.css). */
export const FOLD_LINES = 3;

const CHEVRON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 9l6 6 6-6"/></svg>';

/** Open (`open`) or fold back the cell this arrow belongs to. */
function setFolded(toggle: Element, open: boolean) {
  toggle.closest('td')?.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Show less' : 'Show all');
  toggle.setAttribute('title', open ? 'Show less' : 'Show all');
}

/**
 * Give every last-column cell of `root`'s tables a box that folds at FOLD_LINES
 * lines, and an arrow on those whose text is longer. Re-measured when the width
 * changes (text wraps differently). Returns the clean-up.
 */
function foldLongCells(root: HTMLElement): (() => void) | undefined {
  const cells = [...root.querySelectorAll('tr')]
    .map((tr) => tr.lastElementChild)
    .filter(
      (c): c is HTMLTableCellElement => c instanceof HTMLTableCellElement && c.tagName === 'TD',
    );
  if (cells.length === 0) return undefined;
  for (const cell of cells) {
    // Once per cell: React may run this twice over the same HTML (Strict Mode).
    if (cell.classList.contains('rt-fold')) continue;
    const text = document.createElement('div');
    text.className = 'rt-fold-text';
    while (cell.firstChild) text.appendChild(cell.firstChild);
    cell.appendChild(text);
    cell.classList.add('rt-fold');
  }

  const measure = () => {
    for (const cell of cells) {
      if (cell.classList.contains('is-open')) continue; // open: keep its arrow
      const text = cell.querySelector(':scope > .rt-fold-text') as HTMLElement;
      const long = text.scrollHeight > text.clientHeight + 1;
      const toggle = cell.querySelector(':scope > .rt-fold-toggle');
      if (long && !toggle) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-plain rt-fold-toggle';
        button.innerHTML = CHEVRON;
        cell.appendChild(button);
        setFolded(button, false);
      } else if (!long && toggle) {
        toggle.remove();
      }
    }
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return undefined;
  const observer = new ResizeObserver(() => measure());
  observer.observe(root);
  return () => observer.disconnect();
}
