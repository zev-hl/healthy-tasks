/**
 * The websites allowed to call the API, from `CORS_ORIGIN`: one origin, or
 * several separated by commas (e.g. the staging site and the redesign preview
 * that shares its API). Entries are trimmed and blanks dropped, so
 * "https://a.example, https://b.example" works.
 */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * What to give the `cors` package. One origin stays a plain string, exactly as
 * before (the header always names it); several become a list, and the header
 * names whichever of them the request came from (none for any other site).
 */
export function corsOriginOption(origins: readonly string[]): string | string[] {
  return origins.length === 1 ? origins[0]! : [...origins];
}

/** Whether a request's `Origin` header is one of the allowed websites. */
export function isAllowedOrigin(origin: string | undefined, origins: readonly string[]): boolean {
  return origin !== undefined && origins.includes(origin);
}
