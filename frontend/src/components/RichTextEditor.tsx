import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, mergeAttributes } from '@tiptap/react';
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import CharacterCount from '@tiptap/extension-character-count';
import Mention from '@tiptap/extension-mention';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { RICH_TEXT_MAX_CHARS, type TaskUserRef } from '@healthy-tasks/shared';
import { createMentionSuggestion } from './mentionSuggestion';

// Task-list item that serializes to a compact `<li data-type="taskItem"
// data-checked="…">` (the `checked` attribute already renders data-checked).
// We deliberately drop TipTap's default <label><input> markup from the stored
// HTML so the server sanitizer never has to allow form controls — the read-only
// renderer draws the checkbox from data-checked via CSS. The in-editor checkbox
// still works: it comes from TaskItem's nodeView, not from renderHTML.
const CompactTaskItem = TaskItem.extend({
  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { 'data-type': 'taskItem' }), 0];
  },
});

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

// Small line icons for the list menu (stroke = currentColor so they inherit the
// toolbar's text color / active state).
const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
const BulletIcon = (
  <svg {...iconProps} aria-hidden>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
const NumberedIcon = (
  <svg {...iconProps} aria-hidden>
    <line x1="10" y1="6" x2="20" y2="6" />
    <line x1="10" y1="12" x2="20" y2="12" />
    <line x1="10" y1="18" x2="20" y2="18" />
    <text x="1.5" y="8" fontSize="7" fill="currentColor" stroke="none">1</text>
    <text x="1.5" y="14" fontSize="7" fill="currentColor" stroke="none">2</text>
    <text x="1.5" y="20" fontSize="7" fill="currentColor" stroke="none">3</text>
  </svg>
);
const TaskIcon = (
  <svg {...iconProps} aria-hidden>
    <rect x="3" y="4" width="5.5" height="5.5" rx="1.2" />
    <path d="M4.2 6.7l1 1 1.8-2.1" strokeWidth="1.6" />
    <rect x="3" y="14.5" width="5.5" height="5.5" rx="1.2" />
    <line x1="11.5" y1="6.75" x2="20" y2="6.75" />
    <line x1="11.5" y1="17.25" x2="20" y2="17.25" />
  </svg>
);

// List types offered by the toolbar menu (in display order).
const LIST_ITEMS: { kind: 'bullet' | 'ordered' | 'task'; label: string; icon: JSX.Element }[] = [
  { kind: 'bullet', label: 'Bulleted list', icon: BulletIcon },
  { kind: 'ordered', label: 'Numbered list', icon: NumberedIcon },
  { kind: 'task', label: 'Task list', icon: TaskIcon },
];

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
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const listMenuRef = useRef<HTMLSpanElement>(null);

  // Close the list menu on an outside click or Escape.
  useEffect(() => {
    if (!listMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (listMenuRef.current && !listMenuRef.current.contains(e.target as Node)) {
        setListMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setListMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [listMenuOpen]);

  const extensions = useMemo(() => {
    const list: Extensions = [
      StarterKit.configure({
        // Restrict to the allowed marks/blocks: bold/italic/underline, paragraph
        // structure, and bullet/ordered lists (list-item enabled). Task lists are
        // added separately below.
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      TaskList,
      CompactTaskItem.configure({ nested: true }),
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

  // Current list type for the toolbar dropdown, and a setter that switches to (or
  // clears) the chosen type. toggleX handles conversion between list types.
  const listType = editor?.isActive('taskList')
    ? 'task'
    : editor?.isActive('orderedList')
      ? 'ordered'
      : editor?.isActive('bulletList')
        ? 'bullet'
        : 'none';

  function setListType(kind: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (kind === 'bullet') chain.toggleBulletList();
    else if (kind === 'ordered') chain.toggleOrderedList();
    else if (kind === 'task') chain.toggleTaskList();
    else if (editor.isActive('bulletList')) chain.toggleBulletList();
    else if (editor.isActive('orderedList')) chain.toggleOrderedList();
    else if (editor.isActive('taskList')) chain.toggleTaskList();
    chain.run();
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
        <span className="rte-listmenu" ref={listMenuRef}>
          <button
            type="button"
            className={`rte-listbtn${listType !== 'none' ? ' is-active' : ''}`}
            aria-label="List"
            aria-haspopup="menu"
            aria-expanded={listMenuOpen}
            title="List"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setListMenuOpen((o) => !o)}
          >
            {BulletIcon}
            <span className="rte-listcaret" aria-hidden>▾</span>
          </button>
          {listMenuOpen && (
            <div className="rte-listpop" role="menu">
              {LIST_ITEMS.map((it) => (
                <button
                  key={it.kind}
                  type="button"
                  role="menuitem"
                  className={`rte-listopt${listType === it.kind ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setListType(it.kind);
                    setListMenuOpen(false);
                  }}
                >
                  <span className="rte-listopt-icon">{it.icon}</span>
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </span>
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
