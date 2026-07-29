import { describe, it, expect } from "vitest";
import { parseDimensions, computeSpatialConstraints } from "@/lib/validation/spatial-math";

describe("parseDimensions", () => {
  it("parses W x D x H with an explicit inches unit", () => {
    expect(parseDimensions("72x36x30 inches")).toEqual({ width: 72, depth: 36, height: 30 });
  });

  it("parses W x D (no height) and leaves height undefined", () => {
    const d = parseDimensions("72 x 36");
    expect(d).toEqual({ width: 72, depth: 36 });
    expect(d?.height).toBeUndefined();
  });

  it("treats a single dimension as square-ish for area estimation", () => {
    expect(parseDimensions("60in")).toEqual({ width: 60, depth: 60 });
  });

  it("accepts the ×, x, and - separators interchangeably", () => {
    expect(parseDimensions("72×36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("72-36")).toEqual({ width: 72, depth: 36 });
  });

  it("parses decimal values", () => {
    expect(parseDimensions("72.5x36.25")).toEqual({ width: 72.5, depth: 36.25 });
  });

  it("converts feet to inches (ft / feet / ')", () => {
    expect(parseDimensions("6ft")).toEqual({ width: 72, depth: 72 });
    expect(parseDimensions("6 feet")).toEqual({ width: 72, depth: 72 });
    expect(parseDimensions("6x4 ft")).toEqual({ width: 72, depth: 48 });
  });

  it("parses inline foot marks between each number and the separator (rug specs)", () => {
    // `6' x 4'` puts the foot mark BEFORE the `x` separator — the old regex read
    // only `6'` and returned a 72×72 square. Rugs are almost always specced this
    // way (e.g. `6' x 9'`), so this must yield distinct width/depth.
    expect(parseDimensions("6' x 4'")).toEqual({ width: 72, depth: 48 });
    expect(parseDimensions("6' x 9'")).toEqual({ width: 72, depth: 108 });
    expect(parseDimensions("5'x8'")).toEqual({ width: 60, depth: 96 });
  });

  it("parses inline inch marks between each number and the separator", () => {
    expect(parseDimensions('72" x 36"')).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions('84" x 60" x 30"')).toEqual({ width: 84, depth: 60, height: 30 });
  });

  it("parses a spelled-out inch unit attached to each number", () => {
    // Regression: `UNIT_ALT` used `inches?` which matches "inche"/"inches" but
    // NOT bare "inch", so `6inch x 4inch` matched only "6in", failed to find the
    // separator, and fell into the single-dimension branch as a 6x6 SQUARE. With
    // `inch(?:es)?` the "inch" token is consumed and both axes parse.
    expect(parseDimensions("6inch x 4inch")).toEqual({ width: 6, depth: 4 });
    expect(parseDimensions("6inches x 4inches")).toEqual({ width: 6, depth: 4 });
    // A single spelled-out unit on the trailing axis still applies to both.
    expect(parseDimensions("72 x 36 inch")).toEqual({ width: 72, depth: 36 });
  });

  it("applies a single trailing unit to every unlabeled axis", () => {
    // Only the last token carries the unit; it must apply to all three axes.
    expect(parseDimensions("6 x 4 x 3 ft")).toEqual({ width: 72, depth: 48, height: 36 });
  });

  it("carries a unit stated on the first axis over to an unmarked second axis", () => {
    // `6' x 4` states feet once (on the first token); both axes are feet.
    expect(parseDimensions("6' x 4")).toEqual({ width: 72, depth: 48 });
  });

  it("converts centimetres to inches", () => {
    const d = parseDimensions("100cm");
    expect(d?.width).toBeCloseTo(39.37, 1);
    expect(d?.depth).toBeCloseTo(39.37, 1);
  });

  it("converts millimetres to inches", () => {
    const d = parseDimensions("1000mm");
    expect(d?.width).toBeCloseTo(39.37, 1);
  });

  it("defaults to inches when no unit is given", () => {
    expect(parseDimensions("48x24")).toEqual({ width: 48, depth: 24 });
  });

  it("returns null when there is no numeric dimension", () => {
    expect(parseDimensions("a comfy linen sofa")).toBeNull();
    expect(parseDimensions("")).toBeNull();
  });

  it("is re-entrant — repeated calls do not drift via the shared regex lastIndex", () => {
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
    expect(parseDimensions("10x10")).toEqual({ width: 10, depth: 10 });
    expect(parseDimensions("72x36")).toEqual({ width: 72, depth: 36 });
  });

  // Label-suffixed retail form (`90"W x 38"D x 32"H`) — the shape the pipeline's
  // `WhatItNeedsItem.specs` actually carries. Before the labeled path this
  // returned a bogus 90×90 square (the positional regex stopped at `90"`),
  // silently disabling the nightstand/side_table/dining-depth pairwise rules.
  it("parses W/D/H letter-suffixed specs with inline inch marks", () => {
    expect(parseDimensions('90"W x 38"D x 32"H')).toEqual({ width: 90, depth: 38, height: 32 });
  });

  it("parses letter-suffixed W x D with no height", () => {
    const d = parseDimensions('48"W x 24"D');
    expect(d).toEqual({ width: 48, depth: 24 });
    expect(d?.height).toBeUndefined();
  });

  it("parses letter-suffixed specs using the × separator", () => {
    expect(parseDimensions("90in W × 38in D × 32in H")).toEqual({ width: 90, depth: 38, height: 32 });
  });

  it("maps axes by their W/D/H label regardless of order", () => {
    expect(parseDimensions('32"H x 90"W x 38"D')).toEqual({ width: 90, depth: 38, height: 32 });
  });

  it("does not read a bare descriptive word as a W/D/H axis", () => {
    // "Walnut" / "Deep" must not be mistaken for W/D axes; with no valid pair of
    // labeled axes it falls back to the positional parser (square-ish).
    expect(parseDimensions("90 Walnut")).toEqual({ width: 90, depth: 90 });
    expect(parseDimensions("36 Deep shelf")).toEqual({ width: 36, depth: 36 });
  });

  it("converts units inside a labeled spec", () => {
    const d = parseDimensions("6ft W x 4ft D");
    expect(d).toEqual({ width: 72, depth: 48 });
  });

  // Regression: the COMPACT form with no space before the `x`/`×` separator
  // (`90"Wx38"Dx32"H`) is a common retail convention. A naive `(?![A-Za-z])`
  // axis guard rejects the `x` separator and silently drops width/depth —
  // reintroducing the exact square-fallback bug this parser fixes.
  it("parses the compact no-space labeled form (W immediately followed by x)", () => {
    expect(parseDimensions('90"Wx38"Dx32"H')).toEqual({ width: 90, depth: 38, height: 32 });
    expect(parseDimensions('90"Wx38"D')).toEqual({ width: 90, depth: 38 });
    expect(parseDimensions("90Wx38Dx32H")).toEqual({ width: 90, depth: 38, height: 32 });
  });

  // A label-BEFORE-value form (`W: 90"...`) is not a shape we support; it must
  // fall back safely (positional square) rather than confidently mislabel axes.
  it("does not confidently mislabel a label-before-value spec", () => {
    expect(parseDimensions('W: 90" D: 38" H: 32"')).toEqual({ width: 90, depth: 90 });
  });
});

describe("computeSpatialConstraints", () => {
  it("returns neutral defaults for an empty needs list with no floor plan", () => {
    const r = computeSpatialConstraints({ what_it_needs: [] }, { roomType: "living_room" });
    expect(r.room_coverage_ratio).toBe(0.7);
    expect(r.clearance_score).toBe(0.7); // no clearance checks ran → neutral
    expect(r.violations).toEqual([]);
    expect(r.placement_conflicts).toEqual([]);
    expect(r.per_item_spatial.size).toBe(0);
  });

  it("passes clearance neutrally when room dimensions are unknown", () => {
    const r = computeSpatialConstraints(
      { what_it_needs: [{ category: "sofa", specs: "84x36" }] },
      { roomType: "living_room" },
    );
    // sofa has clearance rules but with no room dims they can't be measured →
    // treated as neutral passes, so no violations and full clearance credit.
    expect(r.violations).toEqual([]);
    expect(r.clearance_score).toBe(1);
    expect(r.per_item_spatial.has("sofa")).toBe(true);
    const score = r.per_item_spatial.get("sofa")!;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("flags more than two non-paired items crowded into one placement zone", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "sofa", placement: "north wall" },
          { category: "desk", placement: "north wall" },
          { category: "bookcase", placement: "north wall" },
        ],
      },
      { roomType: "living_room" },
    );
    // 3 unrelated items in the same zone → every pair is a conflict (C(3,2)=3).
    expect(r.placement_conflicts.length).toBe(3);
    for (const c of r.placement_conflicts) expect(c.zone).toBe("north wall");
  });

  it("does not flag two items sharing a zone (a pair is allowed)", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "sofa", placement: "south wall" },
          { category: "desk", placement: "south wall" },
        ],
      },
      { roomType: "living_room" },
    );
    expect(r.placement_conflicts).toEqual([]);
  });

  it("exempts natural furniture pairs from the crowding conflict", () => {
    const r = computeSpatialConstraints(
      {
        what_it_needs: [
          { category: "dining_table", placement: "center" },
          { category: "dining_chair", placement: "center" },
          { category: "vase", placement: "center" },
        ],
      },
      { roomType: "dining_room" },
    );
    // dining_table|dining_chair and vase|dining_table are natural pairs; only
    // dining_chair|vase is left as a conflict.
    expect(r.placement_conflicts.length).toBe(1);
    const pair = [r.placement_conflicts[0].item1, r.placement_conflicts[0].item2].sort();
    expect(pair).toEqual(["dining_chair", "vase"]);
  });
});

