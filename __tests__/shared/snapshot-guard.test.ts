import { describe, it, expect } from "vitest";
import { isValidSnapshot } from "@/app/shared/[token]/snapshot-guard";

/** A minimal, well-formed assessment snapshot the shared view can render. */
function validSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    assessment: {
      what_it_needs: [{ category: "seating", description: "a sofa", priority: "high", specs: "3-seat" }],
      what_works: ["good light"],
      what_should_go: ["the old rug"],
      design_direction: "warm mid-century",
      room_description: "a sunlit living room",
      ...overrides,
    },
  };
}

describe("isValidSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(isValidSnapshot(validSnapshot())).toBe(true);
  });

  it("accepts a snapshot with empty (but present) arrays", () => {
    expect(
      isValidSnapshot(validSnapshot({ what_it_needs: [], what_works: [], what_should_go: [] })),
    ).toBe(true);
  });

  it("rejects null / undefined / primitives", () => {
    expect(isValidSnapshot(null)).toBe(false);
    expect(isValidSnapshot(undefined)).toBe(false);
    expect(isValidSnapshot("snapshot")).toBe(false);
    expect(isValidSnapshot(42)).toBe(false);
  });

  it("rejects a snapshot missing the assessment object", () => {
    expect(isValidSnapshot({})).toBe(false);
    expect(isValidSnapshot({ assessment: null })).toBe(false);
    expect(isValidSnapshot({ assessment: "nope" })).toBe(false);
  });

  it("rejects when a required array field is the wrong type", () => {
    expect(isValidSnapshot(validSnapshot({ what_it_needs: "sofa" }))).toBe(false);
    expect(isValidSnapshot(validSnapshot({ what_works: null }))).toBe(false);
    expect(isValidSnapshot(validSnapshot({ what_should_go: {} }))).toBe(false);
  });

  it("rejects when a required string field is missing or the wrong type", () => {
    const noDirection = validSnapshot();
    delete (noDirection.assessment as Record<string, unknown>).design_direction;
    expect(isValidSnapshot(noDirection)).toBe(false);
    expect(isValidSnapshot(validSnapshot({ room_description: 123 }))).toBe(false);
  });
});
