import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CommentRecorder, RecordingPlayer } from './CommentRecorder';

describe('RecordingPlayer', () => {
  it('plays a voice note at 1×, 1.5× or 2× and shows its transcript on request', () => {
    const { container } = render(
      <RecordingPlayer
        url="https://x/v.webm"
        kind="voice"
        transcript="Ship it today"
        durationMs={65_000}
      />,
    );
    const audio = container.querySelector('audio')!;
    expect(screen.getByText('1:05')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1.5×' }));
    expect(audio.playbackRate).toBe(1.5);
    expect(screen.queryByText('Ship it today')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View transcript' }));
    expect(screen.getByText('Ship it today')).toBeInTheDocument();
  });

  it('shows a screen recording as a video, with no transcript link', () => {
    const { container } = render(
      <RecordingPlayer url="https://x/s.webm" kind="screen" transcript={null} durationMs={null} />,
    );
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'View transcript' })).toBeNull();
  });
});

describe('CommentRecorder', () => {
  it('says plainly when screen sharing is refused', async () => {
    vi.stubGlobal('MediaRecorder', class {});
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
        getDisplayMedia: vi.fn(() =>
          Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
        ),
      },
    });
    const onError = vi.fn();
    render(<CommentRecorder onDone={() => {}} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Record screen/ })));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Screen sharing was refused/));
    vi.unstubAllGlobals();
  });
});
