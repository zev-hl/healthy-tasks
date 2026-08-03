// Storage abstraction (Phase 4). Attachment bytes live in S3-compatible object
// storage — never in Postgres and never routed through the backend. The backend
// only mints pre-signed URLs (for the browser to PUT/GET directly) and performs
// server-side delete/head. Coding against this interface lets local dev run
// MinIO, prod point at a real bucket, and tests use an in-memory fake — all with
// no change to the service layer.

export interface StorageObjectInfo {
  size: number;
  contentType: string;
}

export interface StorageService {
  /** Pre-signed PUT URL the browser uses to upload bytes directly. */
  presignUpload(key: string, contentType: string, size: number): Promise<string>;
  /** Pre-signed GET URL (as an attachment download) for the given object. */
  presignDownload(key: string, filename: string): Promise<string>;
  /** Delete the stored object (best-effort; used when an attachment is removed). */
  deleteObject(key: string): Promise<void>;
  /** Object metadata if it exists, else null. Used to confirm an upload. */
  headObject(key: string): Promise<StorageObjectInfo | null>;
  /** Server-side copy of a stored object to a new key (used when duplicating a
   * task's attachments so each copy gets its own independent blob). */
  copyObject(srcKey: string, destKey: string): Promise<void>;
}
