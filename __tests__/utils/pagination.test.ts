/**
 * Unit coverage for parsePagination — the shared query-param parser every
 * paginated API route uses to build its Supabase `.range()` window.
 *
 * The load-bearing behaviours (each mutation-resistant):
 *  - `rangeEnd = offset + limit - 1` is INCLUSIVE (an off-by-one here silently
 *    over/under-fetches every list endpoint).
 *  - untrusted `limit` is clamped to `maxLimit` (a client can't request a
 *    million rows) and floored; non-positive / non-finite / NaN fall back to
 *    the default.
 *  - `offset` clamps negatives to 0 and floors fractional values.
 */
import { describe, it, expect } from "vitest";
import { parsePagination } from "@/lib/utils/pagination";

function params(q: Record<string, string>): URLSearchParams {
  return new URLSearchParams(q);
}

describe("parsePagination", () => {
  it("uses the defaults when no params are present", () => {
    expect(parsePagination(params({}))).toEqual({
      limit: 100,
      offset: 0,
      rangeEnd: 99, // 0 + 100 - 1, inclusive
    });
  });

  it("computes an INCLUSIVE rangeEnd (offset + limit - 1)", () => {
    expect(parsePagination(params({ limit: "5", offset: "10" }))).toEqual({
      limit: 5,
      offset: 10,
      rangeEnd: 14, // NOT 15 — the range is inclusive
    });
  });

  it("clamps limit to the default maxLimit (500)", () => {
    const p = parsePagination(params({ limit: "99999" }));
    expect(p.limit).toBe(500);
    expect(p.rangeEnd).toBe(499);
  });

  it("honours a custom maxLimit ceiling", () => {
    const p = parsePagination(params({ limit: "100" }), { maxLimit: 50 });
    expect(p.limit).toBe(50);
    expect(p.rangeEnd).toBe(49);
  });

  it("honours a custom defaultLimit when limit is absent", () => {
    const p = parsePagination(params({}), { defaultLimit: 20 });
    expect(p.limit).toBe(20);
    expect(p.rangeEnd).toBe(19);
  });

  it("floors a fractional limit rather than clamping to default", () => {
    expect(parsePagination(params({ limit: "10.7" })).limit).toBe(10);
  });

  it("floors a fractional offset", () => {
    expect(parsePagination(params({ offset: "2.9" })).offset).toBe(2);
  });

  it.each([
    ["-5", 100],
    ["0", 100],
    ["abc", 100],
    ["", 100],
    ["Infinity", 100],
  ])("falls back to the default limit for non-positive/invalid %s", (raw, expected) => {
    expect(parsePagination(params({ limit: raw })).limit).toBe(expected);
  });

  it.each([
    ["-3", 0],
    ["abc", 0],
    ["", 0],
    ["Infinity", 0],
  ])("clamps a non-positive/invalid offset %s to 0", (raw, expected) => {
    expect(parsePagination(params({ offset: raw })).offset).toBe(expected);
  });

  it("keeps limit and offset independent", () => {
    const p = parsePagination(params({ limit: "25", offset: "50" }), {
      defaultLimit: 10,
      maxLimit: 200,
    });
    expect(p).toEqual({ limit: 25, offset: 50, rangeEnd: 74 });
  });
});
