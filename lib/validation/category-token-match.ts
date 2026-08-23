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
 *
 * Plain set-intersection over BOTH sides' tokens is too loose on its own: two
 * unrelated *compound* categories that happen to share one generic token
 * would cross-match (e.g. "table_lamp" and "coffee_table" both contain
 * "table"; "wall_sconce" and "wall_art" both contain "wall") — the same
 * shape of bug this function exists to fix, just one level up. So a shared
 * token only counts when at least one side is a SINGLE token: a simple
 * category ("sofa", "table", "art") matching one component of a compound
 * category ("sectional_sofa", "dining_table", "wall_art") is the pattern the
 * codebase's aliases actually rely on; two multi-token compounds sharing only
 * a generic sub-token are NOT treated as the same item.
 */
export function categoriesShareToken(a: string, b: string): boolean {
  if (a === b) return true;
  const tokensA = a.split("_").filter(Boolean);
  const tokensB = b.split("_").filter(Boolean);
  if (tokensA.length === 1) return tokensB.includes(tokensA[0]);
  if (tokensB.length === 1) return tokensA.includes(tokensB[0]);
  return false;
}
