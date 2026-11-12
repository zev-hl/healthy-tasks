import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { diffWords, plainText, type ExclusivesAlertRowDto } from '@healthy-tasks/shared';
import { AlertCompareLink, canCompare } from './AlertCompare';

const row = (over: Partial<ExclusivesAlertRowDto> = {}): ExclusivesAlertRowDto => ({
  id: 1,
  groupId: 1,
  groupName: 'Wasif - US',
  listingId: 1,
  asin: 'B0ABC12345',
  marketplace: 'USA',
  title: 'Organic Green Tea',
  alertType: 'DescriptionChanged',
  category: null,
  message: 'Description changed from "..." to "...".',
  previousValue: 'Great tea for busy mornings, brewed in five minutes.',
  newValue: 'Great tea for busy mornings, steeped in three minutes.',
  createdAt: '2026-11-12T13:42:00Z',
  ...over,
});

const changed = (parts: { text: string; changed: boolean }[]) =>
  parts.filter((p) => p.changed).map((p) => p.text);

describe('diffWords', () => {
  it('marks only the words that differ, on each side', () => {
    const d = diffWords('brewed in five minutes', 'steeped in three minutes');
    expect(changed(d.before)).toEqual(['brewed', 'five']);
    expect(changed(d.after)).toEqual(['steeped', 'three']);
    expect(d.before.map((p) => p.text).join('')).toBe('brewed in five minutes');
    expect(d.after.map((p) => p.text).join('')).toBe('steeped in three minutes');
  });

  it('keeps neighbouring changed words in one run, without the space after it', () => {
    const d = diffWords('a b c d', 'a x y d');
    expect(changed(d.after)).toEqual(['x y']);
  });

  it('handles added and removed text', () => {
    expect(changed(diffWords('one two', 'one two three').after)).toEqual(['three']);
    expect(changed(diffWords('one two three', 'one three').before)).toEqual(['two']);
    expect(changed(diffWords('', 'all new').after)).toEqual(['all new']);
  });
});

describe('plainText', () => {
  it('turns a description’s HTML into readable lines', () => {
    expect(plainText('<p>Tea &amp; honey</p><ul><li>Hot</li><li>Iced</li></ul>')).toBe(
      'Tea & honey\n• Hot\n• Iced',
    );
    expect(plainText('a<br>b')).toBe('a\nb');
    expect(plainText(null)).toBe('');
  });
});

describe('Compare before and now', () => {
  it('is offered for title, description and bullet changes only', () => {
    expect(canCompare(row())).toBe(true);
    expect(canCompare(row({ alertType: 'BulletPointsChanged' }))).toBe(true);
    expect(canCompare(row({ alertType: 'TitleChanged' }))).toBe(true);
    expect(canCompare(row({ alertType: 'PriceChanged' }))).toBe(false);
    expect(canCompare(row({ previousValue: null, newValue: null }))).toBe(false);
  });

  it('shows both sides with the changes marked, and Escape closes only it', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    render(<AlertCompareLink row={row()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare before and now' }));

    expect(
      screen.getByRole('dialog', { name: 'Description Changed: before and now' }),
    ).toBeInTheDocument();
    const before = screen.getByRole('region', { name: 'Before' });
    const now = screen.getByRole('region', { name: 'Now' });
    expect([...before.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'brewed',
      'five',
    ]);
    expect([...now.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'steeped',
      'three',
    ]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The group panel behind it (listening on window) is not told.
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('shows nothing for an alert that is not a text change', () => {
    const { container } = render(<AlertCompareLink row={row({ alertType: 'PriceChanged' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
