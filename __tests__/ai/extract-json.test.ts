import { describe, it, expect } from "vitest";
import { extractJsonObject } from "@/lib/ai/extract-json";

/**
 * Unit coverage for the LLM-response JSON extractor. Every agent that parses a
 * model reply routes through this; a regression in the brace/bracket matching or
 * the repair pass turns a good model answer into a thrown error mid-pipeline.
 * These cases lock each extraction STRATEGY (direct → fence → balanced-brace →
 * repair → fallback) and the string/escape state machine that must not be fooled
 * by braces inside string literals.
 */
describe("extractJsonObject", () => {
  it("parses clean JSON directly", () => {
    expect(extractJsonObject('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("trims surrounding whitespace/newlines", () => {
    expect(extractJsonObject('\n\n  {"ok":true}  \n')).toEqual({ ok: true });
  });

  it("extracts from a ```json markdown fence", () => {
    const raw = 'Sure!\n```json\n{"style":"japandi"}\n```\nHope that helps.';
    expect(extractJsonObject(raw)).toEqual({ style: "japandi" });
  });

  it("extracts from a bare ``` fence (no json tag)", () => {
    expect(extractJsonObject('```\n{"n":42}\n```')).toEqual({ n: 42 });
  });

  it("strips leading + trailing prose around an object", () => {
    expect(extractJsonObject('Here is the result: {"a":1} — done.')).toEqual({ a: 1 });
  });

  it("uses balanced-brace matching, not last-brace, when trailing text has its own braces", () => {
    // The naive first/last-brace fallback would grab through the trailing "{x}"
    // and fail to parse. Only balanced matching returns the correct object.
    const raw = 'Response: {"a": {"b": 1}} trailing {x}';
    expect(extractJsonObject(raw)).toEqual({ a: { b: 1 } });
  });

  it("does not treat a closing brace INSIDE a string as the object end", () => {
    const raw = 'garbage {"note": "a } b } c"} suffix';
    expect(extractJsonObject(raw)).toEqual({ note: "a } b } c" });
  });

  it("handles escaped quotes inside string values", () => {
    const raw = 'prefix {"q": "she said \\" hi \\""} tail';
    expect(extractJsonObject(raw)).toEqual({ q: 'she said " hi "' });
  });

  it("extracts a top-level ARRAY when there is no object", () => {
    expect(extractJsonObject("result: [1, 2, 3] end")).toEqual([1, 2, 3]);
  });

  it("repairs a trailing comma before a closing brace", () => {
    expect(extractJsonObject('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
  });

  it("repairs a trailing comma in a nested array", () => {
    expect(extractJsonObject('{"items": [1, 2, 3,]}')).toEqual({ items: [1, 2, 3] });
  });

  it("repairs JS-style // comments the model leaked in", () => {
    const raw = '{"a": 1, // the score\n "b": 2}';
    expect(extractJsonObject(raw)).toEqual({ a: 1, b: 2 });
  });

  it("returns the requested generic type", () => {
    const out = extractJsonObject<{ score: number }>('{"score": 7}');
    expect(out.score).toBe(7);
  });

  it("throws on input containing no JSON at all", () => {
    expect(() => extractJsonObject("there is nothing structured here")).toThrow();
  });

  it("throws on empty/whitespace input", () => {
    expect(() => extractJsonObject("   ")).toThrow();
  });
});
