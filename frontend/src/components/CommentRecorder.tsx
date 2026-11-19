import { useEffect, useRef, useState } from 'react';
import { Mic, MonitorUp, Square, X } from 'lucide-react';
import { RECORDING_MAX_MS, type RecordingKind } from '@healthy-tasks/shared';

/** A finished recording, ready to go with the comment. */
export interface Recording {
  file: File;
  kind: RecordingKind;
  durationMs: number;
  /** Voice notes in Chrome and Edge: what the browser heard (editable before posting). */
  transcript: string | null;
}

// The browser's live speech-to-text (Chrome, Edge). Not in the DOM typings.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
function speechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

export function recordingSupported(kind: RecordingKind): boolean {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return false;
  return kind === 'voice'
    ? !!navigator.mediaDevices?.getUserMedia
    : !!navigator.mediaDevices?.getDisplayMedia;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function pickType(kind: RecordingKind): string {
  const tries =
    kind === 'voice'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return tries.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

/**
 * Voice notes (up to 5 minutes) and screen recordings (up to 10) in the
 * comment box (Nov 2026 plan, D4). A voice note in Chrome or Edge is also
 * written out live by the browser (free), and the text can be corrected before
 * posting. Each stops by itself at its limit; screen sharing that is refused
 * says so plainly.
 */
export function CommentRecorder({
  disabled,
  onDone,
  onError,
}: {
  disabled?: boolean;
  onDone: (r: Recording) => void;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<RecordingKind | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [heard, setHeard] = useState('');
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const finalText = useRef('');

  useEffect(() => {
    if (!kind) return;
    const t = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= RECORDING_MAX_MS[kind]) stop();
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Leaving the page mid-recording stops everything.
  useEffect(() => () => cleanup(), []);

  function cleanup() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      speechRef.current?.stop();
    } catch {
      /* already stopped */
    }
    speechRef.current = null;
  }

  async function start(k: RecordingKind) {
    let stream: MediaStream;
    try {
      stream =
        k === 'voice'
          ? await navigator.mediaDevices.getUserMedia({ audio: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
      const name = (err as { name?: string }).name;
      onError(
        k === 'screen'
          ? name === 'NotAllowedError'
            ? 'Screen sharing was refused, so nothing was recorded. Allow it in the browser to record your screen.'
            : 'Could not start a screen recording in this browser.'
          : name === 'NotAllowedError'
            ? 'The microphone was refused, so nothing was recorded. Allow it in the browser to record a voice note.'
            : 'Could not use a microphone in this browser.',
      );
      return;
    }
    streamRef.current = stream;
    const mimeType = pickType(k);
    const rec = new MediaRecorder(stream, {
      ...(mimeType && { mimeType }),
      // Small enough that 10 minutes of screen fits the 25 MB file limit.
      ...(k === 'screen'
        ? { videoBitsPerSecond: 250_000, audioBitsPerSecond: 32_000 }
        : { audioBitsPerSecond: 32_000 }),
    });
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const durationMs = Date.now() - startedAt.current;
      cleanup();
      setKind(null);
      setElapsed(0);
      if (cancelled.current) return;
      const type = (
        rec.mimeType ||
        mimeType ||
        (k === 'voice' ? 'audio/webm' : 'video/webm')
      ).split(';')[0]!;
      const blob = new Blob(chunks.current, { type });
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      const file = new File(
        [blob],
        `${k === 'voice' ? 'Voice note' : 'Screen recording'} ${stamp}.${ext}`,
        {
          type,
          lastModified: Date.now(),
        },
      );
      const text = finalText.current.trim();
      onDone({ file, kind: k, durationMs, transcript: k === 'voice' && text ? text : null });
    };
    // A screen share ended from the browser's own bar stops the recording too.
    stream
      .getVideoTracks()[0]
      ?.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop());
    recRef.current = rec;
    finalText.current = '';
    setHeard('');
    if (k === 'voice') {
      const sr = speechRecognition();
      if (sr) {
        sr.continuous = true;
        sr.interimResults = true;
        sr.lang = navigator.language || 'en-US';
        sr.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) finalText.current += `${r[0].transcript.trim()} `;
            else interim += r[0].transcript;
          }
          setHeard(`${finalText.current}${interim}`.trim());
        };
        // It stops on silence: start again while still recording.
        sr.onend = () => {
          if (recRef.current?.state === 'recording' && speechRef.current === sr) {
            try {
              sr.start();
            } catch {
              /* gave up */
            }
          }
        };
        sr.onerror = () => {};
        try {
          sr.start();
          speechRef.current = sr;
        } catch {
          /* no transcript then */
        }
      }
    }
    startedAt.current = Date.now();
    rec.start(1000);
    setKind(k);
  }

  function stop() {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }
  function cancel() {
    cancelled.current = true;
    stop();
  }

  if (kind) {
    const left = RECORDING_MAX_MS[kind] - elapsed;
    return (
      <div className="hb-rec-live" role="status">
        <span className="hb-live" aria-hidden="true" />
        <strong>{kind === 'voice' ? 'Recording a voice note' : 'Recording your screen'}</strong>
        <span className="hb-rec-clock">
          {clock(elapsed)} · {clock(Math.max(0, left))} left
        </span>
        <span className="hb-grow" />
        <button type="button" className="hb-btn" onClick={cancel}>
          <X size={14} aria-hidden="true" /> Cancel
        </button>
        <button type="button" className="hb-btn hb-btn-primary" onClick={stop}>
          <Square size={13} aria-hidden="true" /> Stop
        </button>
        {kind === 'voice' && heard && <p className="hb-rec-heard">{heard}</p>}
      </div>
    );
  }

  return (
    <span className="hb-rec-buttons">
      {recordingSupported('voice') && (
        <button
          type="button"
          className="secondary composer-attach-btn"
          disabled={disabled}
          onClick={() => void start('voice')}
        >
          <Mic size={14} aria-hidden="true" /> Voice note
        </button>
      )}
      {recordingSupported('screen') && (
        <button
          type="button"
          className="secondary composer-attach-btn"
          disabled={disabled}
          onClick={() => void start('screen')}
        >
          <MonitorUp size={14} aria-hidden="true" /> Record screen
        </button>
      )}
    </span>
  );
}

