import type { StorageService, StorageObjectInfo } from './types.js';

// In-memory storage fake for tests (STORAGE_DRIVER=memory). It records deleted
// keys so tests can assert that removing an attachment (or deleting a task)
// actually deletes the underlying object, and returns fake `memory://` URLs.
// No MinIO/S3 required.

const objects = new Map<string, StorageObjectInfo>();
const deletedKeys: string[] = [];

export const memoryStorage: StorageService & {
  /** Keys passed to deleteObject, in order — for test assertions. */
  readonly __deleted: string[];
  /** Seed an object so headObject can find it (optional in tests). */
  __put(key: string, info: StorageObjectInfo): void;
  /** Clear all recorded state between tests. */
  __reset(): void;
} = {
  async presignUpload(key) {
    return `memory://upload/${encodeURIComponent(key)}`;
  },
  async presignDownload(key, filename) {
    return `memory://download/${encodeURIComponent(key)}?filename=${encodeURIComponent(filename)}`;
  },
  async deleteObject(key) {
    objects.delete(key);
    deletedKeys.push(key);
  },
  async headObject(key) {
    return objects.get(key) ?? null;
  },
  async copyObject(srcKey, destKey) {
    const info = objects.get(srcKey);
    if (info) objects.set(destKey, { ...info });
  },
  __deleted: deletedKeys,
  __put(key, info) {
    objects.set(key, info);
  },
  __reset() {
    objects.clear();
    deletedKeys.length = 0;
  },
};
