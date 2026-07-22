import { describe, it, expect } from "vitest";
import { formatDirectionDistanceForPrompt } from "@/lib/validation/direction-distance";
import type { DirectionDistance } from "@/lib/validation/direction-distance";

// Covers formatDirectionDistanceForPrompt — the prompt-rendering surface fed into
// the cross-room-fit diagnostic block. The scoring fn (computeDirectionDistance)
// is covered separately in direction-distance.test.ts; this pins the FORMATTER's
// distinct branches (the optional otherName label + the issues loop) so a
// rendering regression can't silently corrupt the cross-room compatibility
// evidence the diagnosis LLM reads.

function makeDistance(overrides: Partial<DirectionDistance> = {}): DirectionDistance {
  return {
    overall: 0.3,
    palette_distance: 0.2,
    material_distance: 0.4,
    style_distance: 0.3,
    raw: {
      palette_mean_deltaE: 18.5,
      material_mean_euclidean: 0.42,
      style_jaccard: 0.67,
    },
    compatibility_score: 0.7,
    issues: [],
    ...overrides,
  };
}

describe("formatDirectionDistanceForPrompt", () => {
  it("appends the ' vs {otherName}' label to the header when otherName is provided", () => {
    const out = formatDirectionDistanceForPrompt(
      makeDistance({ compatibility_score: 0.85 }),
      "Living Room",
    );
    expect(out).toContain("### Direction compatibility vs Living Room: 0.85/1.0");
  });

  it("omits the ' vs' label when otherName is absent", () => {
    // A mutation that always renders the label would leak a dangling ' vs '
    // fragment (or 'undefined') into the header when no comparison room is named.
    const out = formatDirectionDistanceForPrompt(makeDistance({ compatibility_score: 0.85 }));
    expect(out).toContain("### Direction compatibility: 0.85/1.0");
    expect(out).not.toContain(" vs ");
  });

  it("renders the raw metrics line with the ΔE / Euclid / Jaccard values", () => {
    const out = formatDirectionDistanceForPrompt(
      makeDistance({
        raw: { palette_mean_deltaE: 40.2, material_mean_euclidean: 0.55, style_jaccard: 0.12 },
      }),
    );
    expect(out).toContain("- Palette ΔE=40.2 | material Euclid=0.55 | style Jaccard=0.12");
  });

  it("renders each surfaced issue as its own line", () => {
    const out = formatDirectionDistanceForPrompt(
      makeDistance({
        issues: ["palette is ~40 ΔE away from the living room", "materials skew colder"],
      }),
    );
    expect(out).toContain("- palette is ~40 ΔE away from the living room");
    expect(out).toContain("- materials skew colder");
  });
});