/**
 * A recording on a posted comment: a player (voice notes at 1×, 1.5× or 2×)
 * and, for a voice note with one, "View transcript".
 */
export function RecordingPlayer({
  url,
  kind,
  transcript,
  durationMs,
}: {
  url: string | null;
  kind: RecordingKind;
  transcript: string | null;
  durationMs: number | null;
}) {
  const ref = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [rate, setRate] = useState(1);
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, url]);
  return (
    <div className={`hb-rec-player is-${kind}`}>
      {kind === 'voice' ? (
        <div className="hb-rec-voice">
          <Mic size={15} aria-hidden="true" />
          {url ? (
            <audio ref={ref} controls preload="metadata" src={url} />
          ) : (
            <span className="hb-small">Loading…</span>
          )}
          {durationMs != null && <span className="hb-small">{clock(durationMs)}</span>}
          <span className="hb-rec-speed" role="group" aria-label="Playback speed">
            {[1, 1.5, 2].map((r) => (
              <button
                key={r}
                type="button"
                className={rate === r ? 'is-on' : undefined}
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
              >
                {r}×
              </button>
            ))}
          </span>
        </div>
      ) : url ? (
        <video ref={ref} controls preload="metadata" src={url} />
      ) : (
        <span className="hb-small">Loading…</span>
      )}
      {transcript && (
        <>
          <button
            type="button"
            className="hb-btn hb-btn-link"
            onClick={() => setShowText((s) => !s)}
          >
            {showText ? 'Hide transcript' : 'View transcript'}
          </button>
          {showText && <p className="hb-rec-transcript">{transcript}</p>}
        </>
      )}
    </div>
  );
}
