import { describe, it, expect, beforeEach } from "vitest";
import {
  recordProductScores,
  recordBundleScores,
  checkForDrift,
  getScoreDistributionSummary,
  resetScoreBuffer,
} from "@/lib/scoring/drift-monitor";

/**
 * Unit coverage for the score drift monitor — the surveillance layer that warns
 * when the scoring model stops using the full 0-10 range (clustering), inflates
 * scores (high median), or gives everything a similar score (low spread). These
 * thresholds gate the early-warning signal for model degradation, so a silent
 * regression here means drift goes undetected. The buffer is module-level, so
 * every test resets it first.
 */

/** Record the same dimension `n` times with the given values. */
function record(dimension: string, values: number[]) {
  for (const v of values) recordProductScores({ [dimension]: v });
}

function issuesFor(dimension: string) {
  return checkForDrift()
    .filter((w) => w.dimension === dimension)
    .map((w) => w.issue);
}

describe("drift-monitor", () => {
  beforeEach(() => resetScoreBuffer());

  describe("MIN_SAMPLE_SIZE gate", () => {
    it("emits no warnings below 10 samples even when tightly clustered", () => {
      record("style_match", Array(9).fill(5)); // 9 identical → would cluster, but < 10
      expect(checkForDrift()).toEqual([]);
    });

    it("begins evaluating at exactly 10 samples", () => {
      record("style_match", Array(10).fill(5)); // now eligible → clusters
      expect(issuesFor("style_match")).toContain("clustering");
    });
  });

  describe("well-distributed scores raise nothing", () => {
    it("returns no warnings for a full 0-9 spread", () => {
      // median 4.5, range 9, stddev ≈ 2.87 — clears all three thresholds.
      record("style_match", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(checkForDrift()).toEqual([]);
    });
  });

  describe("clustering (stddev < 1.2)", () => {
    it("warns when stddev collapses", () => {
      record("style_match", Array(10).fill(5)); // stddev 0
      const issues = issuesFor("style_match");
      expect(issues).toContain("clustering");
      expect(issues).not.toContain("high_median"); // median 5 ≤ 7.5
    });

    it("does not warn when stddev is comfortably above the band", () => {
      record("style_match", [1, 3, 4, 5, 5, 6, 6, 7, 8, 10]); // stddev ≈ 2.3
      expect(issuesFor("style_match")).not.toContain("clustering");
    });
  });

  describe("high median (> 7.5)", () => {
    it("warns on score inflation without a clustering false-positive", () => {
      // median 8.5, range 5, stddev ≈ 1.66 → only high_median.
      record("scale_fit", [5, 6, 7, 8, 8, 9, 9, 10, 10, 10]);
      const issues = issuesFor("scale_fit");
      expect(issues).toContain("high_median");
      expect(issues).not.toContain("clustering");
      expect(issues).not.toContain("low_spread");
    });

    it("does not warn at exactly 7.5 (strict greater-than)", () => {
      // 5th=7, 6th=8 → median 7.5 exactly; range 5, stddev high.
      record("scale_fit", [5, 6, 7, 7, 7, 8, 8, 9, 9, 10]);
      expect(issuesFor("scale_fit")).not.toContain("high_median");
    });
  });

  describe("low spread (range < 3)", () => {
    it("warns when the range is under 3", () => {
      record("style_match", [4, 5, 5, 5, 5, 5, 5, 5, 5, 6]); // range 2
      expect(issuesFor("style_match")).toContain("low_spread");
    });

    it("does not warn at exactly range 3 (strict less-than)", () => {
      record("style_match", [4, 4, 4, 4, 4, 4, 4, 4, 4, 7]); // range 3
      const issues = issuesFor("style_match");
      expect(issues).not.toContain("low_spread");
      expect(issues).toContain("clustering"); // still clustered
    });
  });

  describe("confidence_score is exempt", () => {
    it("never warns on confidence_score even when clustered", () => {
      record("confidence_score", Array(10).fill(5));
      expect(checkForDrift()).toEqual([]);
    });
  });

  describe("recordProductScores input hygiene", () => {
    it("ignores NaN values", () => {
      record("x", Array(10).fill(NaN));
      record("x", Array(10).fill(5));
      expect(getScoreDistributionSummary().x.count).toBe(10); // NaN dropped
    });

    it("records each dimension of a multi-dimension score object", () => {
      recordProductScores({ a: 1, b: 2 });
      const summary = getScoreDistributionSummary();
      expect(summary.a.count).toBe(1);
      expect(summary.b.count).toBe(1);
    });
  });

  describe("recordBundleScores is an alias for recordProductScores", () => {
    it("feeds the same buffer", () => {
      recordBundleScores({ harmony: 8 });
      expect(getScoreDistributionSummary().harmony.count).toBe(1);
      expect(getScoreDistributionSummary().harmony.median).toBe(8);
    });
  });

  describe("median computation (interpolation)", () => {
    it("interpolates for an even-length distribution", () => {
      record("m", [2, 4]);
      expect(getScoreDistributionSummary().m.median).toBe(3);
    });

    it("takes the middle for an odd-length distribution", () => {
      record("m", [1, 2, 3]);
      expect(getScoreDistributionSummary().m.median).toBe(2);
    });

    it("reports min/max/mean over the recorded values", () => {
      record("m", [2, 4, 6]);
      const s = getScoreDistributionSummary().m;
      expect(s.min).toBe(2);
      expect(s.max).toBe(6);
      expect(s.mean).toBe(4);
      expect(s.count).toBe(3);
    });
  });

  describe("buffer eviction (MAX_BUFFER_SIZE)", () => {
    it("caps the buffer at 5000 records, evicting oldest first", () => {
      // 5001 pushes → one eviction → count settles at the cap.
      record("d", Array(5001).fill(3));
      expect(getScoreDistributionSummary().d.count).toBe(5000);
    });
  });

  describe("resetScoreBuffer", () => {
    it("clears all recorded scores", () => {
      record("d", [1, 2, 3]);
      resetScoreBuffer();
      expect(getScoreDistributionSummary()).toEqual({});
    });
  });
});
