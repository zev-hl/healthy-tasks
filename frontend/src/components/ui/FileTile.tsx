import { FILE_KIND_LABEL, fileKind } from '../../lib/attachmentFile';

/** The 32px typed tile in front of a file name (PDF, XLS, DOC, IMG, FILE). */
export function FileTile({
  contentType,
  filename,
  small = false,
}: {
  contentType: string;
  filename?: string;
  small?: boolean;
}) {
  const kind = fileKind(contentType, filename);
  return (
    <span className={`hb-filetile kind-${kind}${small ? ' is-small' : ''}`} aria-hidden="true">
      {FILE_KIND_LABEL[kind]}
    </span>
  );
}
