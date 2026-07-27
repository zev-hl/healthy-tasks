import { useMemo } from 'react';
import { useEditor, EditorContent, mergeAttributes } from '@tiptap/react';
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import CharacterCount from '@tiptap/extension-character-count';
import Mention from '@tiptap/extension-mention';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { RICH_TEXT_MAX_CHARS, type TaskUserRef } from '@healthy-tasks/shared';
import { createMentionSuggestion } from './mentionSuggestion';

// Mention node that round-trips <span data-type="mention" data-id data-label>,
// which is exactly what the server sanitizer keeps and parses mentions from.
const MentionNode = Mention.extend({
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id as string } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label as string } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-type': 'mention', class: 'mention' }, HTMLAttributes),
      `@${(node.attrs.label as string) ?? (node.attrs.id as string)}`,
    ];
  },
});

// Toolbar palette. `null` = default (unset color).
const COLORS: { label: string; value: string | null }[] = [
  { label: 'Default', value: null },
  { label: 'Red', value: '#e11d48' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#7c3aed' },
];

interface Props {
  value: string;
  onChange: (html: string) => void;
  withMentions?: boolean;
  /** Provide active users for @mention autocomplete (required if withMentions). */
  mentionFetch?: (query: string) => Promise<TaskUserRef[]>;
  autoFocus?: boolean;
  ariaLabel?: string;
}

export function RichTextEditor({
  value,
  onChange,
  withMentions,
  mentionFetch,
  autoFocus,
  ariaLabel,
}: Props) {
  const extensions = useMemo(() => {
    const list: Extensions = [
      StarterKit.configure({
        // Restrict to the three allowed marks (+ paragraph structure).
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      CharacterCount.configure({ limit: RICH_TEXT_MAX_CHARS }),
    ];
    if (withMentions && mentionFetch) {
      list.push(
        MentionNode.configure({
          HTMLAttributes: { class: 'mention' },
          suggestion: createMentionSuggestion(mentionFetch),
        }),
      );
    }
    return list;
    // mentionFetch is expected to be stable (useCallback in the parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withMentions, mentionFetch]);

  const editor = useEditor({
    extensions,
    content: value,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'rte-content',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
  });

  const used = editor
    ? (editor.storage.characterCount as { characters: () => number }).characters()
    : 0;
  const atLimit = used >= RICH_TEXT_MAX_CHARS;
  const currentColor = (editor?.getAttributes('textStyle').color as string | undefined) ?? null;

  function applyColor(value: string | null) {
    if (!editor) return;
    if (value) editor.chain().focus().setColor(value).run();
    else editor.chain().focus().unsetColor().run();
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <button
          type="button"
          aria-label="Bold"
          className={editor?.isActive('bold') ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          className={editor?.isActive('italic') ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="Underline"
          className={editor?.isActive('underline') ? 'is-active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </button>
        <span className="rte-sep" aria-hidden />
        <span className="rte-colors" role="group" aria-label="Text color">
          {COLORS.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-label={`Text color: ${c.label}`}
              title={c.label}
              className={
                `rte-color${c.value ? '' : ' is-default'}` +
                (currentColor === c.value ? ' is-active' : '')
              }
              style={c.value ? { background: c.value } : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyColor(c.value)}
            >
              {c.value ? '' : 'A'}
            </button>
          ))}
        </span>
        <span className={`rte-count${atLimit ? ' is-limit' : ''}`}>
          {used.toLocaleString()} / {RICH_TEXT_MAX_CHARS.toLocaleString()}
          {atLimit ? ' — limit reached' : ''}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
