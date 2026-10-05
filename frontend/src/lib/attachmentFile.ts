/**
 * The file rules, in one place, so the comment composer and the attachment
 * section can't drift apart on what they accept or how they describe a size.
 *
 * These are a courtesy to the user, not a security boundary — the server
 * re-checks every file's real type and size after it reaches storage.
 */
import { ATTACHMENT_MAX_BYTES, isAllowedAttachmentType } from '@healthy-tasks/shared';

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(contentType: string): string {
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType.startsWith('audio/')) return '🎵';
  if (contentType.startsWith('video/')) return '🎬';
  return '📄';
}

/** Why this file can't be attached, or null when it's fine. */
export function attachmentProblem(file: File): string | null {
  if (!file.type || !isAllowedAttachmentType(file.type)) {
    return 'Unsupported file type. Allowed: images, documents, audio, and video.';
  }
  // The server requires a positive size, so an empty file would otherwise be
  // refused there with a message that names no file at all.
  if (file.size === 0) {
    return `"${file.name}" is empty (0 bytes), so there is nothing to attach.`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `"${file.name}" is too large (${humanSize(file.size)}). The maximum is 25 MB.`;
  }
  return null;
}

/** Two picks of the same file — by name and size, which is as close as a browser lets us look. */
export function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}
