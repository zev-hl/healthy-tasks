import sanitizeHtml from 'sanitize-html';
import { RICH_TEXT_MAX_CHARS } from '@healthy-tasks/shared';
import { HttpError } from './http-error.js';

// Rich text (Phase 4) is stored as sanitized HTML. We allow ONLY bold/italic/
// underline plus paragraph/line-break structure — and, for comments, a
// restricted mention <span>. Everything else (scripts, styles, event handlers,
// links, images, arbitrary attributes) is stripped. The server is the source of
// truth: all HTML is run through sanitizeRichText on write, never trusting the
// client.

const BASE_ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span'];

// Only the `color` CSS property is permitted, and only as a hex, rgb(a), or
// named color — no url(), no other properties. sanitize-html drops anything else.
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: [
      /^#(0x)?[0-9a-fA-F]{3,8}$/,
      /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
      /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/,
      /^[a-zA-Z]+$/, // named colors, e.g. "red"
    ],
  },
};

export interface SanitizeOptions {
  /** Allow the mention <span data-type="mention" data-id="…"> node (comments). */
  allowMentions?: boolean;
}

/**
 * Sanitize untrusted rich-text HTML down to the allowed marks: bold/italic/
 * underline, paragraph structure, text color (via `<span style="color:…">`),
 * and — for comments — the mention span.
 */
export function sanitizeRichText(html: string, opts: SanitizeOptions = {}): string {
  if (!opts.allowMentions) {
    return sanitizeHtml(html, {
      allowedTags: BASE_ALLOWED_TAGS,
      allowedAttributes: { span: ['style'] },
      allowedStyles: ALLOWED_STYLES,
      allowedSchemes: [],
      disallowedTagsMode: 'discard',
    });
  }

  return sanitizeHtml(html, {
    allowedTags: BASE_ALLOWED_TAGS,
    allowedAttributes: { span: ['data-type', 'data-id', 'data-label', 'class', 'style'] },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
    transformTags: {
      // Normalize genuine mention spans (data-type="mention" + data-id). Any
      // other <span> keeps only its style (color), with data-* stripped so it
      // can't spoof a mention.
      span: (_tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag => {
        const dataId = attribs['data-id'];
        if (attribs['data-type'] === 'mention' && dataId) {
          return {
            tagName: 'span',
            attribs: {
              'data-type': 'mention',
              'data-id': dataId,
              'data-label': attribs['data-label'] ?? '',
              class: 'mention',
            },
          };
        }
        const kept: sanitizeHtml.Attributes = {};
        if (attribs['style']) kept['style'] = attribs['style']; // filtered by allowedStyles
        return { tagName: 'span', attribs: kept };
      },
    },
  });
}

/**
 * Length of the human-visible text CONTENT (markup stripped), used to enforce
 * the character limit. Entities are decoded so the count matches what a user
 * sees rather than the escaped source.
 */
export function richTextLength(html: string): number {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return decoded.length;
}

/**
 * Sanitize AND enforce the character limit, throwing a clear 400 if exceeded.
 * Returns the sanitized HTML (or null for empty content).
 */
export function sanitizeAndValidate(
  html: string,
  opts: SanitizeOptions & { fieldLabel?: string } = {},
): string {
  const clean = sanitizeRichText(html, opts);
  const length = richTextLength(clean);
  if (length > RICH_TEXT_MAX_CHARS) {
    throw HttpError.badRequest(
      `${opts.fieldLabel ?? 'Content'} is too long (${length.toLocaleString()} characters; the limit is ${RICH_TEXT_MAX_CHARS.toLocaleString()}).`,
    );
  }
  return clean;
}

/**
 * Extract the set of user ids referenced by mention nodes in sanitized HTML.
 * Only mention spans retain a data-id after sanitizeRichText, so a global scan
 * for data-id is safe; callers still validate the ids against active users.
 */
export function extractMentionUserIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /data-id="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}
