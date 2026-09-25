// A small RFC 4180 writer. The Exclusives exports are CSV by decision (every
// other download in this app is xlsx via exceljs), and they are the only ones,
// so this stays here rather than pulling in a dependency.

// Excel reads a CSV as the system codepage unless the file starts with a
// byte-order mark, and accented characters then arrive as mojibake. Kept as an
// escape in a plain string, because the character itself is invisible.
const BOM = '﻿';

/** Quote a value only when it has to be, and double any quotes inside it. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A CSV document: CRLF line endings, and the byte-order mark Excel wants.
 * An empty `headers` writes no heading row - for files meant to be read back
 * by a machine (the group list, which the bulk importer re-reads) rather than
 * by a person.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const body = rows.map((row) => row.map(cell).join(','));
  const lines = headers.length > 0 ? [headers.map(cell).join(','), ...body] : body;
  return BOM + lines.join('\r\n') + '\r\n';
}

/** A date as the viewer's clock would show it, for a CSV column. */
export function csvDate(value: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // h23, not hour12:false — that gives "24:47" for midnight in some locales.
      hourCycle: 'h23',
    }).formatToParts(value);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch {
    // An unknown time zone must not fail a download.
    return value.toISOString().slice(0, 16).replace('T', ' ');
  }
}
