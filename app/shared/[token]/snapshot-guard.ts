/**
 * Runtime shape guard for a shared design's `snapshot.assessment`.
 *
 * A public `saved_designs` row whose snapshot is missing or malformed (an older
 * schema, or a partially written save) would otherwise 500 the public shared
 * page — both `generateMetadata` and the view dereference
 * `snapshot.assessment.*`. This guard lets the page degrade a bad row to a clean
 * 404 instead of crashing a public growth surface. Kept as a standalone pure
 * function so it is unit-testable without importing the server page module.
 */
export function isValidSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const assessment = (snapshot as { assessment?: unknown }).assessment;
  if (!assessment || typeof assessment !== "object") return false;
  const a = assessment as Record<string, unknown>;
  return (
    Array.isArray(a.what_it_needs) &&
    Array.isArray(a.what_works) &&
    Array.isArray(a.what_should_go) &&
    typeof a.design_direction === "string" &&
    typeof a.room_description === "string"
  );
}
