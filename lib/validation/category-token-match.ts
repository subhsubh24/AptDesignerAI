/**
 * Whole-token category matching, shared by the `get*IssuesForItem` helpers in
 * budget-allocation / outlet-reach / ergonomics / access-constraints.
 *
 * Those helpers used to fuzzy-match with plain substring `.includes()`
 * (`cat.includes(other) || other.includes(cat)`), which cross-matches any
 * category whose normalized (underscore-joined) name happens to contain
 * another category's name as a substring — e.g. `"bedside_table".includes("bed")`
 * is `true`, so a nightstand item wrongly picked up an unrelated "bed" issue
 * (APT-61). Matching on whole `_`-delimited tokens instead keeps every
 * legitimate case (`"sectional_sofa"` still matches `"sofa"`, `"dining_table"`
 * still matches `"table"` — both share a whole token) while rejecting
 * accidental substring collisions that don't share a token.
 */
export function categoriesShareToken(a: string, b: string): boolean {
  if (a === b) return true;
  const tokensA = new Set(a.split("_").filter(Boolean));
  const tokensB = new Set(b.split("_").filter(Boolean));
  for (const t of tokensA) {
    if (tokensB.has(t)) return true;
  }
  return false;
}
