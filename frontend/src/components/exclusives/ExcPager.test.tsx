import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExcPager, pageWindow } from './ExcPager';

describe('pageWindow', () => {
  it('shows every page while there are only a few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the first and last page, with a window around the current one', () => {
    expect(pageWindow(1, 40)).toEqual([1, 2, 3, 'gap', 40]);
    expect(pageWindow(20, 40)).toEqual([1, 'gap', 18, 19, 20, 21, 22, 'gap', 40]);
    expect(pageWindow(40, 40)).toEqual([1, 'gap', 38, 39, 40]);
  });

  it('never draws more than a handful of buttons, however many pages there are', () => {
    // Paging is server-side now: 10,000 alerts at 25 a page is 400 pages, and
    // the old pager drew a button for every one of them.
    expect(pageWindow(200, 400).length).toBeLessThanOrEqual(9);
  });

  it('does not leave a gap marker where no page is skipped', () => {
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('Previous and Next', () => {
  /** 100 rows at 25 a page: four pages, starting on page 2. */
  const pager = () => {
    const onPage = vi.fn();
    render(<ExcPager total={100} page={2} pageSize={25} onPage={onPage} onPageSize={vi.fn()} />);
    return onPage;
  };

  it('move one page a click', () => {
    const onPage = pager();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }), { detail: 1 });
    expect(onPage).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }), { detail: 1 });
    expect(onPage).toHaveBeenLastCalledWith(1);
  });

  it('move one page, not two, on a double-click', () => {
    const onPage = pager();
    // What a browser sends for a double-click: a click, then a second one
    // counted as the second in a row.
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(next, { detail: 1 });
    fireEvent.click(next, { detail: 2 });
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(3);

    const previous = screen.getByRole('button', { name: 'Previous' });
    fireEvent.click(previous, { detail: 1 });
    fireEvent.click(previous, { detail: 2 });
    fireEvent.click(previous, { detail: 3 });
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenLastCalledWith(1);
  });

  it('still work from the keyboard, which sends a click counted as 0', () => {
    const onPage = pager();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }), { detail: 0 });
    expect(onPage).toHaveBeenCalledWith(3);
  });

  it('leave the numbered pages alone', () => {
    const onPage = pager();
    const three = screen.getByRole('button', { name: '3' });
    fireEvent.click(three, { detail: 1 });
    fireEvent.click(three, { detail: 2 });
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenNthCalledWith(2, 3);
  });
});
