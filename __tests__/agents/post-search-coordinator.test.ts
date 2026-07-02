import { describe, it, expect } from "vitest";
import {
  formatStateForAgent,
  type CoordinatorState,
} from "@/lib/agents/post-search-coordinator";

/**
 * Unit coverage for `formatStateForAgent` — the pure function that turns the
 * coordinator's raw state into the objective decision signals the agent reasons
 * over. Each expensive downstream decision (re-search, finalize, drop) hinges on
 * the verdict tokens this formatter emits, so we pin the thresholds:
 *   - audit-trend classification (STALLED / REGRESSING / improving[ strongly])
 *   - per-category saturation + diminishing-returns markers
 *   - missing / dropped category surfacing
 *   - tried-queries emission
 */

function baseState(overrides: Partial<CoordinatorState> = {}): CoordinatorState {
  return {
    budgetUsed: 10_000,
    budgetCap: 100_000,
    budgetRemainingPct: 90,
    categories: {},
    requiredCategories: ["sofa", "rug"],
    missingCategories: [],
    reSearchCount: {},
    triedQueries: {},
    droppedCategories: [],
    validationRun: false,
    bundlesGenerated: false,
    backfillRun: false,
    tiersFilledRun: false,
    auditRunCount: 0,
    ...overrides,
  };
}

describe("formatStateForAgent — budget & phase header", () => {
  it("renders the token budget line with remaining percentage", () => {
    const out = formatStateForAgent(baseState({ budgetUsed: 25_000, budgetCap: 100_000, budgetRemainingPct: 75 }));
    expect(out).toContain("Token budget: 25,000/100,000 used (75% remaining)");
  });

  it("reports 'No audit run yet.' when no audit alignment is present", () => {
    const out = formatStateForAgent(baseState());
    expect(out).toContain("No audit run yet.");
    expect(out).not.toContain("Alignment trend:");
  });

  it("reflects which phases have run", () => {
    const out = formatStateForAgent(
      baseState({ validationRun: true, bundlesGenerated: false, backfillRun: true, tiersFilledRun: false, auditRunCount: 2 }),
    );
    expect(out).toContain("validation: yes");
    expect(out).toContain("bundles: no");
    expect(out).toContain("backfill: yes");
    expect(out).toContain("tiers_filled: no");
    expect(out).toContain("audits run: 2");
  });
});

describe("formatStateForAgent — audit trend classification", () => {
  function withHistory(alignments: number[]): CoordinatorState {
    const auditHistory = alignments.map((alignment) => ({ alignment, coverage: 8, diagnosisSolving: 8 }));
    return baseState({
      lastAuditAlignment: alignments[alignments.length - 1],
      lastAuditCoverage: 8,
      lastAuditDiagnosisSolving: 8,
      auditRunCount: alignments.length,
      auditHistory,
    });
  }

  it("does NOT emit a trend line with fewer than 2 audit runs", () => {
    const out = formatStateForAgent(withHistory([6.0]));
    expect(out).not.toContain("Alignment trend:");
    // But the single audit line is still shown.
    expect(out).toContain("Last audit: alignment=6.0/10");
  });

  it("classifies |delta| < 0.3 as STALLED (6.1 → 6.3, delta 0.2)", () => {
    const out = formatStateForAgent(withHistory([6.1, 6.3]));
    expect(out).toContain("STALLED");
    expect(out).not.toContain("REGRESSING");
    expect(out).not.toContain("improving");
  });

  it("classifies a delta clearly above the stall band as improving, NOT stalled (6.0 → 6.5, delta 0.5)", () => {
    const out = formatStateForAgent(withHistory([6.0, 6.5]));
    expect(out).not.toContain("STALLED");
    expect(out).toContain("improving");
  });

  it("classifies a negative delta beyond the stall band as REGRESSING (7.0 → 6.4, delta -0.6)", () => {
    const out = formatStateForAgent(withHistory([7.0, 6.4]));
    expect(out).toContain("REGRESSING");
    expect(out).not.toContain("STALLED");
  });

  it("treats a small negative delta inside the stall band as STALLED, not REGRESSING (6.5 → 6.3, delta -0.2)", () => {
    const out = formatStateForAgent(withHistory([6.5, 6.3]));
    expect(out).toContain("STALLED");
    expect(out).not.toContain("REGRESSING");
  });

  it("classifies delta >= 1.0 as improving strongly (6.0 → 7.2, delta 1.2)", () => {
    const out = formatStateForAgent(withHistory([6.0, 7.2]));
    expect(out).toContain("improving strongly");
  });

  it("classifies 0.3 <= delta < 1.0 as improving (not strongly) (6.0 → 6.8, delta 0.8)", () => {
    const out = formatStateForAgent(withHistory([6.0, 6.8]));
    expect(out).toContain("improving");
    expect(out).not.toContain("improving strongly");
  });

  it("uses ONLY the last two entries for the delta, but shows the full trend arrow", () => {
    // 5.0 → 8.0 → 8.1: last delta is 0.1 (STALLED) even though the run started strong.
    const out = formatStateForAgent(withHistory([5.0, 8.0, 8.1]));
    expect(out).toContain("STALLED");
    expect(out).toContain("5.0 → 8.0 → 8.1");
  });

  it("renders audit issues (capped at 8) when present", () => {
    const issues = Array.from({ length: 10 }, (_, i) => `issue-${i}`);
    const out = formatStateForAgent(
      baseState({ lastAuditAlignment: 6, lastAuditIssues: issues, auditRunCount: 1 }),
    );
    expect(out).toContain("issue-0");
    expect(out).toContain("issue-7");
    expect(out).not.toContain("issue-8");
  });
});