/**
 * Everything above runs WITHOUT a floor plan, so `parseRoomDimensions` returns
 * null and the whole dimensional half of `computeSpatialConstraints` is skipped:
 * coverage keeps its 0.7 default and every clearance rule takes the
 * "can't verify → neutral pass" branch. These cases supply a real floor plan so
 * that half actually executes.
 *
 * Room dimensions are given in inches to match the module's internal unit, so
 * the arithmetic below is legible rather than unit-converted behind the scenes.
 */
describe("computeSpatialConstraints — room coverage bands (floor plan present)", () => {
  // 100" x 100" = 10,000 sq in. living_room ideal coverage is [0.45, 0.65],
  // so the ideal band is a 4,500–6,500 sq in footprint. "armoire" is deliberate:
  // it carries the default footprint weight of 1.0 AND has no clearance rules,
  // so these cases isolate coverage from the clearance maths below.
  const room = { roomType: "living_room", floorPlan: { room_dimensions: "100x100 in" } };
  const withFootprint = (specs: string) =>
    computeSpatialConstraints({ what_it_needs: [{ category: "armoire", specs }] }, room);

  it("treats the LOWER edge of the ideal band as ideal, and never scores above 1", () => {
    // 90 x 50 = 4,500 = exactly idealMin (0.45).
    //
    // The `>=` here is load-bearing in a way worth spelling out, because the
    // obvious guess about how it fails is wrong. Weakening it to `>` does NOT
    // route this case to the under-furnished branch — `ratio < idealMin` is
    // false at the edge too, so it falls all the way through to the
    // OVER-furnished formula, which at ratio 0.45 computes
    // 1 - (0.45 - 0.65)/0.65 = 1.31. The clamp there is a Math.max, so nothing
    // catches it: a room with textbook-ideal coverage scores 1.31 on a scale
    // documented as 0-1, and every downstream score inherits the overflow.
    const r = withFootprint("90x50").room_coverage_ratio;
    expect(r).toBe(1.0);
    // Both assertions independently catch the mutation (1.31 is neither 1.0 nor
    // ≤ 1), and since the first to fail throws, this one is not what halts the
    // test in practice. It is here to state the invariant the interface promises
    // — a coverage RATIO must never exceed 1 — so the range is pinned in its own
    // right rather than only as a side effect of one fixture's exact value.
    expect(r).toBeLessThanOrEqual(1);
  });

  it("treats the UPPER edge of the ideal band as ideal", () => {
    // 100 x 65 = 6,500 = exactly idealMax (0.65).
    //
    // Stated honestly: unlike the lower edge, this case does NOT discriminate
    // `<=` from `<`. The over-furnished formula is continuous at idealMax —
    // 1 - (0.65 - 0.65)/0.65 is exactly 1.0 — so both spellings return the same
    // answer here, and so does every ratio just above it. The boundary is
    // behaviourally inert, and no fixture can make it otherwise.
    //
    // The assertion is kept anyway because the VALUE is worth pinning (a room at
    // the top of its ideal band must score a clean 1.0, not a penalty), but it
    // is not claimed as a guard on the comparison operator.
    expect(withFootprint("100x65").room_coverage_ratio).toBe(1.0);
  });

  it("scales the penalty for an under-furnished room, and floors it at 0.5", () => {
    // 60 x 50 = 3,000 → ratio 0.30 → 0.30/0.45 = 0.67, above the floor, so this
    // measures the FORMULA.
    expect(withFootprint("60x50").room_coverage_ratio).toBe(0.67);
    // 50 x 40 = 2,000 → ratio 0.20 → 0.20/0.45 = 0.44, below the floor, so this
    // measures the CLAMP. An empty room is sparse, not worthless — dropping the
    // Math.max would let a nearly-empty room score arbitrarily near zero.
    expect(withFootprint("50x40").room_coverage_ratio).toBe(0.5);
  });

  it("scales the penalty for an over-furnished room, and floors it at 0.3", () => {
    // 95 x 100 = 9,500 → ratio 0.95 → 1 - (0.95-0.65)/0.65 = 0.54. The formula.
    expect(withFootprint("95x100").room_coverage_ratio).toBe(0.54);
    // 200 x 100 = 20,000 → ratio 2.0 → 1 - (2.0-0.65)/0.65 = -1.08. Without the
    // Math.max this goes NEGATIVE and poisons every score downstream; the clamp
    // is what keeps the result inside 0-1.
    expect(withFootprint("200x100").room_coverage_ratio).toBe(0.3);
  });

  it("penalises over-furnishing HARDER than under-furnishing", () => {
    // The two floors are 0.5 (under) and 0.3 (over) and they are NOT
    // interchangeable: a room you can't walk through is a worse design outcome
    // than a room with space left. Swapping the two constants is a silent
    // inversion of that judgement that every individual assertion above would
    // still... not catch, because each only pins its own branch. This pins the
    // RELATIONSHIP.
    const under = withFootprint("50x40").room_coverage_ratio;
    const over = withFootprint("200x100").room_coverage_ratio;
    expect(over).toBeLessThan(under);
  });

  it("keeps the default when nothing in the list has parseable dimensions", () => {
    // `totalFootprint > 0` guards the whole block: a needs-list of accessories
    // with no specs must not compute a 0% coverage ratio and score the room as
    // catastrophically under-furnished.
    const r = computeSpatialConstraints(
      { what_it_needs: [{ category: "armoire" }, { category: "vase", specs: "not-a-size" }] },
      room,
    );
    expect(r.room_coverage_ratio).toBe(0.7);
  });

  it("gives wall- and surface-mounted items zero floor footprint", () => {
    // wall_art has weight 0, so a huge one must not read as over-furnishing.
    // Without the weight this 200x100 piece would floor the room at 0.3.
    const r = computeSpatialConstraints(
      { what_it_needs: [{ category: "wall_art", specs: "200x100" }] },
      room,
    );
    expect(r.room_coverage_ratio).toBe(0.7);
  });
});

