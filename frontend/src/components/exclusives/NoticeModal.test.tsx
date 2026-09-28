import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NoticeModal } from './NoticeModal';

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('NoticeModal', () => {
  it('waits to be acknowledged, however long that takes', async () => {
    const onClose = vi.fn();
    render(<NoticeModal message="Something went wrong." onClose={onClose} />);

    await advance(60_000);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Enter or Escape as well as the button', async () => {
    const onClose = vi.fn();
    render(<NoticeModal message="Something went wrong." onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes itself, with no button, when it is only a confirmation', async () => {
    const onClose = vi.fn();
    render(
      <NoticeModal
        title="Imported"
        message="12 ASINs ready."
        onClose={onClose}
        autoCloseMs={1_000}
      />,
    );

    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await advance(1_000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the message it was given, under its own title', () => {
    render(<NoticeModal title="Saved" message="Two ASINs are watched." onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Saved');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Two ASINs are watched.');
  });
});
