/**
 * Excel cells carry no timezone: ExcelJS serialises a JS `Date` by its UTC
 * wall-clock, so a due date stored as `23:00Z` (7:00 PM in a UTC-4 zone) would
 * print as 23:00 — an hour(s) off from what the app shows in local time.
 *
 * This converts an ISO instant into a "display Date" whose UTC components equal
 * the instant's wall-clock in `timeZone`, so ExcelJS prints the local time the
 * user sees in the app. DST is handled per-instant via `Intl`. Falls back to the
 * raw instant when no valid timezone is supplied.
 */
export function toExcelLocalDate(
  iso: string | null | undefined,
  timeZone: string | undefined,
): Date | string {
  if (!iso) return '';
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  if (!timeZone) return instant;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(instant);
  } catch {
    // Unknown/invalid timezone → leave the instant unchanged.
    return instant;
  }

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some environments render midnight as hour "24"; normalise to 0.
  const hour = get('hour') % 24;
  return new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second')),
  );
}
