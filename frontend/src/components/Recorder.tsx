import { useEffect, useRef, useState } from 'react';
import { Mic, MonitorUp, Square, Trash2 } from 'lucide-react';

type Kind = 'voice' | 'screen';

/** Longest recordings. A screen recording is kept short so it stays under the 25 MB file limit. */
const MAX_SECONDS: Record<Kind, number> = { voice: 5 * 60, screen: 3 * 60 };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** The browser can record at all (not every browser, and never over plain http). */
export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}
const canShareScreen = () => canRecord() && !!navigator.mediaDevices?.getDisplayMedia;

/**
 * Voice note and screen recording for the comment box (Nov 11 meeting: "voice
 * note attachments with simple send, delete and re-record controls, and screen
 * recording"). It records in the browser and hands back an ordinary file, which
 * is attached like any other: nothing new on the server. Stop keeps it, the bin
 * throws it away; a recording stops on its own at its time limit, or when the
 * person stops sharing their screen.
 */
export function Recorder({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const chunks = useRef<Blob[]>([]);
  const keep = useRef(true);
  const timer = useRef<number | null>(null);

  function cleanUp() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    for (const s of streams.current) for (const t of s.getTracks()) t.stop();
    streams.current = [];
    recorder.current = null;
    setKind(null);
    setSeconds(0);
  }
  // Leaving the page never leaves the microphone or the screen share on.
  useEffect(
    () => () => {
      keep.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      cleanUp();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function start(k: Kind) {
    setError(null);
    try {
      let stream: MediaStream;
      if (k === 'voice') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.current = [stream];
      } else {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Your voice over the recording, if the microphone is allowed; without it, the screen alone.
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        streams.current = mic ? [screen, mic] : [screen];
        stream = new MediaStream([
          ...screen.getVideoTracks(),
          ...(mic ? mic.getAudioTracks() : screen.getAudioTracks()),
        ]);
        // "Stop sharing" in the browser's own bar ends the recording and keeps it.
        screen.getVideoTracks()[0]?.addEventListener('ended', () => stop(true));
      }
      const rec = new MediaRecorder(
        stream,
        k === 'screen' ? { videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 } : undefined,
      );
      chunks.current = [];
      keep.current = true;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || (k === 'voice' ? 'audio/webm' : 'video/webm');
        const base = type.split(';')[0]!;
        const ext = base.includes('mp4') ? 'mp4' : base.includes('ogg') ? 'ogg' : 'webm';
        if (keep.current && chunks.current.length) {
          const blob = new Blob(chunks.current, { type: base });
          onFile(
            new File(
              [blob],
              `${k === 'voice' ? 'voice-note' : 'screen-recording'}-${stamp()}.${ext}`,
              { type: base },
            ),
          );
        }
        cleanUp();
      };
      recorder.current = rec;
      rec.start(1000);
      setKind(k);
      setSeconds(0);
      let n = 0;
      timer.current = window.setInterval(() => {
        n += 1;
        setSeconds(n);
        if (n >= MAX_SECONDS[k]) stop(true);
      }, 1000);
    } catch (e) {
      cleanUp();
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(
        k === 'voice'
          ? denied
            ? 'The browser wasn’t allowed to use the microphone.'
            : 'Couldn’t start the microphone.'
          : denied
            ? 'Screen sharing was cancelled or not allowed.'
            : 'Couldn’t start the screen recording.',
      );
    }
  }

  function stop(save: boolean) {
    keep.current = save;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else cleanUp();
  }

  if (!canRecord()) return null;

  if (kind) {
    return (
      <span className="hb-rec is-on" role="status">
        <span className="hb-live" aria-hidden="true" />
        <span className="hb-rec-label">
          {kind === 'voice' ? 'Recording voice' : 'Recording screen'} · {clock(seconds)} /{' '}
          {clock(MAX_SECONDS[kind])}
        </span>
        <button type="button" className="hb-rec-btn is-stop" onClick={() => stop(true)}>
          <Square size={12} fill="currentColor" aria-hidden="true" /> Stop and attach
        </button>
        <button
          type="button"
          className="hb-rec-btn"
          aria-label="Discard the recording"
          title="Discard"
          onClick={() => stop(false)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="secondary composer-attach-btn"
        disabled={disabled}
        onClick={() => void start('voice')}
        title="Record a voice note (up to 5 minutes)"
      >
        <Mic size={14} aria-hidden="true" /> Voice
      </button>
      {canShareScreen() && (
        <button
          type="button"
          className="secondary composer-attach-btn"
          disabled={disabled}
          onClick={() => void start('screen')}
          title="Record your screen, with your voice (up to 3 minutes)"
        >
          <MonitorUp size={14} aria-hidden="true" /> Screen
        </button>
      )}
      {error && (
        <span className="hb-rec-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
