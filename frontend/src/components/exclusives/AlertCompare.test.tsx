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
  it('is offered for every alert with a before and now, not the Buy Box or a suppressed listing', () => {
    expect(canCompare(row())).toBe(true);
    expect(canCompare(row({ alertType: 'BulletPointsChanged' }))).toBe(true);
    expect(canCompare(row({ alertType: 'TitleChanged' }))).toBe(true);
    expect(canCompare(row({ alertType: 'PriceChanged', previousValue: '1', newValue: '2' }))).toBe(
      true,
    );
    expect(canCompare(row({ alertType: 'BuyBoxLost' }))).toBe(false);
    expect(canCompare(row({ alertType: 'ListingSuppressed' }))).toBe(false);
    expect(canCompare(row({ previousValue: null, newValue: null }))).toBe(false);
  });

  it('heads the pop-up like the email: product, ASIN, time, what changed', () => {
    render(<AlertCompareLink row={row()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare before and now' }));
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    const order = [
      'Organic Green Tea',
      'ASIN B0ABC12345 · USA',
      'Alerted',
      'Description changed:',
      'Before',
    ];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('a brand that is gone shows "Removed" in red', () => {
    render(
      <AlertCompareLink
        row={row({ alertType: 'BrandChanged', previousValue: 'Acme', newValue: null })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare before and now' }));
    const now = screen.getByRole('region', { name: 'Now' });
    expect(now.querySelector('.exc-removed')?.textContent).toBe('Removed');
  });

  it('the main image: both pictures, with their addresses', () => {
    render(
      <AlertCompareLink
        row={row({
          alertType: 'MainImageChanged',
          previousValue: 'https://m.media-amazon.com/a.jpg',
          newValue: 'https://m.media-amazon.com/b.jpg',
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare before and now' }));
    expect(screen.getByRole('img', { name: 'Before image' })).toHaveAttribute(
      'src',
      'https://m.media-amazon.com/a.jpg',
    );
    expect(screen.getByRole('img', { name: 'Now image' })).toHaveAttribute(
      'src',
      'https://m.media-amazon.com/b.jpg',
    );
    expect(screen.getByRole('region', { name: 'Now' })).toHaveTextContent(
      'https://m.media-amazon.com/b.jpg',
    );
  });

  it('competitive price below ours: "Compare prices", each price in its box, and the gap', () => {
    render(
      <AlertCompareLink
        row={row({
          alertType: 'CompetitivePriceBelowOurs',
          previousValue: '15.5',
          newValue: '7.86',
          message:
            "Amazon's competitive price went from $15.50 to $7.86, now below our HL price of " +
            '$14.99 (price + shipping): the Buy Box is at risk.',
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compare prices' }));
    expect(screen.getByRole('region', { name: 'Amazon competitive price' })).toHaveTextContent(
      '$7.86Was $15.50',
    );
    expect(screen.getByRole('region', { name: 'Our HL price' })).toHaveTextContent('$14.99');
    expect(
      screen.getByText("Amazon's competitive price is $7.13 below our HL price."),
    ).toBeInTheDocument();
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

  it('shows nothing for an alert with nothing to compare', () => {
    const { container } = render(<AlertCompareLink row={row({ alertType: 'BuyBoxLost' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
