# Plan: Mathematical Harmony Validation System

## Problem
The current harmony validation is entirely LLM-driven — the AI scores its own recommendations 1-10, then revises and re-scores. The scores are subjective, non-reproducible, and "10/10" has no mathematical meaning. The model can inflate scores on re-evaluation.

## Solution
Add a **deterministic scoring layer** (`lib/validation/harmony-math.ts`) that computes hard numbers for what's quantifiable, then feeds those scores INTO the LLM validation prompt so the AI can focus on the truly subjective aesthetic bits. The final harmony_score becomes a weighted composite of math + AI.

## Architecture

```
Area Analysis generates recommendations
        ↓
  computeHarmonyScores()          ← NEW: deterministic math
        ↓
  validateRoomHarmony()           ← EXISTING: AI validation, now receives math scores as context
        ↓
  Composite score = weighted(math, AI)   ← NEW: blended in route.ts
```

The math layer does NOT replace the AI — it augments it. The AI still handles subjective aesthetics (does this "feel" right?), but can no longer claim 10/10 when the math says there's a 14" clearance violation.

---

## Step 1: Create `lib/validation/lookups.ts` — Color & Material Reference Tables

**Color HSL lookup table** (~100 common interior design colors):
- Maps color names like "warm ivory", "sage green", "walnut brown", "matte black" to HSL values
- Supports fuzzy matching for slight variations ("ivory" matches "warm ivory")

**Material property vectors** (~50 common materials):
- Maps materials to `[warmth, roughness, sheen, weight]` vectors (0-1 each)
- e.g., "solid walnut" → [0.8, 0.3, 0.4, 0.9], "brushed brass" → [0.6, 0.2, 0.7, 0.8], "linen" → [0.7, 0.6, 0.1, 0.2]

---

## Step 2: Create `lib/validation/color-math.ts` — Color Harmony Scoring

**What it computes:**
- Parse color names → HSL values using lookup table from Step 1
- **Delta-E (CIEDE2000)** between all color pairs in the palette
- **Color relationship classification**: analogous (<30° hue apart), complementary (~180°), triadic (~120°), split-complementary, monochromatic (same hue, different saturation/lightness)
- **Palette coherence score**: Does the set of colors form a recognized harmonious relationship? Score 0-1.
- **Cross-room palette distance**: How similar is this room's palette to other rooms? Should be similar but not identical. Score 0-1.

**Inputs:** `recommended_palette: string[]`, `otherRooms[].palette: string[]`, `what_it_needs[].specs` (extract color mentions)

**Output:**
```ts
{
  palette_harmony: number;        // 0-1: how harmonious the color set is
  cross_room_coherence: number;   // 0-1: apartment-wide palette consistency
  pair_conflicts: Array<{ color1: string; color2: string; deltaE: number; issue: string }>;
}
```

**No external deps needed** — implement CIEDE2000 directly (~60 lines of math).

---

## Step 3: Create `lib/validation/spatial-math.ts` — Spatial Constraint Scoring

**What it computes:**
- Parse dimensions from `specs` strings (regex: `(\d+)[-–]?(\d+)?\s*(inches?|in|"|ft|feet|cm)`)
- Parse room dimensions from `floorPlan.room_dimensions` (e.g., `"12x15"` → 144" x 180")
- **Furniture-to-room ratio**: total furniture footprint / room area. Target: 0.55-0.70 for living rooms, 0.45-0.60 for bedrooms.
- **Clearance checks** (hard constraints, pass/fail):
  - Main walkways: ≥ 36"
  - Coffee table to sofa: ≥ 18"
  - Behind dining chairs: ≥ 24"
  - Beside beds: ≥ 30"
  - Door swing clearance: ≥ 36"
- **Placement conflict detection**: Two items assigned to same wall/zone that would overlap
- **Coverage gaps**: Zones with no items assigned (e.g., dining zone in a combined room has no dining table)

**Inputs:** `what_it_needs[]` (specs + placement), `floorPlan`, `spatial_layout`, `window_door_positions`

**Output:**
```ts
{
  room_coverage_ratio: number;       // 0-1: furniture footprint / room area
  clearance_score: number;           // 0-1: % of clearance constraints met
  violations: Array<{ item: string; constraint: string; actual: string; required: string }>;
  placement_conflicts: Array<{ item1: string; item2: string; zone: string }>;
}
```

---

## Step 4: Create `lib/validation/material-math.ts` — Material Cluster Scoring

**What it computes:**
- Map materials to property vectors using lookup from Step 1
- **Distribution variance**: Are materials balanced across warm/cool, rough/smooth, matte/glossy spectrums? Score 0-1.
- **Wood species conflict detection**: Mixing oak + walnut + ash = too many wood tones. Max 2 wood species recommended.
- **Metal finish conflict detection**: Mixing brass + chrome + nickel = clash. Max 1 primary + 1 accent metal.
- **Soft-to-hard ratio**: Count soft items (rug, curtains, upholstery, throws) vs hard (wood, metal, glass, stone). Target ratio depends on room type.

