import type { MouseEvent } from 'react';
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
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'ul', 'ol', 'li', 'a'],
    // `style` is kept for text color; DOMPurify sanitizes the CSS itself, and the
    // server has already restricted it to `color`. `data-checked` carries a task
    // item's state (rendered as a checkbox via CSS). `href` only survives on an
    // Alert Log link (the hook above).
    ALLOWED_ATTR: ['data-type', 'data-id', 'data-label', 'data-checked', 'class', 'style', 'href'],
  });
  return (
    <div
      className={`rich-text${className ? ` ${className}` : ''}`}
      onClick={onClick}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
