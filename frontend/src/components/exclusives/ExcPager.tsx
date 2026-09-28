/**
 * Exclusives table pager (HLAI-71) — matches the design: a range label, the
 * 25/50/100 size chips, and Previous · numbered-page · Next controls.
 */
const SIZES = [25, 50, 100] as const;

/** Pages either side of the current one that always get a button. */
const WINDOW = 2;

/**
 * The page buttons to draw: the first and last page, a window around the
 * current one, and a gap marker between. Paging is server-side, so a few
 * thousand alerts would otherwise render hundreds of buttons in one row.
 */
export function pageWindow(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 1) return [1];
  const wanted = new Set<number>([1, totalPages]);
  for (let p = current - WINDOW; p <= current + WINDOW; p += 1) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }

  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    if (previous && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

export function ExcPager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const pages = pageWindow(page, totalPages);

  return (
    <div className="exc-pager">
      <span className="mono muted exc-pager-range">
        {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
      </span>
      <div className="exc-pager-right">
        <span className="exc-pager-rows-label">Rows</span>
        <div className="exc-sizes">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={`exc-size${n === pageSize ? ' active' : ''}`}
              aria-pressed={n === pageSize}
              onClick={() => onPageSize(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="exc-page-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="exc-page-num muted" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`exc-page-num${p === page ? ' active' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="exc-page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
