/**
 * Country flag swatch + short code for a marketplace (HLAI-71).
 * Small 15×10 rounded swatch matching the design; US = navy canton over red/
 * white stripes, CA = red maple leaf.
 */
import type { ExclusivesMarketplace } from '@healthy-tasks/shared';

const CODE: Record<ExclusivesMarketplace, string> = { USA: 'US', Canada: 'CA' };

export function Flag({
  platform,
  code = true,
}: {
  platform: ExclusivesMarketplace;
  code?: boolean;
}) {
  return (
    <span className="exc-flag-wrap">
      {platform === 'Canada' ? (
        <svg className="exc-flag" viewBox="0 0 30 20" aria-hidden="true">
          <rect width="30" height="20" fill="#fff" />
          <rect width="7.5" height="20" fill="#d52b1e" />
          <rect x="22.5" width="7.5" height="20" fill="#d52b1e" />
          <path
            fill="#d52b1e"
            d="M15 5.5l.9 1.9 2-.4-.9 1.9 1.6 1.2-2 .5.1 2-1.8-1-1.8 1 .1-2-2-.5 1.6-1.2-.9-1.9 2 .4z"
          />
        </svg>
      ) : (
        <svg className="exc-flag" viewBox="0 0 30 20" aria-hidden="true">
          <rect width="30" height="20" fill="#fff" />
          <g fill="#B3452F">
            <rect y="0" width="30" height="2.2" />
            <rect y="4.4" width="30" height="2.2" />
            <rect y="8.8" width="30" height="2.2" />
            <rect y="13.2" width="30" height="2.2" />
            <rect y="17.6" width="30" height="2.2" />
          </g>
          <rect width="13" height="11" fill="#2B3A67" />
        </svg>
      )}
      {code && <span className="exc-flag-code">{CODE[platform]}</span>}
    </span>
  );
}
