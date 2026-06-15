import { describe, it, expect } from "vitest";
import {
  trackDomainResult,
  getDomainSuccessRate,
  mergeDomainStats,
  prioritizeDomains,
  type DomainStatsMap,
} from "@/lib/agents/domain-router";

describe("trackDomainResult", () => {
  it("tracks successes and failures", () => {
    const stats: DomainStatsMap = {};
    trackDomainResult(stats, "https://www.article.com/product/123", true);
    trackDomainResult(stats, "https://article.com/product/456", true);
    trackDomainResult(stats, "https://article.com/product/789", false);
    expect(stats["article.com"]).toEqual({ attempts: 3, successes: 2 });
  });

  it("handles invalid URLs gracefully", () => {
    const stats: DomainStatsMap = {};
    trackDomainResult(stats, "not-a-url", true);
    expect(Object.keys(stats)).toHaveLength(0);
  });
});

describe("getDomainSuccessRate", () => {
  it("returns 0.5 for unknown domains", () => {
    expect(getDomainSuccessRate({}, "unknown.com")).toBe(0.5);
  });

  it("computes correct rate", () => {
    const stats: DomainStatsMap = {
      "article.com": { attempts: 10, successes: 8 },
    };
    expect(getDomainSuccessRate(stats, "article.com")).toBe(0.8);
  });

  it("strips www prefix", () => {
    const stats: DomainStatsMap = {
      "article.com": { attempts: 4, successes: 3 },
    };
    expect(getDomainSuccessRate(stats, "www.article.com")).toBe(0.75);
  });
});

describe("mergeDomainStats", () => {
  it("applies decay to prior stats", () => {
    const current: DomainStatsMap = {};
    const prior: DomainStatsMap = {
      "article.com": { attempts: 10, successes: 8 },
    };
    const merged = mergeDomainStats(current, prior);
    expect(merged["article.com"]).toEqual({ attempts: 5, successes: 4 });
  });

  it("adds prior to current cumulatively", () => {
    const current: DomainStatsMap = {
      "article.com": { attempts: 3, successes: 3 },
    };
    const prior: DomainStatsMap = {
      "article.com": { attempts: 10, successes: 8 },
    };
    const merged = mergeDomainStats(current, prior);
    expect(merged["article.com"]).toEqual({ attempts: 8, successes: 7 });
  });

  it("passes through current when no prior", () => {
    const current: DomainStatsMap = {
      "cb2.com": { attempts: 5, successes: 1 },
    };
    const merged = mergeDomainStats(current, undefined);
    expect(merged).toEqual(current);
  });
});

describe("prioritizeDomains", () => {
  it("sorts high-success domains first", () => {
    const stats: DomainStatsMap = {
      "article.com": { attempts: 10, successes: 9 },
      "westelm.com": { attempts: 10, successes: 3 },
      "cb2.com": { attempts: 10, successes: 7 },
    };
    const result = prioritizeDomains(
      ["westelm.com", "article.com", "cb2.com"],
      stats,
    );
    expect(result).toEqual(["article.com", "cb2.com", "westelm.com"]);
  });

  it("removes chronically-failing domains (<20% over 3+ attempts)", () => {
    const stats: DomainStatsMap = {
      "bad-retailer.com": { attempts: 5, successes: 0 },
      "ok-retailer.com": { attempts: 5, successes: 3 },
    };
    const result = prioritizeDomains(
      ["bad-retailer.com", "ok-retailer.com"],
      stats,
    );
    expect(result).toEqual(["ok-retailer.com"]);
  });

  it("keeps unknown domains (< 3 attempts)", () => {
    const stats: DomainStatsMap = {
      "new-retailer.com": { attempts: 1, successes: 0 },
    };
    const result = prioritizeDomains(["new-retailer.com", "known.com"], stats);
    expect(result).toContain("new-retailer.com");
  });

  it("handles empty stats gracefully", () => {
    const result = prioritizeDomains(["a.com", "b.com"], {});
    expect(result).toHaveLength(2);
  });
});
