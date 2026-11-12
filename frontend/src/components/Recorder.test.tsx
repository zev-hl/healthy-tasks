import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Recorder } from './Recorder';

// jsdom has no microphone and no MediaRecorder: a small fake stands in for both.
class FakeRecorder {
  static last: FakeRecorder | null = null;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['sound'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
const track = { stop: vi.fn() };
const stream = {
  getTracks: () => [track],
  getAudioTracks: () => [track],
  getVideoTracks: () => [],
};

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  track.stop.mockClear();
});

describe('Recorder', () => {
  it('records a voice note and hands it back as an audio file', async () => {
    const onFile = vi.fn();
    render(<Recorder onFile={onFile} />);
    // No getDisplayMedia here, so no Screen button.
    expect(screen.queryByRole('button', { name: /Screen/ })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Voice/ }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Recording voice · 0:00 / 5:00');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Stop and attach/ }));
    });
    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0]![0] as File;
    expect(file.type).toBe('audio/webm');
    expect(file.name).toMatch(/^voice-note-.*\.webm$/);
    // The microphone is let go.
    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Voice/ })).toBeTruthy();
  });

  it('throws a recording away with the bin', async () => {
    const onFile = vi.fn();
    render(<Recorder onFile={onFile} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Voice/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard the recording' }));
    });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('says so when the microphone is refused', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException('no', 'NotAllowedError'),
    );
    render(<Recorder onFile={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Voice/ }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('wasn’t allowed to use the microphone');
  });
});
