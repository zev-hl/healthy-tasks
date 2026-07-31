import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import type { TaskUserRef } from '@healthy-tasks/shared';
import { userLabel } from './ui/Avatar';

// @mention autocomplete for the comment editor. Renders a small popup of active
// users; selecting one inserts a mention node that serializes to
// <span data-type="mention" data-id="…">. No popup library — we position a
// plain absolutely-positioned element from the caret rect the plugin provides.

export interface MentionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface MentionListProps {
  items: TaskUserRef[];
  command: (attrs: { id: string; label: string }) => void;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>(function MentionList(props, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [props.items]);

  const choose = (index: number) => {
    const item = props.items[index];
    // Display the person's full name in the saved mention (falls back to email),
    // NOT their job title/role.
    if (item) props.command({ id: item.id, label: userLabel(item) });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (props.items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        choose(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) {
    return <div className="mention-item is-empty">No matching users</div>;
  }

  return (
    <div className="mention-list" role="listbox">
      {props.items.map((user, i) => (
        <button
          type="button"
          key={user.id}
          role="option"
          aria-selected={i === selected}
          className={`mention-item${i === selected ? ' is-selected' : ''}`}
          // mousedown (not click) so the editor doesn't lose focus/selection first.
          onMouseDown={(e) => {
            e.preventDefault();
            choose(i);
          }}
        >
          <span className="mention-item-email">{userLabel(user)}</span>
          {userLabel(user) !== user.email ? (
            <span className="mention-item-title"> · {user.email}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
});

/** Build the TipTap suggestion config, sourcing users from `fetchUsers`. */
export function createMentionSuggestion(
  fetchUsers: (query: string) => Promise<TaskUserRef[]>,
): Omit<SuggestionOptions, 'editor'> {
  return {
    items: async ({ query }) => {
      const users = await fetchUsers(query);
      return users.slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<MentionListRef, MentionListProps> | null = null;
      let popup: HTMLDivElement | null = null;

      const place = (rect: DOMRect | null | undefined) => {
        if (!popup || !rect) return;
        popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
        popup.style.left = `${rect.left + window.scrollX}px`;
      };

      return {
        onStart: (props: SuggestionProps) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items as TaskUserRef[], command: props.command },
            editor: props.editor,
          });
          popup = document.createElement('div');
          popup.className = 'mention-popup';
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props: SuggestionProps) => {
          component?.updateProps({ items: props.items as TaskUserRef[], command: props.command });
          place(props.clientRect?.());
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === 'Escape') {
            popup?.remove();
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}

export type { ReactKeyboardEvent };
