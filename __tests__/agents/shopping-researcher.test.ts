import { describe, it, expect } from "vitest";
import {
  sanitizeSearchQuery,
  deduplicateCandidates,
  type SearchCandidate,
} from "@/lib/agents/shopping-researcher";

/**
 * Unit coverage for the two pure, deterministic pre-processing functions in the
 * shopping researcher. Both gate expensive downstream work — a bad query wastes
 * a Tavily call, and a duplicate candidate wastes an LLM screening slot — so we
 * pin their branch behavior rather than just line-touch them.
 *
 * `sanitizeSearchQuery`: length cap, hex-code stripping, percentage-annotation
 * stripping, whitespace collapse, prose-contamination rejection, min-length floor.
 * `deduplicateCandidates`: URL normalization (host+path, query-insensitive,
 * trailing-slash + case insensitive), first-occurrence preservation, malformed-URL
 * pass-through.
 */

describe("sanitizeSearchQuery", () => {
  it("returns a clean query unchanged (happy path)", () => {
    expect(sanitizeSearchQuery("walnut mid-century dining chair")).toBe(
      "walnut mid-century dining chair",
    );
  });

  it("rejects empty / whitespace-only / non-string input", () => {
    expect(sanitizeSearchQuery("")).toBeNull();
    expect(sanitizeSearchQuery("    ")).toBeNull();
    // Defensive: guards a non-string despite the type signature (called on LLM output)
    expect(sanitizeSearchQuery(undefined as unknown as string)).toBeNull();
    expect(sanitizeSearchQuery(null as unknown as string)).toBeNull();
  });

  it("rejects a query shorter than 5 chars after trimming", () => {
    expect(sanitizeSearchQuery("rug")).toBeNull();
    expect(sanitizeSearchQuery("  a  ")).toBeNull();
    // Exactly 5 chars survives (boundary)
    expect(sanitizeSearchQuery("chair")).toBe("chair");
  });

  it("truncates queries longer than 120 chars to 120 (then trims)", () => {
    const long = "sofa ".repeat(40).trim(); // well over 120 chars
    const out = sanitizeSearchQuery(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(120);
    expect(out!.startsWith("sofa")).toBe(true);
  });

  it("strips parenthesized hex color codes", () => {
    expect(sanitizeSearchQuery("velvet armchair (#3B2F2F) accent")).toBe(
      "velvet armchair accent",
    );
    // 6- and 3-digit variants both stripped
    expect(sanitizeSearchQuery("oak table (#abc) modern")).toBe("oak table modern");
  });

  it("strips em-dash percentage annotations", () => {
    expect(sanitizeSearchQuery("navy blue — dominant (50%) sofa")).toBe(
      "navy blue sofa",
    );
  });

  it("collapses runs of internal whitespace to single spaces", () => {
    expect(sanitizeSearchQuery("brass    floor     lamp")).toBe("brass floor lamp");
  });

  it("rejects prose-contaminated queries (design-direction leakage)", () => {
    // Each of these hits a distinct PROSE_PATTERN branch
    expect(sanitizeSearchQuery("we aim to pivot toward a warmer palette")).toBeNull();
    expect(sanitizeSearchQuery("the goal is to soften the space")).toBeNull();
    expect(sanitizeSearchQuery("a monochromatic scheme to unify the room")).toBeNull();
    expect(sanitizeSearchQuery("something more sterile and clinical")).toBeNull();
  });

  it("keeps a legitimate product query that merely contains a substring of a stop-word", () => {
    // "current" as a whole word is a prose marker, but "currents" (plural) is not
    // one of the anchored patterns — a real product term should survive.
    expect(sanitizeSearchQuery("ocean currents wall art print")).toBe(
      "ocean currents wall art print",
    );
  });
});

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    title: "Product",
    url: "https://example.com/p/1",
    snippet: "",
    source: "test",
    ...overrides,
  };
}

describe("deduplicateCandidates", () => {
  it("returns an empty array for empty input", () => {
    expect(deduplicateCandidates([])).toEqual([]);
  });

  it("keeps distinct URLs", () => {
    const input = [
      candidate({ url: "https://a.com/one" }),
      candidate({ url: "https://a.com/two" }),
      candidate({ url: "https://b.com/one" }),
    ];
    expect(deduplicateCandidates(input)).toHaveLength(3);
  });

  it("dedupes URLs differing only by query string (keeps first occurrence)", () => {
    const first = candidate({ url: "https://shop.com/chair?ref=a", title: "first" });
    const second = candidate({ url: "https://shop.com/chair?ref=b&utm=x", title: "second" });
    const out = deduplicateCandidates([first, second]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("first");
  });

  it("treats trailing slashes and host/path casing as the same URL", () => {
    const input = [
      candidate({ url: "https://Shop.com/Chair/", title: "a" }),
      candidate({ url: "https://shop.com/chair", title: "b" }),
    ];
    // hostname+pathname lowercased and trailing slash stripped → same key
    expect(deduplicateCandidates(input)).toHaveLength(1);
  });

  it("keeps different paths on the same host", () => {
    const input = [
      candidate({ url: "https://shop.com/chair" }),
      candidate({ url: "https://shop.com/table" }),
    ];
    expect(deduplicateCandidates(input)).toHaveLength(2);
  });

  it("passes malformed URLs through (does not drop them, does not dedupe them)", () => {
    const input = [
      candidate({ url: "not-a-url", title: "x" }),
      candidate({ url: "not-a-url", title: "y" }),
      candidate({ url: "https://ok.com/p", title: "z" }),
    ];
    const out = deduplicateCandidates(input);
    // both malformed kept (no key computed) + the one valid = 3
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.title)).toEqual(["x", "y", "z"]);
  });
});
