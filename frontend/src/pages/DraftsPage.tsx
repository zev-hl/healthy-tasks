import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Lightbulb, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { DRAFT_MAX_FILES, type DraftDto } from '@healthy-tasks/shared';
import { api, ApiError, uploadToStorage } from '../api/client';
import { attachmentProblem, humanSize } from '../lib/attachmentFile';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Btn, Card, Empty, cx } from '../components/harbor/ui';
import { askConfirm } from '../components/ui/confirm';
import { useToast } from '../components/harbor/Toast';
import { RichTextEditor } from '../components/RichTextEditor';
import { FileTile } from '../components/ui/FileTile';
import type { NewTaskCarry } from '../components/harbor/QuickTask';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * Drafts (Nov 2026 plan, I1), like Lipa's Planning page: ideas you keep for
 * yourself — a title, notes and files. A draft notifies no one and starts no
 * workflow; "Make task" (or "Make project") opens the New task page with it,
 * and once the task is made, the draft's files move onto it and the draft goes.
 */
export function DraftsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [drafts, setDrafts] = useState<DraftDto[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listDrafts()
      .then((d) => {
        setDrafts(d);
        setOpenId((cur) => cur ?? d[0]?.id ?? null);
      })
      .catch((e) => setError(errorText(e, 'Could not load your drafts.')));
  }, []);

  const open = drafts?.find((d) => d.id === openId) ?? null;
  const replace = (d: DraftDto) =>
    setDrafts((list) => (list ?? []).map((x) => (x.id === d.id ? d : x)));

  async function create() {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const d = await api.createDraft({ title });
      setDrafts((list) => [d, ...(list ?? [])]);
      setOpenId(d.id);
      setNewTitle('');
    } catch (e) {
      setError(errorText(e, 'Could not add the draft.'));
    }
  }

  async function remove(d: DraftDto) {
    const ok = await askConfirm({
      title: `Delete the draft “${d.title}”?`,
      message: 'The draft and its files are deleted. This can’t be undone.',
      confirmLabel: 'Delete draft',
    });
    if (!ok) return;
    try {
      await api.deleteDraft(d.id);
      setDrafts((list) => (list ?? []).filter((x) => x.id !== d.id));
      setOpenId(null);
      toast({ message: `Deleted “${d.title}”.`, tone: 'dark' });
    } catch (e) {
      toast({ message: errorText(e, 'Could not delete it.'), tone: 'error' });
    }
  }

  function makeTask(d: DraftDto, isProject: boolean) {
    const carry: NewTaskCarry & { description?: string; draftId?: string } = {
      name: d.title,
      description: d.notes ?? undefined,
      draftId: d.id,
      isProject,
    };
    navigate('/tasks/new', { state: carry });
  }

  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Ideas only you see. Nothing is sent until you make a task from one."
      />
      <PageBody>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <div className="hb-drafts">
          <aside className="hb-drafts-list" aria-label="Your drafts">
            <form
              className="hb-drafts-new"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input
                className="hb-tpl-input"
                value={newTitle}
                maxLength={300}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="New draft: type a title, then Enter"
                aria-label="New draft title"
              />
              <Btn type="submit" disabled={!newTitle.trim()}>
                <Plus size={15} aria-hidden="true" /> Add
              </Btn>
            </form>
            {drafts === null ? (
              <Empty>Loading…</Empty>
            ) : drafts.length === 0 ? (
              <Empty>
                <Lightbulb size={16} aria-hidden="true" /> No drafts yet. Jot an idea down here.
              </Empty>
            ) : (
              drafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={cx('hb-draft-item', d.id === openId && 'is-active')}
                  aria-current={d.id === openId ? 'true' : undefined}
                  onClick={() => setOpenId(d.id)}
                >
                  <span className="hb-name">{d.title}</span>
                  <span className="hb-sub">
                    {new Date(d.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {d.files.length > 0 &&
                      ` · ${d.files.length} file${d.files.length === 1 ? '' : 's'}`}
                  </span>
                </button>
              ))
            )}
          </aside>
          <section className="hb-drafts-editor">
            {open ? (
              <DraftEditor
                key={open.id}
                draft={open}
                onSaved={replace}
                onDelete={() => void remove(open)}
                onMakeTask={(isProject) => makeTask(open, isProject)}
              />
            ) : (
              drafts && drafts.length > 0 && <Empty>Pick a draft to read or change it.</Empty>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}

function DraftEditor({
  draft,
  onSaved,
  onDelete,
  onMakeTask,
}: {
  draft: DraftDto;
  onSaved: (d: DraftDto) => void;
  onDelete: () => void;
  onMakeTask: (isProject: boolean) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  // Saves itself a moment after you stop typing.
  function queueSave(next: { title?: string; notes?: string }) {
    setSaved(false);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const body = {
        ...(next.title !== undefined && { title: next.title.trim() || draft.title }),
        ...(next.notes !== undefined && { notes: next.notes }),
      };
      api
        .updateDraft(draft.id, body)
        .then((d) => {
          onSaved(d);
          setSaved(true);
        })
        .catch((e) => setError(errorText(e, 'Could not save the draft.')));
    }, 700);
  }
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    setError(null);
    try {
      let d = draft;
      for (const file of Array.from(list)) {
        if (d.files.length >= DRAFT_MAX_FILES) {
          setError(`A draft can keep at most ${DRAFT_MAX_FILES} files.`);
          break;
        }
        const problem = attachmentProblem(file);
        if (problem) {
          setError(problem);
          continue;
        }
        const meta = { filename: file.name, contentType: file.type, size: file.size };
        const { uploadUrl, storageKey } = await api.presignDraftFile(draft.id, meta);
        await uploadToStorage(uploadUrl, file);
        d = await api.addDraftFile(draft.id, { ...meta, storageKey });
      }
      onSaved(d);
    } catch (e) {
      setError(errorText(e, 'Could not add the file.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFile(fileId: string) {
    try {
      const { url } = await api.getDraftFileUrl(draft.id, fileId);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(errorText(e, 'Could not open the file.'));
    }
  }

  async function removeFile(fileId: string) {
    try {
      onSaved(await api.removeDraftFile(draft.id, fileId));
    } catch (e) {
      setError(errorText(e, 'Could not remove the file.'));
    }
  }

  return (
    <Card className="hb-draft-card">
      <div className="hb-card-pad hb-draft-body">
        <div className="hb-draft-top">
          <input
            className="hb-title-input"
            value={title}
            maxLength={300}
            aria-label="Draft title"
            onChange={(e) => {
              setTitle(e.target.value);
              queueSave({ title: e.target.value });
            }}
          />
          <span className="hb-small" aria-live="polite">
            {saved ? 'Saved' : 'Saving…'}
          </span>
        </div>
        {error && (
          <p className="hb-quicktask-error" role="alert">
            {error}
          </p>
        )}
        <RichTextEditor
          value={notes}
          ariaLabel="Draft notes"
          onChange={(html) => {
            setNotes(html);
            queueSave({ notes: html });
          }}
        />
        <div className="hb-draft-files">
          {draft.files.map((f) => (
            <span key={f.id} className="hb-draft-file">
              <button
                type="button"
                className="hb-btn hb-btn-link"
                onClick={() => void openFile(f.id)}
              >
                <FileTile contentType={f.contentType} filename={f.filename} small />
                {f.filename}
              </button>
              <span className="hb-small">{humanSize(f.size)}</span>
              <button
                type="button"
                className="rel-x"
                aria-label={`Remove ${f.filename}`}
                onClick={() => void removeFile(f.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Btn
            disabled={busy || draft.files.length >= DRAFT_MAX_FILES}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={14} aria-hidden="true" /> {busy ? 'Adding…' : 'Add files'}
          </Btn>
        </div>
        <div className="hb-draft-actions">
          <Btn kind="primary" onClick={() => onMakeTask(false)}>
            Make task
          </Btn>
          <Btn onClick={() => onMakeTask(true)}>
            <FolderOpen size={14} aria-hidden="true" /> Make project
          </Btn>
          <span className="hb-grow" />
          <Btn onClick={onDelete}>
            <Trash2 size={14} aria-hidden="true" /> Delete draft
          </Btn>
        </div>
      </div>
    </Card>
  );
}
