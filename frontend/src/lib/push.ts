import { api } from '../api/client';

/**
 * Browser push (Nov 2026 plan, E7): subscribe this browser so the server can
 * reach it, or stop. Needs the server's public key (push off without it).
 */

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/** Ask the browser's permission and subscribe; resolves to why not, or null when on. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return 'This browser can’t show push notifications.';
  const { publicKey } = await api.getPushConfig();
  if (!publicKey) return 'Push isn’t set up on this server yet.';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'The browser blocked notifications for HL Central.';
  const reg = await navigator.serviceWorker.register('/push-sw.js');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
  return null;
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.removePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
