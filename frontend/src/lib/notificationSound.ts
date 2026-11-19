import type { NotificationSound } from '@healthy-tasks/shared';

/**
 * The notification sounds (Nov 2026 plan, E7), made in the browser so there
 * are no files to load: a few soft tones each.
 */
const NOTES: Record<NotificationSound, { f: number; t: number; d: number }[]> = {
  chime: [
    { f: 880, t: 0, d: 0.35 },
    { f: 1318.5, t: 0.12, d: 0.5 },
  ],
  ping: [{ f: 1567.98, t: 0, d: 0.25 }],
  pop: [
    { f: 520, t: 0, d: 0.08 },
    { f: 780, t: 0.05, d: 0.1 },
  ],
};

let ctx: AudioContext | null = null;

export function playNotificationSound(name: NotificationSound): void {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const now = ctx.currentTime;
    for (const n of NOTES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.18, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.05);
    }
  } catch {
    /* no sound here */
  }
}
