import { useLayoutEffect, useRef } from 'react';

/**
 * Keep a page's filter row in view while its list scrolls (meeting decision,
 * Nov 11: headers stay put, the data scrolls under them). Returns a ref for the
 * row; its height (it can wrap) is published as `--hb-sticky-top` on the page
 * body, so the table's column headings can stick just below it.
 */
export function useStickyToolbar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const set = () => host.style.setProperty('--hb-sticky-top', `${el.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}
