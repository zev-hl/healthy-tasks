import webpush from 'web-push';
import type { PushSubscriptionRequest } from '@healthy-tasks/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

/**
 * Browser push (Nov 2026 plan, E7). Off until the server has a VAPID key pair
 * (env.push); then each person's subscribed browsers get a short message for
 * every event they want in the app, when they have push switched on.
 */

let configured: boolean | null = null;
function ready(): boolean {
  if (configured !== null) return configured;
  configured = !!(env.push.publicKey && env.push.privateKey);
  if (configured)
    webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
  return configured;
}

export function pushPublicKey(): string | null {
  return ready() ? env.push.publicKey : null;
}

export async function savePushSubscription(
  userId: string,
  sub: PushSubscriptionRequest,
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Messages sent, for tests (the real send is skipped there). */
export const sentPushes: { userId: string; title: string; body: string; url: string }[] = [];

/** Send to every browser the person subscribed; a browser that's gone is dropped. */
export async function pushTo(
  userId: string,
  message: { title: string; body: string; url: string },
): Promise<void> {
  if (env.nodeEnv === 'test') {
    sentPushes.push({ userId, ...message });
    return;
  }
  if (!ready()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(message),
          { TTL: 3600 },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error('push failed', s.id, err);
        }
      }
    }),
  );
}
