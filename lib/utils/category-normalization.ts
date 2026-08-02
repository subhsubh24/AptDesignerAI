/**
 * Categories on the search request body can be plain strings or rich objects
 * (`{ category, search_title, specs }`). A client can send a rich object with
 * no (or a non-string) `category` field — e.g. `{ search_title: "Modern Sofa" }`
 * — which previously produced `undefined` from the map step and crashed the
 * next `.toLowerCase()` call with an unhandled 500 instead of a clean 400.
 * This normalizes + drops anything that isn't a usable string.
 */
export function normalizeMissingCategories(
  rawCategories: Array<string | { category?: unknown; [key: string]: unknown }>,
  identifiedCategories: Set<string>,
): string[] {
  return rawCategories
    .map((c) => (typeof c === "string" ? c : c.category))
    .filter((cat): cat is string => typeof cat === "string" && cat.length > 0)
    .filter((cat) => !identifiedCategories.has(cat.toLowerCase()));
}