describe("formatStateForAgent — missing / dropped categories", () => {
  it("surfaces MISSING categories loudly", () => {
    const out = formatStateForAgent(baseState({ missingCategories: ["rug"] }));
    expect(out).toContain("MISSING (zero products): rug");
  });

  it("omits the MISSING line when nothing is missing", () => {
    const out = formatStateForAgent(baseState({ missingCategories: [] }));
    expect(out).not.toContain("MISSING (zero products)");
  });

  it("lists dropped categories", () => {
    const out = formatStateForAgent(baseState({ droppedCategories: ["art"] }));
    expect(out).toContain("Dropped this session: art");
  });

  it("renders (none) when there are no required categories", () => {
    const out = formatStateForAgent(baseState({ requiredCategories: [] }));
    expect(out).toContain("Required categories: (none)");
  });
});

describe("formatStateForAgent — per-category saturation & diminishing returns", () => {
  it("marks a category SATURATED when count >= 3 AND scoreMax >= 7.0", () => {
    const out = formatStateForAgent(
      baseState({
        categories: { sofa: { productCount: 3, tiersCovered: ["budget"], scoreMax: 7.0, scoreMin: 4, scoreMedian: 6 } },
      }),
    );
    expect(out).toContain("SATURATED (do not re-search)");
  });

  it("does NOT mark SATURATED when count is below the threshold (2 products)", () => {
    const out = formatStateForAgent(
      baseState({
        categories: { sofa: { productCount: 2, tiersCovered: ["budget"], scoreMax: 9.0 } },
      }),
    );
    expect(out).not.toContain("SATURATED");
  });

  it("does NOT mark SATURATED when the best score is below 7.0 (6.9)", () => {
    const out = formatStateForAgent(
      baseState({
        categories: { sofa: { productCount: 5, tiersCovered: ["budget"], scoreMax: 6.9 } },
      }),
    );
    expect(out).not.toContain("SATURATED");
  });

  it("warns DO NOT re-search once a category has been re-searched twice", () => {
    const out = formatStateForAgent(
      baseState({
        categories: { sofa: { productCount: 1, tiersCovered: [] } },
        reSearchCount: { sofa: 2 },
      }),
    );
    expect(out).toContain("DO NOT re-search again");
  });

  it("shows the plain re-search count (no hard stop) after a single re-search", () => {
    const out = formatStateForAgent(
      baseState({
        categories: { sofa: { productCount: 1, tiersCovered: [] } },
        reSearchCount: { sofa: 1 },
      }),
    );
    expect(out).toContain("re-searched 1x");
    expect(out).not.toContain("DO NOT re-search again");
  });
});

describe("formatStateForAgent — tried queries", () => {
  it("emits the tried-queries block (forbidden reuse) when any category has tried queries", () => {
    const out = formatStateForAgent(
      baseState({ triedQueries: { sofa: ["linen sofa", "boucle sofa"] } }),
    );
    expect(out).toContain("Queries ALREADY TRIED");
    expect(out).toContain('"linen sofa"');
    expect(out).toContain('"boucle sofa"');
  });

  it("omits the tried-queries block entirely when every category's list is empty", () => {
    const out = formatStateForAgent(baseState({ triedQueries: { sofa: [] } }));
    expect(out).not.toContain("Queries ALREADY TRIED");
  });

  it("keeps only the most recent 8 tried queries per category", () => {
    const many = Array.from({ length: 10 }, (_, i) => `q${i}`);
    const out = formatStateForAgent(baseState({ triedQueries: { sofa: many } }));
    // The two oldest (q0, q1) are dropped; the most recent survive.
    expect(out).not.toContain('"q0"');
    expect(out).not.toContain('"q1"');
    expect(out).toContain('"q9"');
  });
});
