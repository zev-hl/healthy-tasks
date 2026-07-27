import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import type { StorageService } from './types.js';

const PRESIGN_EXPIRY_SECONDS = 15 * 60;

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    region: env.storage.region,
    endpoint,
    // Required for MinIO and most S3-compatible servers (bucket in the path,
    // not the host).
    forcePathStyle: env.storage.forcePathStyle,
    credentials: {
      accessKeyId: env.storage.accessKey,
      secretAccessKey: env.storage.secretKey,
    },
  });
}

// Two clients, constructed lazily so importing this module has no side effects
// (tests using the memory driver never build an S3 client):
//  - internal: server-side ops (delete/head) over the compose-internal endpoint.
//  - public:   used ONLY to SIGN URLs. A pre-signed URL is bound to the host it
//    was signed for, and the browser must hit that same host — so we sign
//    against the browser-reachable public endpoint (e.g. localhost:9000).
let internalClient: S3Client | undefined;
let publicClient: S3Client | undefined;
const internal = (): S3Client => (internalClient ??= makeClient(env.storage.endpoint));
const publik = (): S3Client => (publicClient ??= makeClient(env.storage.publicEndpoint));

export const s3Storage: StorageService = {
  async presignUpload(key, contentType) {
    const cmd = new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(publik(), cmd, { expiresIn: PRESIGN_EXPIRY_SECONDS });
  },

  async presignDownload(key, filename) {
    const cmd = new GetObjectCommand({
      Bucket: env.storage.bucket,
      Key: key,
      // Force a download with the original filename.
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
    });
    return getSignedUrl(publik(), cmd, { expiresIn: PRESIGN_EXPIRY_SECONDS });
  },

  async deleteObject(key) {
    await internal().send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: key }));
  },

  async headObject(key) {
    try {
      const res = await internal().send(
        new HeadObjectCommand({ Bucket: env.storage.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  },
};
