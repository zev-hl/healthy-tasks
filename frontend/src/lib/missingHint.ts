/**
 * The short line shown next to a disabled Create button, saying what is still
 * needed: "Still needed: a title, who it’s for and a duty." Null when nothing is
 * missing. One wording for New task, the quick "+" and New goal.
 */
export function missingHint(missing: string[]): string | null {
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Still needed: ${list}.`;
}
