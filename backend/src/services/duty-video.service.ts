import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { getStorage } from '../storage/index.js';
import { HttpError } from '../utils/http-error.js';
import { assertValidUpload, safeName } from './attachment.service.js';

/**
 * A duty's training video as an uploaded file (Nov 2026 plan, I4), the other
 * choice beside a link. An Admin uploads it; everyone may watch it.
 */

async function dutyOrThrow(id: string) {
  const d = await prisma.duty.findUnique({
    where: { id },
    select: { id: true, videoKey: true, videoName: true },
  });
  if (!d) throw HttpError.notFound('Duty not found');
  return d;
}

export async function presignDutyVideo(
  id: string,
  input: { filename: string; contentType: string; size: number },
): Promise<{ uploadUrl: string; storageKey: string }> {
  await dutyOrThrow(id);
  if (!input.contentType.startsWith('video/')) throw HttpError.badRequest('Pick a video file');
  assertValidUpload(input.contentType, input.size);
  const storageKey = `duties/${id}/${randomUUID()}/${safeName(input.filename)}`;
  return {
    uploadUrl: await getStorage().presignUpload(storageKey, input.contentType, input.size),
    storageKey,
  };
}

export async function setDutyVideo(
  id: string,
  input: { filename: string; storageKey: string },
): Promise<void> {
  const d = await dutyOrThrow(id);
  if (!input.storageKey.startsWith(`duties/${id}/`)) {
    throw HttpError.badRequest('storageKey does not belong to this duty');
  }
  const head = await getStorage().headObject(input.storageKey);
  if (!head) throw HttpError.badRequest('The video was not uploaded; please try again');
  if (!(head.contentType ?? '').startsWith('video/'))
    throw HttpError.badRequest('Pick a video file');
  await prisma.duty.update({
    where: { id },
    data: { videoKey: input.storageKey, videoName: input.filename.slice(0, 255) },
  });
  if (d.videoKey && d.videoKey !== input.storageKey) {
    await getStorage()
      .deleteObject(d.videoKey)
      .catch(() => {});
  }
}

export async function clearDutyVideo(id: string): Promise<void> {
  const d = await dutyOrThrow(id);
  await prisma.duty.update({ where: { id }, data: { videoKey: null, videoName: null } });
  if (d.videoKey)
    await getStorage()
      .deleteObject(d.videoKey)
      .catch(() => {});
}

export async function dutyVideoUrl(id: string): Promise<string> {
  const d = await dutyOrThrow(id);
  if (!d.videoKey) throw HttpError.notFound('This duty has no video file');
  return getStorage().presignDownload(d.videoKey, d.videoName ?? 'video');
}
