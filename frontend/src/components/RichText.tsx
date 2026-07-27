import DOMPurify from 'dompurify';

// Read-only render of server-sanitized rich-text HTML. The server is the
// authoritative sanitizer; we re-sanitize here as defense in depth before using
// dangerouslySetInnerHTML, allowing only the same tags/attributes.
export function RichText({ html, className }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span'],
    // `style` is kept for text color; DOMPurify sanitizes the CSS itself, and the
    // server has already restricted it to `color`.
    ALLOWED_ATTR: ['data-type', 'data-id', 'data-label', 'class', 'style'],
  });
  return (
    <div
      className={`rich-text${className ? ` ${className}` : ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
