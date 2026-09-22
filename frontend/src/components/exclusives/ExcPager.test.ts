import { describe, expect, it } from 'vitest';
import { pageWindow } from './ExcPager';

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
