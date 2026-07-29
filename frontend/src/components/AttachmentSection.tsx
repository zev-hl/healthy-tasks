import { useRef, useState } from 'react';
import {
  ATTACHMENT_MAX_BYTES,
  isAllowedAttachmentType,
  type AttachmentDto,
  type TaskDetailDto,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError, uploadToStorage } from '../api/client';
import { UserChip } from './ui/Avatar';

type Target = { kind: 'task'; taskId: number } | { kind: 'comment'; commentId: string };

interface Props {
  attachments: AttachmentDto[];
  target: Target;
  canUpload: boolean;
  currentUser: UserDto;
  onChanged: (task: TaskDetailDto) => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(contentType: string): string {
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType.startsWith('audio/')) return '🎵';
  if (contentType.startsWith('video/')) return '🎬';
  return '📄';
}

export function AttachmentSection({
  attachments,
  target,
  canUpload,
  currentUser,
  onChanged,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The API also allows an org-superior of the uploader to delete; the button is
  // shown for the clear cases (uploader or Admin) and the server enforces the rest.
  const canDelete = (att: AttachmentDto) =>
    att.uploadedBy.id === currentUser.id || currentUser.role === 'Admin';

  async function handleFile(file: File) {
    setError(null);
    if (!file.type || !isAllowedAttachmentType(file.type)) {
      setError('Unsupported file type. Allowed: images, documents, audio, and video.');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(`"${file.name}" is too large (${humanSize(file.size)}). The maximum is 25 MB.`);
      return;
    }
    setBusy(true);
    try {
      const meta = { filename: file.name, contentType: file.type, size: file.size };
      const presign =
        target.kind === 'task'
          ? await api.presignTaskAttachment(target.taskId, meta)
          : await api.presignCommentAttachment(target.commentId, meta);
      await uploadToStorage(presign.uploadUrl, file);
      const confirmBody = { ...meta, storageKey: presign.storageKey };
      const task =
        target.kind === 'task'
          ? await api.confirmTaskAttachment(target.taskId, confirmBody)
          : await api.confirmCommentAttachment(target.commentId, confirmBody);
      onChanged(task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(att: AttachmentDto) {
    try {
      const { url } = await api.getAttachmentDownloadUrl(att.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not get download link');
    }
  }

  async function handleDelete(att: AttachmentDto) {
    if (!window.confirm(`Delete "${att.filename}"?`)) return;
    setError(null);
    setBusy(true);
    try {
      onChanged(await api.deleteAttachment(att.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete attachment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attachments">
      {error && <div className="alert error">{error}</div>}

      {attachments.length === 0 ? (
        target.kind === 'task' ? (
          <p className="muted" style={{ margin: '0.25rem 0' }}>
            No attachments yet.
          </p>
        ) : null
      ) : (
        <ul className="attachment-list">
          {attachments.map((att) => (
            <li key={att.id} className="attachment-row">
              <span className="attachment-icon" aria-hidden>
                {fileIcon(att.contentType)}
              </span>
              <button
                type="button"
                className="attachment-name link-button"
                onClick={() => handleDownload(att)}
                title="Download"
              >
                {att.filename}
              </button>
              <span className="muted attachment-meta">
                {humanSize(att.size)} · <UserChip user={att.uploadedBy} />
              </span>
              {canDelete(att) && (
                <button
                  type="button"
                  className="rel-x"
                  aria-label={`Delete ${att.filename}`}
                  disabled={busy}
                  onClick={() => handleDelete(att)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div style={{ marginTop: '0.5rem' }}>
          <input
            ref={inputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Uploading…' : '+ Attach file'}
          </button>
        </div>
      )}
    </div>
  );
}
