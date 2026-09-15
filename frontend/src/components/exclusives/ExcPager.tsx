/**
 * Exclusives table pager (HLAI-71) — matches the design: a range label, the
 * 25/50/100 size chips, and Previous · numbered-page · Next controls.
 */
const SIZES = [25, 50, 100] as const;

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
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

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
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`exc-page-num${p === page ? ' active' : ''}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        ))}
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
