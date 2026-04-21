/**
 * Parse pagination params from a request URL with sensible defaults.
 *
 * Accepts `?limit=…&offset=…`. Caps limit at `maxLimit` so a client can't
 * request a million rows. Clamps negatives. Returns `null`-ish values as the
 * defaults.
 */
export interface PaginationParams {
  limit: number;
  offset: number;
  /** Supabase `.range()` end index (inclusive). */
  rangeEnd: number;
}

export interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export function parsePagination(
  searchParams: URLSearchParams,
  opts: PaginationOptions = {},
): PaginationParams {
  const defaultLimit = opts.defaultLimit ?? 100;
  const maxLimit = opts.maxLimit ?? 500;

  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));

  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0
    ? Math.floor(rawOffset)
    : 0;

  return {
    limit,
    offset,
    rangeEnd: offset + limit - 1,
  };
}
