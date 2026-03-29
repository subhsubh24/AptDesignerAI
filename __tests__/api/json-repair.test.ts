import { describe, it, expect } from "vitest";

/**
 * Tests for JSON repair logic used in apartment-research route.
 * Replicates the repairAndParseJSON function for testing.
 */

function repairAndParseJSON(raw: string): Record<string, unknown> {
  let json = raw.trim();
  json = json.replace(/,\s*([}\]])/g, "$1");

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastNonWS = "";

  for (const ch of json) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
    if (ch.trim()) lastNonWS = ch;
  }

  if (inString) json += '"';
  if (lastNonWS === ":" || lastNonWS === ",") {
    // Try to remove incomplete key-value pair first
    const repaired = json.replace(/,?\s*"[^"]*"\s*:\s*"?[^"]*"?\s*$/, "");
    if (repaired !== json) {
      json = repaired;
    } else {
      // Just a trailing comma — strip it
      json = json.replace(/,\s*$/, "");
    }
  }
  while (stack.length > 0) {
    json += stack.pop();
  }
  return JSON.parse(json);
}

describe("repairAndParseJSON", () => {
  it("should parse valid JSON without changes", () => {
    const result = repairAndParseJSON('{"name": "test", "value": 42}');
    expect(result.name).toBe("test");
    expect(result.value).toBe(42);
  });

  it("should close unclosed braces", () => {
    const result = repairAndParseJSON('{"name": "test", "nested": {"a": 1}');
    expect(result.name).toBe("test");
  });

  it("should close unclosed brackets and braces in correct order", () => {
    const result = repairAndParseJSON('{"items": [1, 2, 3');
    expect(result.items).toEqual([1, 2, 3]);
  });

  it("should close multiple unclosed braces and brackets", () => {
    const result = repairAndParseJSON('{"a": {"b": [1, 2, {"c": 3}');
    expect(result).toBeDefined();
  });

  it("should remove trailing commas before closing braces", () => {
    const result = repairAndParseJSON('{"name": "test", "value": 42,}');
    expect(result.name).toBe("test");
  });

  it("should remove trailing commas before closing brackets", () => {
    const result = repairAndParseJSON('{"items": [1, 2, 3,]}');
    expect(result.items).toEqual([1, 2, 3]);
  });

  it("should handle truncated strings", () => {
    const result = repairAndParseJSON('{"name": "test", "desc": "this is truncated');
    expect(result.name).toBe("test");
  });

  it("should handle real-world apartment research truncation", () => {
    const truncated = `{
  "building_style": "Modern luxury high-rise",
  "finishes": {
    "flooring": "Wide-plank hardwood",
    "countertops": "Quartz",
    "cabinetry": "White shaker",
    "appliances": "Bosch",
    "fixtures": "Brushed nickel"
  },
  "features": ["floor-to-ceiling windows", "in-unit washer/dryer"],
  "floor_plan": {
    "found": true,
    "total_sqft": "650",
    "unit_variants": [
      {
        "name": "A1",
        "sqft": "650",
        "room_layout": "Open concept"`;

    const result = repairAndParseJSON(truncated);
    expect(result.building_style).toBe("Modern luxury high-rise");
    expect(result.finishes).toBeDefined();
    expect((result.finishes as Record<string, string>).flooring).toBe("Wide-plank hardwood");
  });

  it("should handle escaped quotes in strings", () => {
    const result = repairAndParseJSON('{"desc": "She said \\"hello\\"", "val": 1}');
    expect(result.val).toBe(1);
  });

  it("should handle deeply nested truncation", () => {
    const result = repairAndParseJSON('{"a":{"b":{"c":{"d":[1,2,3');
    expect(result).toBeDefined();
    const a = result.a as Record<string, unknown>;
    expect(a).toBeDefined();
  });

  it("should handle truncation right after a colon", () => {
    // Truncated right at "key":
    const result = repairAndParseJSON('{"name": "test", "value": ');
    expect(result.name).toBe("test");
  });

  it("should handle truncation right after a comma", () => {
    const result = repairAndParseJSON('{"name": "test", ');
    expect(result.name).toBe("test");
  });
});
