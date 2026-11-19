import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COMMENT_MAX_ATTACHMENTS,
  type AttachmentDto,
  type CommentDto,
  type RecordingKind,
  type ConfirmAttachmentRequest,
  type TaskDetailDto,
  type TaskUserRef,
  type UserDto,
  isViewOnlyAccess,
} from '@healthy-tasks/shared';
import { api, ApiError, uploadToStorage } from '../api/client';
import { attachmentProblem, humanSize, sameFile } from '../lib/attachmentFile';
import { FileTile } from './ui/FileTile';
import { RichTextEditor } from './RichTextEditor';
import { RichText } from './RichText';
import { AttachmentSection } from './AttachmentSection';
import { Avatar, userLabel } from './ui/Avatar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EmptyState } from './ui/EmptyState';
import { TimeStamp } from './ui/TimeStamp';
import { ChevronDown, ChevronUp, Paperclip, Search } from 'lucide-react';
import { CommentRecorder, RecordingPlayer, type Recording } from './CommentRecorder';

/** A posted recording: fetches its link, then the player (D4). */
function PostedRecording({ attachment: a }: { attachment: AttachmentDto }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getAttachmentDownloadUrl(a.id)
      .then((r) => alive && setUrl(r.url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [a.id]);
  return (
    <RecordingPlayer
      url={url}
      kind={a.recording!}
      transcript={a.transcript}
      durationMs={a.durationMs}
    />
  );
}

/** The text of a comment's HTML, for search and to tell an empty draft. */
export function plainText(html: string): string {
  if (!html) return '';
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim();
}

// An unsent comment is kept on this browser (Nov 2026 plan, D4a): per person
// and task, text only (files picked for it are not kept).
const draftKey = (userId: string, taskId: number) => `hb-comment-draft:${userId}:${taskId}`;
function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(key: string, html: string) {
  try {
    if (plainText(html)) localStorage.setItem(key, html);
    else localStorage.removeItem(key);
  } catch {
    /* not kept */
  }
}

interface Props {
  task: TaskDetailDto;
  currentUser: UserDto;
  onChanged: (task: TaskDetailDto) => void;
  /** Reports whether there's an in-progress draft (new comment or an edit). */
  onDirtyChange?: (dirty: boolean) => void;
}

export function Comments({ task, currentUser, onChanged, onDirtyChange }: Props) {
  const [composerKey, setComposerKey] = useState(0);
  const draftId = draftKey(currentUser.id, task.id);
  const [composerBody, setComposerBody] = useState(() => readDraft(draftId));
  // The draft the editor opens with (it takes its starting text once).
  const [composerStart, setComposerStart] = useState(composerBody);
  const hasDraft = plainText(composerBody) !== '';
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Files chosen for the comment being written. They are not uploaded until
  // Comment is pressed, so backing out leaves nothing behind in storage.
  const [pending, setPending] = useState<File[]>([]);
  // D4: what a recorded file is (voice / screen), its length and transcript.
  const [recMeta, setRecMeta] = useState<
    Map<File, { kind: RecordingKind; durationMs: number; transcript: string | null }>
  >(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** The comment awaiting confirmation, if the delete dialog is open. */
  const [confirmingDelete, setConfirmingDelete] = useState<CommentDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Quick filters on a long thread (meeting decision, Nov 11).
  const [show, setShow] = useState<'all' | 'mentions' | 'files'>('all');
  const mentionsMe = (c: CommentDto) =>
    (c.mentionedUsers ?? []).some((u) => u.id === currentUser.id);
  const hasFiles = (c: CommentDto) => (c.attachments ?? []).length > 0;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shownComments = task.comments.filter(
    (c) =>
      (show === 'mentions' ? mentionsMe(c) : show === 'files' ? hasFiles(c) : true) &&
      (!q ||
        plainText(c.body).toLowerCase().includes(q) ||
        userLabel(c.author).toLowerCase().includes(q) ||
        (c.attachments ?? []).some(
          (a) =>
            a.filename.toLowerCase().includes(q) || (a.transcript ?? '').toLowerCase().includes(q),
        )),
  );

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

  // Search (D3): the matches are highlighted in the comments, and ‹ › step
  // between them. Done with the browser's highlight API, so the comments'
  // own HTML is never rewritten; without it, the matching comments still show.
  const listRef = useRef<HTMLUListElement>(null);
  const [matches, setMatches] = useState<Range[]>([]);
  const [hit, setHit] = useState(0);
  useEffect(() => {
    const root = listRef.current;
    const found: Range[] = [];
    if (root && q) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? '').toLowerCase();
        for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + q.length);
          found.push(r);
        }
      }
    }
    setMatches(found);
    setHit(0);
  }, [q, task.comments, show]);
  useEffect(() => {
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !H) return;
    if (matches.length === 0) {
      reg.delete('hb-csearch');
      reg.delete('hb-csearch-now');
      return;
    }
    reg.set('hb-csearch', new H(...matches));
    const now = matches[hit];
    if (now) {
      reg.set('hb-csearch-now', new H(now));
      now.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return () => {
      reg.delete('hb-csearch');
      reg.delete('hb-csearch-now');
    };
  }, [matches, hit]);
  const step = (d: 1 | -1) =>
    setHit((h) => (matches.length ? (h + d + matches.length) % matches.length : 0));

  // Report an in-progress draft (a new comment being written, or an edit whose
  // text has changed) so the page's unsaved-changes guard can include it.
  const editingOriginal =
    editingId !== null ? (task.comments.find((c) => c.id === editingId)?.body ?? '') : '';
  // The comment's text is kept on this browser, so only its files and an edit count.
  const commentsDirty = pending.length > 0 || (editingId !== null && editBody !== editingOriginal);
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
    setRecMeta((m) => {
      const n = new Map(m);
      n.delete(file);
      return n;
    });
  }

  /** A voice note or screen recording from the comment box (D4). */
  function addRecording(r: Recording) {
    const problem = attachmentProblem(r.file);
    if (problem) {
      setError(problem);
      return;
    }
    if (pending.length >= COMMENT_MAX_ATTACHMENTS) {
      setError(`A comment can carry at most ${COMMENT_MAX_ATTACHMENTS} files.`);
      return;
    }
    setPending((p) => [...p, r.file]);
    setRecMeta((m) =>
      new Map(m).set(r.file, { kind: r.kind, durationMs: r.durationMs, transcript: r.transcript }),
    );
    setError(null);
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
      setComposerStart('');
      writeDraft(draftId, '');
      setPending([]);
      setRecMeta(new Map());
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
      const rec = recMeta.get(file);
      staged.push({
        ...meta,
        storageKey,
        ...(rec && {
          recording: rec.kind,
          durationMs: Math.round(rec.durationMs),
          transcript: rec.transcript?.trim() || null,
        }),
      });
    }
    return staged;
  }

  /** Close the box; its text stays as a draft ("Finish comment"). */
  function closeComposer() {
    setComposerStart(composerBody);
    setPending([]);
    setComposerKey((k) => k + 1);
    setComposerOpen(false);
  }

  function discardDraft() {
    setComposerBody('');
    setComposerStart('');
    writeDraft(draftId, '');
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

      {/* Read-only viewers (tree or view access) can read comments but not add them. */}
      {isViewOnlyAccess(task.access) ? (
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>
          You have read-only access to this task, so you can’t add comments.
        </p>
      ) : (
        <div
          className="comment-composer"
          onKeyDown={(e) => {
            // Ctrl+Enter (⌘+Enter on a Mac) posts, as the brief asks.
            if (composerOpen && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && composerActive) {
              e.preventDefault();
              void submitComment();
            }
          }}
        >
          {composerOpen ? (
            <>
              <RichTextEditor
                key={`composer-${composerKey}`}
                value={composerStart}
                onChange={(html) => {
                  setComposerBody(html);
                  writeDraft(draftId, html);
                }}
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
                  <Paperclip size={14} aria-hidden="true" />{' '}
                  {pending.length === 0 ? 'Attach files' : 'Add more files'}
                </button>
                <CommentRecorder
                  disabled={submitting || pending.length >= COMMENT_MAX_ATTACHMENTS}
                  onDone={addRecording}
                  onError={setError}
                />
                <span className="muted composer-attach-hint">
                  {pending.length}/{COMMENT_MAX_ATTACHMENTS} · up to 25 MB each · Ctrl + Enter posts
                </span>
              </div>

              {pending.length > 0 && (
                <ul className="composer-files">
                  {pending.map((file) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <FileTile contentType={file.type} filename={file.name} small />
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
                      {recMeta.get(file)?.kind === 'voice' && (
                        <textarea
                          className="hb-sublines hb-rec-edit"
                          rows={2}
                          value={recMeta.get(file)?.transcript ?? ''}
                          placeholder="No transcript (only Chrome and Edge write one). You can type one."
                          aria-label={`Transcript of ${file.name}`}
                          onChange={(e) => {
                            const text = e.target.value;
                            setRecMeta((m) => {
                              const cur = m.get(file);
                              return cur ? new Map(m).set(file, { ...cur, transcript: text }) : m;
                            });
                          }}
                        />
                      )}
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
                  {submitting ? 'Posting…' : 'Post comment'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={submitting}
                  onClick={closeComposer}
                  title={hasDraft ? 'Kept as a draft on this browser' : undefined}
                >
                  {hasDraft ? 'Keep as draft' : 'Cancel'}
                </button>
                {hasDraft && (
                  <button
                    type="button"
                    className="secondary danger"
                    disabled={submitting}
                    onClick={discardDraft}
                  >
                    Discard
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              className={`comment-composer-stub${hasDraft ? ' has-draft' : ''}`}
              onClick={() => setComposerOpen(true)}
            >
              {hasDraft ? (
                <>
                  <span className="hb-draft-tag">Draft</span> Finish comment:{' '}
                  <span className="hb-draft-text">{plainText(composerBody)}</span>
                </>
              ) : (
                'Write a comment… use @ to mention someone'
              )}
            </button>
          )}
        </div>
      )}

      {task.comments.length > 0 && (
        <div className="hb-cfilter" role="group" aria-label="Show comments">
          {(
            [
              ['all', `All (${task.comments.length})`],
              ['mentions', `Mentions me (${task.comments.filter(mentionsMe).length})`],
              ['files', `With files (${task.comments.filter(hasFiles).length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={show === value ? 'is-on' : undefined}
              aria-pressed={show === value}
              onClick={() => setShow(value)}
            >
              {label}
            </button>
          ))}
          <label className="hb-csearch">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search comments"
              aria-label="Search comments"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                }
              }}
            />
            {q && matches.length > 0 && (
              <span className="hb-csearch-nav">
                <span aria-live="polite">
                  {hit + 1} of {matches.length}
                </span>
                <button type="button" aria-label="Previous match" onClick={() => step(-1)}>
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label="Next match" onClick={() => step(1)}>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </span>
            )}
          </label>
        </div>
      )}

      {task.comments.length === 0 ? (
        <EmptyState compact title="No comments yet">
          Start the conversation — add the first comment above.
        </EmptyState>
      ) : shownComments.length === 0 ? (
        <p className="hb-cfilter-none">
          {q
            ? 'No comments match your search.'
            : show === 'mentions'
              ? 'No comments mention you.'
              : 'No comments have files.'}{' '}
          <button
            type="button"
            className="hb-btn hb-btn-link"
            onClick={() => {
              setShow('all');
              setQuery('');
            }}
          >
            Show all
          </button>
        </p>
      ) : (
        <ul className="comment-list" ref={listRef}>
          {shownComments.map((c) => (
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
                  {c.attachments
                    .filter((a) => a.recording)
                    .map((a) => (
                      <PostedRecording key={a.id} attachment={a} />
                    ))}
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
