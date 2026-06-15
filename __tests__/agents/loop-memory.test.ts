import { describe, it, expect } from "vitest";
import { mergeTriedQueries } from "@/lib/agents/loop-memory";

describe("mergeTriedQueries", () => {
  it("returns a copy of current when there is no prior memory", () => {
    const current = { sofa: ["cognac leather sofa"] };
    const merged = mergeTriedQueries(current, undefined);
    expect(merged).toEqual(current);
    expect(merged).not.toBe(current);
    expect(merged.sofa).not.toBe(current.sofa);
  });

  it("carries over prior queries not already present", () => {
    const current = { sofa: ["cognac leather sofa"] };
    const prior = { sofa: ["walnut media console"], rug: ["8x10 ivory wool rug"] };
    const merged = mergeTriedQueries(current, prior);
    expect(merged.sofa).toEqual(["cognac leather sofa", "walnut media console"]);
    expect(merged.rug).toEqual(["8x10 ivory wool rug"]);
  });

  it("dedups case- and whitespace-insensitively so re-runs don't repeat queries", () => {
    const current = { sofa: ["Cognac Leather Sofa"] };
    const prior = { sofa: ["  cognac leather sofa  ", "Burrow sectional cognac"] };
    const merged = mergeTriedQueries(current, prior);
    // The duplicate (differing only in case/whitespace) must NOT be added again.
    expect(merged.sofa).toEqual(["Cognac Leather Sofa", "Burrow sectional cognac"]);
  });

  it("does not mutate its inputs", () => {
    const current = { sofa: ["a"] };
    const prior = { sofa: ["b"] };
    mergeTriedQueries(current, prior);
    expect(current.sofa).toEqual(["a"]);
    expect(prior.sofa).toEqual(["b"]);
  });

  it("ignores empty/whitespace-only prior queries", () => {
    const current = { sofa: ["a"] };
    const prior = { sofa: ["", "   ", "b"] };
    const merged = mergeTriedQueries(current, prior);
    expect(merged.sofa).toEqual(["a", "b"]);
  });
});
