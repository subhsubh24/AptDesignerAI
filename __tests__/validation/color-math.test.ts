import { describe, it, expect } from "vitest";
import {
  hslToRgb,
  linearize,
  rgbToXyz,
  xyzToLab,
  hslToLab,
  deltaE2000,
  computeColorHarmony,
} from "@/lib/validation/color-math";

// ---------------------------------------------------------------------------
// hslToRgb
// ---------------------------------------------------------------------------

describe("hslToRgb", () => {
  it("converts pure red correctly", () => {
    const [r, g, b] = hslToRgb(0, 100, 50);
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("converts pure green correctly", () => {
    const [r, g, b] = hslToRgb(120, 100, 50);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("converts pure blue correctly", () => {
    const [r, g, b] = hslToRgb(240, 100, 50);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(1, 3);
  });

  it("converts achromatic (s=0) to equal RGB channels", () => {
    const [r, g, b] = hslToRgb(0, 0, 50);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
    expect(r).toBeCloseTo(0.5, 3);
  });

  it("converts white (l=100, s=0) to [1, 1, 1]", () => {
    const [r, g, b] = hslToRgb(0, 0, 100);
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
  });

  it("converts black (l=0) to [0, 0, 0]", () => {
    const [r, g, b] = hslToRgb(0, 0, 0);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("covers the h<120 branch (yellow-green region, h=60)", () => {
    // h=60 yellow: r=c+m=1, g=c+m=1, b=m=0
    const [r, g, b] = hslToRgb(60, 100, 50);
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("covers the h>=300 branch (magenta region)", () => {
    const [r, g, b] = hslToRgb(300, 100, 50);
    expect(r).toBeCloseTo(1, 3);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(1, 3);
  });

  it("covers the h>=180 branch (cyan, h=180)", () => {
    const [r, g, b] = hslToRgb(180, 100, 50);
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(1, 3);
  });

  it("covers the h>=240 branch (blue-magenta, h=270)", () => {
    const [r, g, b] = hslToRgb(270, 100, 50);
    expect(r).toBeCloseTo(0.5, 2);
    expect(g).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(1, 3);
  });
});

// ---------------------------------------------------------------------------
// linearize
// ---------------------------------------------------------------------------

describe("linearize", () => {
  it("returns 0 for 0", () => {
    expect(linearize(0)).toBeCloseTo(0, 6);
  });

  it("returns 1 for 1", () => {
    expect(linearize(1)).toBeCloseTo(1, 5);
  });

  it("uses the low-end linear branch for c ≤ 0.04045", () => {
    // c=0.04045 → c/12.92 ≈ 0.003130
    expect(linearize(0.04045)).toBeCloseTo(0.04045 / 12.92, 6);
  });

  it("uses the gamma branch for c > 0.04045", () => {
    // c=0.5 → ((0.5+0.055)/1.055)^2.4
    const expected = Math.pow((0.5 + 0.055) / 1.055, 2.4);
    expect(linearize(0.5)).toBeCloseTo(expected, 6);
  });

  it("is monotonically increasing across the range", () => {
    const values = [0, 0.01, 0.04, 0.05, 0.2, 0.5, 0.8, 1.0];
    for (let i = 1; i < values.length; i++) {
      expect(linearize(values[i])).toBeGreaterThan(linearize(values[i - 1]));
    }
  });
});

// ---------------------------------------------------------------------------
// rgbToXyz (D65 white point)
// ---------------------------------------------------------------------------

describe("rgbToXyz", () => {
  it("maps black [0,0,0] to XYZ [0,0,0]", () => {
    const [x, y, z] = rgbToXyz(0, 0, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it("maps white [1,1,1] to D65 white point (≈0.9505, 1.0, 1.0888)", () => {
    const [x, y, z] = rgbToXyz(1, 1, 1);
    expect(x).toBeCloseTo(0.9505, 3);
    expect(y).toBeCloseTo(1.0, 3);
    expect(z).toBeCloseTo(1.0888, 3);
  });

  it("maps pure linear red [1,0,0] to expected XYZ", () => {
    // sRGB red (1,0,0) linearized → same, XYZ = (0.4124, 0.2126, 0.0193)
    const [x, y, z] = rgbToXyz(1, 0, 0);
    expect(x).toBeCloseTo(0.4124, 3);
    expect(y).toBeCloseTo(0.2126, 3);
    expect(z).toBeCloseTo(0.0193, 2);
  });
});

// ---------------------------------------------------------------------------
// xyzToLab
// ---------------------------------------------------------------------------

describe("xyzToLab", () => {
  it("converts D65 white to Lab ≈ (100, 0, 0)", () => {
    const D65_X = 0.95047, D65_Y = 1.0, D65_Z = 1.08883;
    const [L, a, b] = xyzToLab(D65_X, D65_Y, D65_Z);
    expect(L).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });

  it("converts black [0,0,0] to Lab (0, 0, 0)", () => {
    const [L, a, b] = xyzToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 3);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });
});

// ---------------------------------------------------------------------------
// hslToLab (round-trip sanity)
// ---------------------------------------------------------------------------

describe("hslToLab", () => {
  it("produces L=100 for white (h=0, s=0, l=100)", () => {
    const [L] = hslToLab({ h: 0, s: 0, l: 100 });
    expect(L).toBeCloseTo(100, 1);
  });

  it("produces L≈0 for black (h=0, s=0, l=0)", () => {
    const [L] = hslToLab({ h: 0, s: 0, l: 0 });
    expect(L).toBeCloseTo(0, 1);
  });

  it("red and green have clearly different Lab a* values", () => {
    const [, aRed] = hslToLab({ h: 0, s: 100, l: 50 });
    const [, aGreen] = hslToLab({ h: 120, s: 100, l: 50 });
    expect(aRed).toBeGreaterThan(0); // red: positive a*
    expect(aGreen).toBeLessThan(0); // green: negative a*
  });
});

// ---------------------------------------------------------------------------
// deltaE2000 — Sharma, Wu & Dalal (2005) reference test pairs
// Tolerance: ±0.002 as specified in the paper's supplementary material
// ---------------------------------------------------------------------------

describe("deltaE2000 (Sharma et al. 2005 reference pairs)", () => {
  const tol = 0.002;

  const pairs: Array<{
    lab1: [number, number, number];
    lab2: [number, number, number];
    expected: number;
    label: string;
  }> = [
    {
      lab1: [50.0, 2.6772, -79.7751],
      lab2: [50.0, 0.0, -82.7485],
      expected: 2.0425,
      label: "pair 1",
    },
    {
      lab1: [50.0, 3.1571, -77.2803],
      lab2: [50.0, 0.0, -82.7485],
      expected: 2.8615,
      label: "pair 2",
    },
    {
      lab1: [50.0, 2.8361, -74.02],
      lab2: [50.0, 0.0, -82.7485],
      expected: 3.4412,
      label: "pair 3",
    },
    {
      lab1: [50.0, -1.3802, -84.2814],
      lab2: [50.0, 0.0, -82.7485],
      expected: 1.0,
      label: "pair 4",
    },
    {
      lab1: [50.0, 0.0, 0.0],
      lab2: [50.0, -1.0, 2.0],
      expected: 2.3669,
      label: "pair 7",
    },
    {
      lab1: [50.0, 2.49, -0.001],
      lab2: [50.0, -2.49, 0.0009],
      expected: 7.1792,
      label: "pair 9",
    },
    {
      lab1: [50.0, 2.5, 0.0],
      lab2: [73.0, 25.0, -18.0],
      expected: 27.1492,
      label: "pair 17",
    },
    {
      lab1: [50.0, 2.5, 0.0],
      lab2: [61.0, -5.0, 29.0],
      expected: 22.8977,
      label: "pair 18",
    },
    {
      lab1: [60.2574, -34.0099, 36.2677],
      lab2: [60.4626, -34.1751, 39.4387],
      expected: 1.2644,
      label: "pair 25",
    },
    {
      lab1: [22.7233, 20.0904, -46.694],
      lab2: [23.0331, 14.973, -42.5619],
      expected: 2.0373,
      label: "pair 29",
    },
    {
      lab1: [2.0776, 0.0795, -1.135],
      lab2: [0.9033, -0.0636, -0.5514],
      expected: 0.9082,
      label: "pair 34",
    },
  ];

  for (const { lab1, lab2, expected, label } of pairs) {
    it(`${label}: ΔE = ${expected}`, () => {
      const de = deltaE2000(lab1, lab2);
      expect(de).toBeCloseTo(expected, 3);
      expect(Math.abs(de - expected)).toBeLessThan(tol);
    });

    it(`${label} (symmetric)`, () => {
      const de1 = deltaE2000(lab1, lab2);
      const de2 = deltaE2000(lab2, lab1);
      expect(Math.abs(de1 - de2)).toBeLessThan(tol);
    });
  }

  it("returns 0 for identical colors", () => {
    const lab: [number, number, number] = [50.0, 10.0, -20.0];
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 3);
  });

  it("returns a larger value for perceptually distant colors", () => {
    const white: [number, number, number] = [100, 0, 0];
    const black: [number, number, number] = [0, 0, 0];
    expect(deltaE2000(white, black)).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// computeColorHarmony — integration
// ---------------------------------------------------------------------------

describe("computeColorHarmony", () => {
  it("returns neutral defaults when analysis has no palette", () => {
    const result = computeColorHarmony({}, {});
    expect(result.palette_harmony).toBe(0.5);
    expect(result.palette_scheme).toBe("unknown");
    expect(result.cross_room_coherence).toBe(1.0);
    expect(result.pair_conflicts).toHaveLength(0);
    expect(result.per_item_color_fit.size).toBe(0);
  });

  it("scores an all-neutral palette above 0.85", () => {
    const result = computeColorHarmony(
      { recommended_palette: ["white", "beige", "cream", "linen white"] },
      {}
    );
    expect(result.palette_harmony).toBeGreaterThan(0.85);
    expect(["neutral", "tonal", "neutral-accent"]).toContain(result.palette_scheme);
  });

  it("returns palette_harmony ≤ 1.0 and ≥ 0.0 always", () => {
    const cases = [
      { recommended_palette: ["red", "navy", "green", "orange"] },
      { recommended_palette: ["white"] },
      { recommended_palette: [] },
    ];
    for (const analysis of cases) {
      const result = computeColorHarmony(analysis, {});
      expect(result.palette_harmony).toBeGreaterThanOrEqual(0);
      expect(result.palette_harmony).toBeLessThanOrEqual(1);
    }
  });

  it("cross_room_coherence is 1.0 when no other rooms are given", () => {
    const result = computeColorHarmony(
      { recommended_palette: ["warm beige", "taupe"] },
      {}
    );
    expect(result.cross_room_coherence).toBe(1.0);
  });

  it("detects pair conflicts for perceptually incompatible unrelated colors", () => {
    // ivory (h=50, s=50, l=93) vs hunter green (h=115, s=50, l=25):
    // hue angle ≈ 95° → "unrelated"; Delta-E ≈ 57.7 → exceeds the 50 threshold
    const result = computeColorHarmony(
      { recommended_palette: ["ivory", "hunter green"] },
      {}
    );
    // The function must actually detect the conflict, not just return a lower score
    expect(result.pair_conflicts.length).toBeGreaterThan(0);
    expect(result.pair_conflicts[0].color1).toBeDefined();
    expect(result.pair_conflicts[0].deltaE).toBeGreaterThan(50);

    // Score must be strictly lower than a conflict-free neutral palette
    const noConflictResult = computeColorHarmony(
      { recommended_palette: ["cream", "warm beige", "taupe"] },
      {}
    );
    expect(noConflictResult.pair_conflicts).toHaveLength(0);
    expect(result.palette_harmony).toBeLessThan(noConflictResult.palette_harmony);
  });

  it("populates per_item_color_fit for items with color specs", () => {
    const result = computeColorHarmony(
      {
        recommended_palette: ["cream", "warm beige"],
        what_it_needs: [
          { category: "sofa", specs: "cream linen sofa, 84 inch wide" },
          { category: "area_rug", specs: "5x8 wool rug in ivory" },
        ],
      },
      {}
    );
    expect(result.per_item_color_fit.size).toBeGreaterThan(0);
    for (const [, score] of result.per_item_color_fit) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("returns high per_item color fit for items matching the palette", () => {
    // cream/ivory items against a cream+beige palette should fit well
    const result = computeColorHarmony(
      {
        recommended_palette: ["cream", "warm beige", "ivory"],
        what_it_needs: [
          { category: "curtains", specs: "cream linen curtains 96 inch length" },
        ],
      },
      {}
    );
    const sofaFit = result.per_item_color_fit.get("curtains");
    expect(sofaFit).toBeDefined();
    expect(sofaFit!).toBeGreaterThan(0.7);
  });

  it("gives a higher harmony score to a monochromatic palette than a mixed one", () => {
    const mono = computeColorHarmony(
      { recommended_palette: ["cream", "ivory", "warm ivory"] },
      {}
    );
    const mixed = computeColorHarmony(
      { recommended_palette: ["navy", "terracotta", "sage", "gold"] },
      {}
    );
    expect(mono.palette_harmony).toBeGreaterThan(mixed.palette_harmony);
  });

  it("uses apartment palette anchors from buildingResearch without crashing", () => {
    const result = computeColorHarmony(
      { recommended_palette: ["warm beige"] },
      {
        apartmentPaletteAnchors: ["warm", "ivory", "natural"],
      }
    );
    expect(result.cross_room_coherence).toBeGreaterThanOrEqual(0);
    expect(result.cross_room_coherence).toBeLessThanOrEqual(1);
  });

  it("items without recognizable color specs get a neutral default fit of 0.95", () => {
    // specs with purely dimensional/structural text → itemColors.length === 0 → default 0.95
    const result = computeColorHarmony(
      {
        recommended_palette: ["cream"],
        what_it_needs: [
          { category: "coffee_table", specs: "48 inch wide 18 inch tall" },
        ],
      },
      {}
    );
    const fit = result.per_item_color_fit.get("coffee_table");
    expect(fit).toBeDefined();
    expect(fit!).toBeCloseTo(0.95);
  });
});