describe("computeSpatialConstraints — hard vs soft clearance (floor plan present)", () => {
  // 120" x 200". A sofa carries two rules: 36" "main walkway in front" (HARD)
  // and 18" "to coffee table" (SOFT). Allowed spans work out to:
  //   hard rule → ≤48" on the short wall, ≤128" on the long wall
  //   soft rule → ≤84" on the short wall, ≤164" on the long wall
  const room = { roomType: "living_room", floorPlan: { room_dimensions: "120x200 in" } };
  const withSofa = (specs: string) =>
    computeSpatialConstraints({ what_it_needs: [{ category: "sofa", specs }] }, room);

  it("flags a HARD rule but passes a SOFT one when the item fits only the long wall", () => {
    // A 100" span sits between the short- and long-wall limits for BOTH rules,
    // so both take the "fits long, not short" branch and the ONLY thing
    // separating them is rule.hard. That makes this the case that actually
    // exercises the distinction.
    const r = withSofa("100x36");

    // The hard rule reports; the soft one does not. Asserting the constraint
    // TEXT (not just the count) is what catches an inverted `if (rule.hard)` —
    // a flip still produces exactly one violation, just the wrong one.
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].constraint).toBe("main walkway in front");
    expect(r.violations[0].actual).toBe('100"');

    // Partial credit: the hard rule scores 0.5 (it does fit one wall), the soft
    // rule a full 1 → 1.5 of 2. Dropping the 0.5 to 0 gives 0.5; treating soft
    // as hard gives 0.5 as well — this exact value rules out both.
    expect(r.clearance_score).toBe(0.75);
  });

  it("flags BOTH rules when the item fits along no wall at all", () => {
    // A 200" span exceeds even the long-wall limit for both rules, so both take
    // the definite-violation branch and neither earns partial credit.
    const r = withSofa("200x36");
    expect(r.violations).toHaveLength(2);
    expect(r.violations.map((v) => v.constraint).sort()).toEqual([
      "main walkway in front",
      "to coffee table",
    ]);
    // Note the required text differs from the case above ("leaves 36\"
    // clearance" vs "on short wall") — the two branches produce genuinely
    // different guidance, which is the point of keeping them separate.
    expect(r.violations[0].required).toContain("leaves 36\" clearance");
    expect(r.clearance_score).toBe(0);
  });

  it("passes both rules cleanly when the item fits every wall", () => {
    const r = withSofa("40x36");
    expect(r.violations).toEqual([]);
    expect(r.clearance_score).toBe(1);
  });

  it("carries the clearance outcome through to the per-item spatial score", () => {
    // The per-item score is what actually reaches product ranking, so a
    // clearance result that never propagates would be invisible in the UI.
    const fits = withSofa("40x36").per_item_spatial.get("sofa")!;
    const partial = withSofa("100x36").per_item_spatial.get("sofa")!;
    const fitsNothing = withSofa("200x36").per_item_spatial.get("sofa")!;
    expect(fits).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(fitsNothing);
    for (const s of [fits, partial, fitsNothing]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
