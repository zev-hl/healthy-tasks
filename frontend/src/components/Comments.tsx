import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COMMENT_MAX_ATTACHMENTS,
  type CommentDto,
  type ConfirmAttachmentRequest,
  type TaskDetailDto,
  type TaskUserRef,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError, uploadToStorage } from '../api/client';
import { attachmentProblem, fileIcon, humanSize, sameFile } from '../lib/attachmentFile';
import { RichTextEditor } from './RichTextEditor';
import { RichText } from './RichText';
import { AttachmentSection } from './AttachmentSection';
import { Avatar, userLabel } from './ui/Avatar';
import { ConfirmDialog } from './ui/ConfirmDialog';
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
  // Files chosen for the comment being written. They are not uploaded until
  // Comment is pressed, so backing out leaves nothing behind in storage.
  const [pending, setPending] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** The comment awaiting confirmation, if the delete dialog is open. */
  const [confirmingDelete, setConfirmingDelete] = useState<CommentDto | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    composerBody.trim() !== '' ||
    pending.length > 0 ||
    (editingId !== null && editBody !== editingOriginal);
  useEffect(() => {
    onDirtyChange?.(commentsDirty);
  }, [commentsDirty, onDirtyChange]);

  /**
   * Add picked files to the pending list, saying why any of them can't go.
   *
   * Every rejection is reported, including picking the same file twice —
   * silently dropping it looks exactly like the attach button being broken.
   */
  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const next = [...pending];
    const problems: string[] = [];
    for (const file of Array.from(picked)) {
      if (next.length >= COMMENT_MAX_ATTACHMENTS) {
        problems.push(`A comment can carry at most ${COMMENT_MAX_ATTACHMENTS} files.`);
        break;
      }
      const problem = attachmentProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      if (next.some((f) => sameFile(f, file))) {
        problems.push(`"${file.name}" is already attached to this comment.`);
        continue;
      }
      next.push(file);
    }
    setPending(next);
    setError(problems[0] ?? null);
  }

  function removeFile(file: File) {
    setPending((current) => current.filter((f) => !sameFile(f, file)));
  }

  /**
   * Post the comment and its files as ONE record.
   *
   * The bytes go to storage first, straight from the browser — our API never
   * carries them. Only then does a single call write the comment and its
   * attachment rows in one transaction, and if that write fails the server
   * removes what was uploaded, so a half-saved comment is never left behind.
   */
  async function submitComment() {
    const hasText = composerBody.trim() !== '';
    if (!hasText && pending.length === 0) return;
    setSubmitting(true);
    setError(null);
    let staged: ConfirmAttachmentRequest[] = [];
    try {
      staged = await stageFiles();
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof ApiError
          ? err.fullMessage
          : 'Could not upload the attachment. Check your connection and try again.',
      );
      return;
    }
    try {
      onChanged(
        await api.createComment(task.id, {
          body: hasText ? composerBody : undefined,
          attachments: staged.length > 0 ? staged : undefined,
        }),
      );
      setComposerBody('');
      setPending([]);
      setComposerKey((k) => k + 1); // remount to clear the editor
      setComposerOpen(false); // collapse back to the single-line prompt
    } catch (err) {
      setError(err instanceof ApiError ? err.fullMessage : 'Could not post comment');
    } finally {
      setSubmitting(false);
    }
  }

  /** Upload each pending file and return what the server needs to link them. */
  async function stageFiles(): Promise<ConfirmAttachmentRequest[]> {
    const staged: ConfirmAttachmentRequest[] = [];
    for (const file of pending) {
      const meta = { filename: file.name, contentType: file.type, size: file.size };
      const { uploadUrl, storageKey } = await api.presignCommentDraftAttachment(task.id, meta);
      await uploadToStorage(uploadUrl, file);
      staged.push({ ...meta, storageKey });
    }
    return staged;
  }

  function cancelComposer() {
    setComposerBody('');
    setPending([]);
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
    setError(null);
    setDeleting(true);
    try {
      onChanged(await api.deleteComment(c.id));
      setConfirmingDelete(null);
    } catch (err) {
      setConfirmingDelete(null);
      setError(err instanceof ApiError ? err.fullMessage : 'Could not delete comment');
    } finally {
      setDeleting(false);
    }
  }

  // Either half is enough to post: text alone, files alone, or both.
  const composerActive = composerBody.trim() !== '' || pending.length > 0;

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
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = ''; // so the same file can be picked again
                }}
              />
              <div className="composer-attach">
                <button
                  type="button"
                  className="secondary composer-attach-btn"
                  disabled={submitting || pending.length >= COMMENT_MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎 {pending.length === 0 ? 'Attach File' : 'Add more files'}
                </button>
                <span className="muted composer-attach-hint">
                  {pending.length}/{COMMENT_MAX_ATTACHMENTS} · up to 25 MB each
                </span>
              </div>

              {pending.length > 0 && (
                <ul className="composer-files">
                  {pending.map((file) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <span aria-hidden>{fileIcon(file.type)}</span>
                      <span className="composer-file-name">{file.name}</span>
                      <span className="muted composer-file-size">{humanSize(file.size)}</span>
                      <button
                        type="button"
                        className="rel-x"
                        aria-label={`Remove ${file.name}`}
                        disabled={submitting}
                        onClick={() => removeFile(file)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="btn-row">
                <button
                  type="button"
                  disabled={submitting || !composerActive}
                  onClick={submitComment}
                >
                  {submitting ? 'Saving…' : 'Comment'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={submitting}
                  onClick={cancelComposer}
                >
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
                    <button type="button" className="secondary" onClick={() => setEditingId(null)}>
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
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmingDelete(c)}
                      >
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

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this comment?"
          message={
            confirmingDelete.attachments.length > 0
              ? `Its ${confirmingDelete.attachments.length} file${
                  confirmingDelete.attachments.length === 1 ? '' : 's'
                } are removed from storage too. This cannot be undone.`
              : 'This cannot be undone.'
          }
          busy={deleting}
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={() => void deleteComment(confirmingDelete)}
        />
      )}
    </div>
  );
}
