import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { SCREEN_KEYS, type ScreenKey } from '@healthy-tasks/shared';

// Guard against a pathological blob filling the row.
const MAX_STATE_BYTES = 100 * 1024;

export function assertScreenKey(screen: string): ScreenKey {
  if (!(SCREEN_KEYS as readonly string[]).includes(screen)) {
    throw HttpError.badRequest(`Unknown screen "${screen}"`);
  }
  return screen as ScreenKey;
}

/** The saved state for a (user, screen), or null if none stored yet. */
export async function getPref(userId: string, screen: ScreenKey): Promise<unknown | null> {
  const row = await prisma.userScreenPref.findUnique({
    where: { userId_screen: { userId, screen } },
    select: { state: true },
  });
  return row ? row.state : null;
}

/** Upsert the saved state for a (user, screen). */
export async function setPref(
  userId: string,
  screen: ScreenKey,
  state: Record<string, unknown>,
): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
    throw HttpError.badRequest('Saved screen state is too large');
  }
  const value = state as Prisma.InputJsonValue;
  await prisma.userScreenPref.upsert({
    where: { userId_screen: { userId, screen } },
    create: { userId, screen, state: value },
    update: { state: value },
  });
}
