import { describe, it, expect } from "vitest";
import { pickLatestDiagnosis } from "@/lib/diagnosis/latest-diagnosis";

describe("pickLatestDiagnosis", () => {
  it("returns undefined for an empty list", () => {
    expect(pickLatestDiagnosis([])).toBeUndefined();
  });

  it("returns the sole row", () => {
    const row = { id: "a", created_at: "2026-01-01T00:00:00Z", note: "x" };
    expect(pickLatestDiagnosis([row])).toBe(row);
  });

  it("picks the most recent by created_at", () => {
    const older = { id: "a", created_at: "2026-01-01T00:00:00Z" };
    const newer = { id: "b", created_at: "2026-02-01T00:00:00Z" };
    expect(pickLatestDiagnosis([older, newer])?.id).toBe("b");
    // Order-independent: the newest wins regardless of input order.
    expect(pickLatestDiagnosis([newer, older])?.id).toBe("b");
  });

  it("breaks created_at ties deterministically by id (highest id wins)", () => {
    const ts = "2026-03-01T12:00:00Z";
    const a = { id: "id-aaa", created_at: ts };
    const b = { id: "id-bbb", created_at: ts };
    const c = { id: "id-ccc", created_at: ts };
    // Same timestamp on all three: the pick must be stable across ANY input
    // permutation (the bug this guards: a created_at-only sort flips the pick,
    // and with it the seeded LLM prompt — a determinism-contract violation).
    const permutations = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
      [c, a, b],
    ];
    for (const perm of permutations) {
      expect(pickLatestDiagnosis(perm)?.id).toBe("id-ccc");
    }
  });

  it("prefers a newer timestamp over a higher id (created_at dominates)", () => {
    const newerLowId = { id: "id-aaa", created_at: "2026-05-02T00:00:00Z" };
    const olderHighId = { id: "id-zzz", created_at: "2026-05-01T00:00:00Z" };
    expect(pickLatestDiagnosis([olderHighId, newerLowId])?.id).toBe("id-aaa");
  });

  it("does not mutate the input array", () => {
    const rows = [
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", created_at: "2026-02-01T00:00:00Z" },
    ];
    const snapshot = rows.map((r) => r.id);
    pickLatestDiagnosis(rows);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
