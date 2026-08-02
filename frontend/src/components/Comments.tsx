import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentDto, TaskDetailDto, TaskUserRef, UserDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichTextEditor } from './RichTextEditor';
import { RichText } from './RichText';
import { AttachmentSection } from './AttachmentSection';
import { Avatar, userLabel } from './ui/Avatar';
import { EmptyState } from './ui/EmptyState';
import { TimeStamp } from './ui/TimeStamp';

interface Props {
  task: TaskDetailDto;
  currentUser: UserDto;
  onChanged: (task: TaskDetailDto) => void;
  /** Reports whether there's an in-progress draft (new comment or an edit). */
  onDirtyChange?: (dirty: boolean) => void;
}

export function Comments({ task, currentUser, onChanged, onDirtyChange }: Props) {
  const [composerKey, setComposerKey] = useState(0);
  const [composerBody, setComposerBody] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // @mention autocomplete source (Phase 13): the task's mention-candidate pool —
  // all active users for a normal task, or only its visibility set for a Private
  // task. Fetched once per task, then filtered locally. Stable identity so the
  // editor isn't rebuilt on each keystroke.
  const usersRef = useRef<TaskUserRef[] | null>(null);
  const taskId = task.id;
  const mentionFetch = useCallback(
    async (query: string): Promise<TaskUserRef[]> => {
      if (!usersRef.current) {
        try {
          usersRef.current = await api.getMentionCandidates(taskId);
        } catch {
          usersRef.current = [];
        }
      }
      const list = usersRef.current ?? [];
      const q = query.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (u) => u.email.toLowerCase().includes(q) || (u.title ?? '').toLowerCase().includes(q),
      );
    },
    [taskId],
  );

  const isAuthor = (c: CommentDto) => c.author.id === currentUser.id;

  // Report an in-progress draft (a new comment being written, or an edit whose
  // text has changed) so the page's unsaved-changes guard can include it.
  const editingOriginal =
    editingId !== null ? (task.comments.find((c) => c.id === editingId)?.body ?? '') : '';
  const commentsDirty =
    composerBody.trim() !== '' || (editingId !== null && editBody !== editingOriginal);
  useEffect(() => {
    onDirtyChange?.(commentsDirty);
  }, [commentsDirty, onDirtyChange]);

  async function submitComment() {
    if (composerBody.trim() === '') return;
    setSubmitting(true);
    setError(null);
    try {
      onChanged(await api.createComment(task.id, { body: composerBody }));
      setComposerBody('');
      setComposerKey((k) => k + 1); // remount to clear the editor
      setComposerOpen(false); // collapse back to the single-line prompt
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post comment');
    } finally {
      setSubmitting(false);
    }
  }

  function cancelComposer() {
    setComposerBody('');
    setComposerKey((k) => k + 1); // remount to clear the editor
    setComposerOpen(false);
  }

  function startEdit(c: CommentDto) {
    setEditingId(c.id);
    setEditBody(c.body);
    setError(null);
  }

  async function saveEdit(c: CommentDto) {
    if (editBody.trim() === '') return;
    setSavingEdit(true);
    setError(null);
    try {
      onChanged(await api.updateComment(c.id, { body: editBody }));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save comment');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteComment(c: CommentDto) {
    if (!window.confirm('Delete this comment?')) return;
    setError(null);
    try {
      onChanged(await api.deleteComment(c.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete comment');
    }
  }

  const composerActive = composerBody.trim() !== '';

  return (
    <div className="comments">
      {error && <div className="alert error">{error}</div>}

      {/* Tree-inherited (read-only) viewers can read comments but not add them. */}
      {task.access === 'tree' ? (
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>
          You have read-only access to this task, so you can’t add comments.
        </p>
      ) : (
      <div className="comment-composer">
        {composerOpen ? (
          <>
            <RichTextEditor
              key={`composer-${composerKey}`}
              value=""
              onChange={setComposerBody}
              withMentions
              mentionFetch={mentionFetch}
              ariaLabel="New comment"
              autoFocus
            />
            <div className="btn-row">
              <button type="button" disabled={submitting || !composerActive} onClick={submitComment}>
                {submitting ? 'Saving…' : 'Comment'}
              </button>
              <button type="button" className="secondary" onClick={cancelComposer}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="comment-composer-stub"
            onClick={() => setComposerOpen(true)}
          >
            Add a comment…
          </button>
        )}
      </div>
      )}

      {task.comments.length === 0 ? (
        <EmptyState compact title="No comments yet">
          Start the conversation — add the first comment above.
        </EmptyState>
      ) : (
        <ul className="comment-list">
          {task.comments.map((c) => (
            <li key={c.id} className="comment">
              <div className="comment-head">
                <Avatar user={c.author} size="xs" decorative />
                <span className="comment-author">{userLabel(c.author)}</span>
                <span className="muted comment-time">
                  <TimeStamp iso={c.editedAt ?? c.createdAt} />
                  {c.editedAt ? ' (edited)' : ''}
                </span>
              </div>

              {editingId === c.id ? (
                <div className="comment-edit">
                  <RichTextEditor
                    key={`edit-${c.id}`}
                    value={editBody}
                    onChange={setEditBody}
                    withMentions
                    mentionFetch={mentionFetch}
                    ariaLabel="Edit comment"
                  />
                  <div className="btn-row">
                    <button type="button" disabled={savingEdit} onClick={() => saveEdit(c)}>
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <RichText html={c.body} className="comment-body" />
                  <div className="comment-attachments">
                    <AttachmentSection
                      attachments={c.attachments}
                      target={{ kind: 'comment', commentId: c.id }}
                      canUpload={isAuthor(c)}
                      currentUser={currentUser}
                      onChanged={onChanged}
                    />
                  </div>
                  {isAuthor(c) && (
                    <div className="btn-row comment-actions">
                      <button type="button" className="secondary" onClick={() => startEdit(c)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => deleteComment(c)}>
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
