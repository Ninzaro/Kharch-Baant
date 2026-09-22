/**
 * PostgREST treats "+" in a query string as a space, so
 * `2026-09-22T05:18:33.672242+00:00` becomes an invalid timestamptz and the
 * update returns 400. Keep the fractional seconds and use Z for UTC.
 */
export function postgrestTimestamptz(value: string): string {
  return value.replace(/\+00(?::00)?$/, 'Z');
}
