import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import {
  NOTIFICATION_SOUNDS,
  NOTIFICATION_SOUND_LABELS,
  NOTIFY_CHANNELS,
  NOTIFY_CHANNEL_LABELS,
  NOTIFY_EVENTS,
  NOTIFY_EVENT_LABELS,
  type NotificationPreferencesDto,
  type NotificationSound,
  type NotifyChannel,
  type NotifyEvent,
  type UpdateNotificationPreferencesRequest,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { playNotificationSound } from '../lib/notificationSound';
import { disablePush, enablePush, pushSupported } from '../lib/push';
import { Select } from './harbor/Select';
import { useConnect } from '../lib/connect';

/** Fired on `window` when the settings change, so the bell can follow (sound). */
export const PREFS_CHANGED_EVENT = 'hb:notification-prefs';

/**
 * Notification settings (Nov 2026 plan, E7): every kind of event, per channel
 * (in the app, email, Connect), plus a sound and browser push. Saves as you go.
 */
export function NotificationSettings({ email }: { email?: string }) {
  const connect = useConnect();
  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNotificationPreferences()
      .then(setPrefs)
      .catch(() => setError('Could not load your notification settings.'));
  }, []);

  async function save(
    patch: UpdateNotificationPreferencesRequest,
    optimistic: NotificationPreferencesDto,
  ) {
    const before = prefs;
    setPrefs(optimistic);
    try {
      const saved = await api.updateNotificationPreferences(patch);
      setPrefs(saved);
      window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT, { detail: saved }));
      setError(null);
    } catch (err) {
      setPrefs(before);
      setError(err instanceof ApiError ? err.message : 'Could not save that change.');
    }
  }

  if (!prefs) return error ? <div className="alert error">{error}</div> : null;

  const setCell = (ev: NotifyEvent, ch: NotifyChannel, on: boolean) =>
    void save(
      { matrix: { [ev]: { [ch]: on } } },
      { ...prefs, matrix: { ...prefs.matrix, [ev]: { ...prefs.matrix[ev], [ch]: on } } },
    );

  async function setPush(on: boolean) {
    setPushNote(null);
    if (on) {
      const why = await enablePush().catch(() => 'Could not switch push on in this browser.');
      if (why) {
        setPushNote(why);
        return;
      }
    } else {
      await disablePush();
    }
    void save({ pushOn: on }, { ...prefs!, pushOn: on });
  }

  return (
    <div className="hb-notify">
      {error && <div className="alert error">{error}</div>}
      <table className="hb-notify-table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            {NOTIFY_CHANNELS.map((ch) => (
              <th key={ch} scope="col">
                {NOTIFY_CHANNEL_LABELS[ch]}
                {ch === 'connect' && !connect.available && (
                  <span className="hb-notify-soon">not linked yet</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NOTIFY_EVENTS.map((ev) => (
            <tr key={ev}>
              <th scope="row">{NOTIFY_EVENT_LABELS[ev]}</th>
              {NOTIFY_CHANNELS.map((ch) => (
                <td key={ch}>
                  <label className="hb-switch">
                    <input
                      type="checkbox"
                      checked={prefs.matrix[ev][ch]}
                      aria-label={`${NOTIFY_EVENT_LABELS[ev]}: ${NOTIFY_CHANNEL_LABELS[ch]}`}
                      onChange={(e) => setCell(ev, ch, e.target.checked)}
                    />
                    <span className="hb-switch-track" aria-hidden="true" />
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hb-small">
        Email goes to {email ?? 'your address'}.{' '}
        {connect.available
          ? 'Connect messages come from the HL Central bot in Connect, with a link back.'
          : 'Connect messages start once our Connect is linked; your choice is kept until then.'}
      </p>

      <div className="hb-notify-row">
        <label className="hb-switch">
          <input
            type="checkbox"
            checked={prefs.soundOn}
            onChange={(e) =>
              void save({ soundOn: e.target.checked }, { ...prefs, soundOn: e.target.checked })
            }
          />
          <span className="hb-switch-track" aria-hidden="true" />
          Play a sound for new alerts
        </label>
        <Select<NotificationSound>
          label="Sound"
          value={prefs.sound}
          options={NOTIFICATION_SOUNDS.map((s) => ({
            value: s,
            label: NOTIFICATION_SOUND_LABELS[s],
          }))}
          onChange={(s) => {
            playNotificationSound(s);
            void save({ sound: s }, { ...prefs, sound: s });
          }}
        />
        <button
          type="button"
          className="hb-icon-btn hb-icon-btn-sm"
          aria-label="Play the sound"
          onClick={() => playNotificationSound(prefs.sound)}
        >
          <Play size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="hb-notify-row">
        <label className="hb-switch">
          <input
            type="checkbox"
            checked={prefs.pushOn}
            disabled={!pushSupported()}
            onChange={(e) => void setPush(e.target.checked)}
          />
          <span className="hb-switch-track" aria-hidden="true" />
          Browser notifications (push), for what you get in the app
        </label>
      </div>
      {(pushNote || !pushSupported()) && (
        <p className="hb-small">{pushNote ?? 'This browser can’t show push notifications.'}</p>
      )}
    </div>
  );
}