**Inputs:** `recommended_materials[]`, `what_it_needs[].specs`, `what_works[]`

**Output:**
```ts
{
  material_balance: number;        // 0-1: distribution across property axes
  wood_coherence: number;          // 0-1: 1.0 if ≤2 wood species
  metal_coherence: number;         // 0-1: 1.0 if ≤2 metal finishes
  soft_hard_ratio: number;         // 0-1: how close to ideal balance
  conflicts: Array<{ material1: string; material2: string; issue: string }>;
}
```

---

## Step 5: Create `lib/validation/proportion-math.ts` — Scale & Proportion Scoring

**What it computes:**
- **Rug-to-seating ratio**: Rug should extend ≥6" beyond seating on all sides, ≥24" for dining (chair pullback)
- **Table height relationships**: Coffee table ±2" of sofa seat height (~17-19"), dining table ~30", side tables within 2" of sofa arm height
- **Visual weight balance**: Assign visual weight (size × darkness × density) per item, check left/right and front/back balance
- **Grouping ratios**: Odd numbers for decorative groupings (3 or 5 throw pillows, not 4)

**Inputs:** `what_it_needs[]` (specs + placement), `floorPlan`

**Output:**
```ts
{
  rug_coverage: number;          // 0-1
  height_relationships: number;  // 0-1
  visual_balance: number;        // 0-1
  issues: Array<{ item: string; issue: string; suggestion: string }>;
}
```

---

## Step 6: Create `lib/validation/harmony-math.ts` — Orchestrator

Combines all four modules:

```ts
export function computeHarmonyScores(analysis, context): MathHarmonyResult {
  const color = computeColorHarmony(analysis, context);
  const spatial = computeSpatialConstraints(analysis, context);
  const material = computeMaterialBalance(analysis, context);
  const proportion = computeProportionScores(analysis, context);

  const itemScores = analysis.what_it_needs.map(item => ({
    category: item.category,
    math_score: weightedAverage({
      color: 0.20,    spatial: 0.30,
      material: 0.20, proportion: 0.15,
      specificity: 0.15,
    }),
    violations: [...collected per item...],
  }));

  return { overall, color, spatial, material, proportion, itemScores };
}
```

**Weights** (spatial heaviest — hard physical constraints):
- Spatial: 0.30
- Color: 0.20
- Material: 0.20
- Proportion: 0.15
- Specificity: 0.15

---

## Step 7: Integrate into `validation-agent.ts`

Inject math scores into the AI validation prompt as facts:

```
## MATHEMATICAL ANALYSIS (computed — these are FACTS, not opinions)
Overall math score: 0.82/1.0

### Color Harmony: 0.90/1.0
- Palette forms analogous warm scheme ✓
- Conflict: "sage green" ↔ "warm ivory" Delta-E=42 (threshold: 30)

### Spatial Constraints: 0.70/1.0
- VIOLATION: coffee_table clearance = 14" (required: 18")
- VIOLATION: dining_chairs pullback = 20" (required: 24")

### Material Balance: 0.85/1.0
- 3 wood species (walnut, oak, ash) — max 2 recommended

Per-item math scores:
- area_rug: 0.95 | no violations
- coffee_table: 0.62 | clearance violation, height mismatch
...

You CANNOT score an item 10/10 if it has math violations. Fix violations
in revised_specs/placement. Focus on SUBJECTIVE aspects math can't capture.
```

---

## Step 8: Composite scoring in `route.ts`

After both math + AI scores:

```ts
// Math can veto but not promote
const finalScore = item.math_score >= 0.95
  ? item.ai_harmony_score              // Math clean → trust AI
  : Math.min(item.ai_harmony_score,    // Math violation → cap AI score
      Math.round(item.math_score * 10));
```

Update convergence: loop stops when ALL items have `math_score >= 0.95` AND `ai_score >= 9`.

---

## Files to Create
1. `lib/validation/lookups.ts` (~150 lines — color HSL + material property tables)
2. `lib/validation/color-math.ts` (~200 lines)
3. `lib/validation/spatial-math.ts` (~180 lines)
4. `lib/validation/material-math.ts` (~150 lines)
5. `lib/validation/proportion-math.ts` (~150 lines)
6. `lib/validation/harmony-math.ts` (~100 lines — orchestrator)

## Files to Modify
1. `lib/agents/validation-agent.ts` — inject math scores into prompt, accept mathScores param
2. `app/api/area-analysis/route.ts` — call computeHarmonyScores(), composite scoring, updated convergence

## Dependencies
**None** — all math implemented from scratch. No new packages needed.

## Risks & Mitigations
- **Color name parsing**: AI uses free-form names → fuzzy match against lookup, unrecognized → 0.5 score
- **Dimension parsing**: Free-form specs → robust regex with fallbacks, unparseable → neutral 0.7
- **False violations**: Some "violations" are intentional (cozy reading nook with 12" clearance) → soft constraints cap at 0.85 minimum, only hard violations (overlap, doesn't fit) go below
