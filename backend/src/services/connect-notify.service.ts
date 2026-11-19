import type { NotifyEvent } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { connectAvailable, sendConnectMessage } from './connect.service.js';
import { getPreferencesMap, wants } from './notification-preference.service.js';

/**
 * Notices as Connect messages (Nov 2026 plan, K3): from the "HL Central" bot,
 * with a link back, to those whose settings turn Connect on for that kind of
 * notice. One way: a reply in Connect doesn't post on the task. Sent in the
 * background so a slow Connect never slows HL Central down; a failure is
 * logged and the notice still stands in the app and by email.
 */

const pending = new Set<Promise<void>>();

/** Tests wait for the messages in flight. */
export async function connectSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

export function notifyByConnect(o: {
  userIds: (string | null | undefined)[];
  event: NotifyEvent;
  /** One sentence: what happened. */
  what: string;
  /** A second line, e.g. a note or the comment's words. */
  note?: string | null;
  link: string;
  /** Our id for this notice, so a retry never sends it twice. */
  key: string;
}): void {
  if (!connectAvailable()) return;
  const ids = [...new Set(o.userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const p = deliver({ ...o, userIds: ids }).catch((err) =>
    console.error('Connect notice failed', err),
  );
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

async function deliver(o: {
  userIds: string[];
  event: NotifyEvent;
  what: string;
  note?: string | null;
  link: string;
  key: string;
}): Promise<void> {
  const [prefs, people] = await Promise.all([
    getPreferencesMap(o.userIds),
    prisma.user.findMany({
      where: { id: { in: o.userIds }, isActive: true },
      select: { id: true, email: true },
    }),
  ]);
  const text = [`**HL Central:** ${o.what}`, o.note?.trim() || null, o.link]
    .filter(Boolean)
    .join('\n');
  for (const p of people) {
    const pref = prefs.get(p.id);
    if (!pref || !wants(pref, o.event, 'connect')) continue;
    try {
      await sendConnectMessage({ to: p.email, text, idempotencyKey: `${o.key}:${p.id}` });
    } catch (err) {
      console.error(`Connect message to ${p.id} failed:`, (err as Error).message);
    }
  }
}
