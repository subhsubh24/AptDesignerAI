import { describe, it, expect } from "vitest";
import {
  VERDICT_LABELS,
  VERDICT_COLORS,
  getScoreColor,
  getScoreBgColor,
} from "@/lib/scoring/verdicts";
import type { Verdict } from "@/lib/types/scoring";

/**
 * These pure lookups drive what the user SEES on every scored item: the verdict
 * chip label/colour and the 0–10 score colour. The tests pin the exact threshold
 * boundaries (≥8 excellent, ≥6 fair, else poor) so a future refactor can't
 * silently shift a score into the wrong colour band — an 8.0 must read "good",
 * not "okay" — and pin map completeness so a new Verdict enum value can't ship
 * without a label + colour.
 */

const ALL_VERDICTS: Verdict[] = ["strong_yes", "yes", "maybe", "no"];

describe("verdict maps", () => {
  it("has a human label for every Verdict value", () => {
    for (const v of ALL_VERDICTS) {
      expect(VERDICT_LABELS[v]).toBeTruthy();
      expect(typeof VERDICT_LABELS[v]).toBe("string");
    }
    expect(Object.keys(VERDICT_LABELS).sort()).toEqual([...ALL_VERDICTS].sort());
  });

  it("has a colour class set for every Verdict value, with light + dark variants", () => {
    for (const v of ALL_VERDICTS) {
      const cls = VERDICT_COLORS[v];
      expect(cls).toBeTruthy();
      // Each verdict pairs a light + dark treatment so it stays legible in both themes.
      expect(cls).toMatch(/\bdark:/);
    }
    expect(Object.keys(VERDICT_COLORS).sort()).toEqual([...ALL_VERDICTS].sort());
  });

  it("maps each verdict to a distinct semantic colour family", () => {
    expect(VERDICT_COLORS.strong_yes).toContain("emerald");
    expect(VERDICT_COLORS.yes).toContain("green");
    expect(VERDICT_COLORS.maybe).toContain("amber");
    expect(VERDICT_COLORS.no).toContain("red");
  });
});

describe("getScoreColor — text colour by score band", () => {
  it("returns emerald (excellent) at and above 8", () => {
    expect(getScoreColor(8)).toContain("emerald");
    expect(getScoreColor(8.0)).toContain("emerald");
    expect(getScoreColor(10)).toContain("emerald");
    expect(getScoreColor(9.5)).toContain("emerald");
  });

  it("returns amber (fair) in [6, 8)", () => {
    expect(getScoreColor(6)).toContain("amber");
    expect(getScoreColor(7)).toContain("amber");
    expect(getScoreColor(7.999)).toContain("amber");
  });

  it("returns rose (poor) below 6", () => {
    expect(getScoreColor(5.999)).toContain("rose");
    expect(getScoreColor(0)).toContain("rose");
    expect(getScoreColor(-3)).toContain("rose");
  });

  it("pins the exact boundaries (8 and 6 flip the band)", () => {
    // 7.999 → amber, 8 → emerald: the excellent cutoff is inclusive at 8.
    expect(getScoreColor(7.999)).not.toEqual(getScoreColor(8));
    // 5.999 → rose, 6 → amber: the fair cutoff is inclusive at 6.
    expect(getScoreColor(5.999)).not.toEqual(getScoreColor(6));
  });

  it("treats a large or NaN score deterministically (never throws)", () => {
    expect(getScoreColor(1000)).toContain("emerald");
    // NaN fails every >= comparison and falls through to the poor band.
    expect(getScoreColor(Number.NaN)).toContain("rose");
  });
});

describe("getScoreBgColor — progress/bar fill by score band", () => {
  it("tracks the same bands as the text colour", () => {
    expect(getScoreBgColor(8)).toBe("bg-emerald-500");
    expect(getScoreBgColor(7.999)).toBe("bg-amber-500");
    expect(getScoreBgColor(6)).toBe("bg-amber-500");
    expect(getScoreBgColor(5.999)).toBe("bg-rose-500");
    expect(getScoreBgColor(0)).toBe("bg-rose-500");
  });

  it("NaN falls to the poor-band fill", () => {
    expect(getScoreBgColor(Number.NaN)).toBe("bg-rose-500");
  });
});
