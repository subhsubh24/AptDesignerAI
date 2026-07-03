import { describe, it, expect } from "vitest";
import { DiagnosisDataSchema } from "@/lib/types/schemas";

/**
 * Regression coverage for issue #306: a live diagnosis eval failed Zod
 * validation because the model returned room_type_confirmation.matches_declared
 * as the STRING "true"/"false" instead of a JSON boolean. The schema now
 * tolerates that via an explicit string→boolean map (looseBoolean) — crucially
 * WITHOUT the z.coerce.boolean() footgun (Boolean("false") === true), which
 * would silently flip a genuine "does not match" into "matches".
 */

// A minimal object that satisfies every required DiagnosisDataSchema field, so
// the only thing under test is matches_declared coercion.
function baseDiagnosis(matchesDeclared: unknown) {
  return {
    current_vibe_summary: "cozy but cluttered",
    what_is_working: ["good natural light"],
    what_is_not_working: ["too much clutter"],
    biggest_improvement_opportunities: ["declutter surfaces"],
    missing_furniture_categories: ["area rug"],
    color_issues: [],
    texture_material_issues: [],
    scale_proportion_issues: [],
    layout_issues: [],
    lighting_issues: [],
    clutter_editing_issues: [],
    room_type_confirmation: {
      inferred_room_type: "living room",
      matches_declared: matchesDeclared,
      confidence: "high",
      note: "",
    },
  };
}

function parseMatches(matchesDeclared: unknown): boolean | undefined {
  return DiagnosisDataSchema.parse(baseDiagnosis(matchesDeclared)).room_type_confirmation
    ?.matches_declared;
}

describe("DiagnosisDataSchema — matches_declared boolean coercion (#306)", () => {
  it('coerces the string "true" to boolean true', () => {
    const result = parseMatches("true");
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it('coerces the string "false" to boolean FALSE (not the z.coerce.boolean footgun)', () => {
    const result = parseMatches("false");
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });

  it("trims and lower-cases surrounding whitespace/case", () => {
    expect(parseMatches("  TRUE ")).toBe(true);
    expect(parseMatches("False")).toBe(false);
  });

  it("passes genuine booleans through unchanged", () => {
    expect(parseMatches(true)).toBe(true);
    expect(parseMatches(false)).toBe(false);
  });

  it("defaults to true when matches_declared is omitted", () => {
    const withoutField = baseDiagnosis(undefined);
    delete (withoutField.room_type_confirmation as { matches_declared?: unknown }).matches_declared;
    expect(DiagnosisDataSchema.parse(withoutField).room_type_confirmation?.matches_declared).toBe(
      true,
    );
  });

  it("still REJECTS a non-boolean garbage string (fails loud, no silent pass)", () => {
    expect(() => parseMatches("maybe")).toThrow();
  });

  it("still REJECTS a number (z.boolean rejects it)", () => {
    expect(() => parseMatches(1)).toThrow();
  });
});
