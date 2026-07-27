import { env } from '../config/env.js';
import type { StorageService } from './types.js';
import { s3Storage } from './s3.storage.js';
import { memoryStorage } from './memory.storage.js';

export type { StorageService } from './types.js';

/**
 * The active storage backend, chosen by STORAGE_DRIVER: `memory` (tests) or
 * `s3` (default; MinIO locally, any S3-compatible bucket in prod).
 */
export function getStorage(): StorageService {
  return env.storage.driver === 'memory' ? memoryStorage : s3Storage;
}
