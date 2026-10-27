/** A time of day as a person sets it: 24-hour, to the minute. */
export interface ClockTime {
  hour: number;
  minute: number;
}

/** "08:30" (or "8:30") → { hour: 8, minute: 30 }; null for anything else. */
export function parseClockTime(value: string): ClockTime | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** { hour: 16, minute: 59 } → "4:59 PM"; midnight is "12:00 AM". */
export function formatClockTime(t: ClockTime): string {
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${hour12}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}
