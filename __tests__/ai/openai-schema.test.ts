import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToOpenAISchema, geminiSchemaToOpenAI } from "@/lib/ai/openai-schema";

/**
 * OpenAI strict mode is a hard contract: a schema that violates it 400s the whole
 * request (every structured DeepSeek/OpenAI-format call). openai-schema.ts is the
 * sole transformer and had zero tests. These pin the branch behaviour of the
 * converter — $ref inlining, the anyOf nullable pattern, allOf/oneOf collapse,
 * keyword stripping, property-name preservation — and the strict-mode invariants
 * (additionalProperties:false + every property required) that make the output
 * accepted rather than silently rejected.
 */

// Recursively assert the OpenAI strict-mode invariants hold on every object node.
function assertStrict(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(assertStrict);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    expect(obj.additionalProperties).toBe(false);
    const propKeys = Object.keys(obj.properties as Record<string, unknown>);
    // strict mode requires EVERY property listed in `required`
    expect(new Set(obj.required as string[])).toEqual(new Set(propKeys));
  }
  for (const v of Object.values(obj)) assertStrict(v);
  // no residual JSON-Schema draft keys OpenAI rejects
  for (const banned of ["$schema", "$id", "$defs", "definitions", "$ref"]) {
    expect(obj[banned]).toBeUndefined();
  }
}

describe("geminiSchemaToOpenAI — $ref resolution", () => {
  it("inlines a $ref from $defs", () => {
    const out = geminiSchemaToOpenAI({
      type: "object",
      properties: { child: { $ref: "#/$defs/Child" } },
      $defs: { Child: { type: "string" } },
    });
    expect((out.properties as Record<string, unknown>).child).toEqual({ type: "string" });
    assertStrict(out);
  });

  it("inlines a $ref from definitions (draft-07 spelling)", () => {
    const out = geminiSchemaToOpenAI({
      type: "object",
      properties: { child: { $ref: "#/definitions/Child" } },
      definitions: { Child: { type: "number" } },
    });
    expect((out.properties as Record<string, unknown>).child).toEqual({ type: "number" });
  });

  it("drops a dangling $ref that resolves to nothing", () => {
    const out = geminiSchemaToOpenAI({
      type: "object",
      properties: { child: { $ref: "#/$defs/Missing" } },
      $defs: {},
    });
    // unresolved ref → the key is dropped, leaving an empty (but strict) object
    expect((out.properties as Record<string, unknown>).child).toEqual({});
  });
});

describe("geminiSchemaToOpenAI — anyOf / nullable", () => {
  it("keeps the OpenAI nullable pattern for [schema, null]", () => {
    const out = geminiSchemaToOpenAI({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(out).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("unwraps a single non-null anyOf option", () => {
    const out = geminiSchemaToOpenAI({ anyOf: [{ type: "string" }] });
    expect(out).toEqual({ type: "string" });
  });

  it("takes the first option when multiple non-null branches exist", () => {
    const out = geminiSchemaToOpenAI({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(out).toEqual({ type: "string" });
  });
});

describe("geminiSchemaToOpenAI — allOf / oneOf", () => {
  it("inlines a single-element allOf", () => {
    const out = geminiSchemaToOpenAI({ allOf: [{ type: "boolean" }] });
    expect(out).toEqual({ type: "boolean" });
  });

  it("merges a multi-element allOf", () => {
    const out = geminiSchemaToOpenAI({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { properties: { b: { type: "number" } } },
      ],
    });
    // later branches Object.assign over earlier: `type:"object"` survives from the
    // first branch, but `properties` is replaced wholesale by the b-branch.
    expect(out.type).toBe("object");
    const merged = out.properties as Record<string, unknown>;
    expect(merged.b).toEqual({ type: "number" });
    expect(merged.a).toBeUndefined();
  });

  it("multi-element allOf leaves a strict-valid schema — `required` tracks the merged properties, not a stale branch", () => {
    // Regression: the first branch (type:object) gets required:["a"] from the
    // strict pass; the second branch replaces `properties` with {b} but carries
    // no `required`, so a naive Object.assign leaves required:["a"] against
    // properties:{b} — an invalid strict schema OpenAI 400s. `required` must be
    // recomputed from the FINAL merged properties.
    const out = geminiSchemaToOpenAI({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { properties: { b: { type: "number" } } },
      ],
    });
    expect(new Set(out.required as string[])).toEqual(new Set(["b"]));
    expect(out.additionalProperties).toBe(false);
    // The whole node satisfies every OpenAI strict-mode invariant.
    assertStrict(out);
  });

  it("takes the first oneOf option", () => {
    const out = geminiSchemaToOpenAI({ oneOf: [{ type: "string" }, { type: "number" }] });
    expect(out).toEqual({ type: "string" });
  });
});

describe("geminiSchemaToOpenAI — keyword stripping vs property names", () => {
  it("strips draft-only schema keywords", () => {
    const out = geminiSchemaToOpenAI({
      type: "string",
      $schema: "http://json-schema.org/draft-07/schema#",
      examples: ["x"],
      const: "y",
      patternProperties: {},
    });
    expect(out).toEqual({ type: "string" });
  });

  it("PRESERVES a property literally named like a keyword (isPropertyMap guard)", () => {
    const out = geminiSchemaToOpenAI({
      type: "object",
      properties: {
        if: { type: "string" },
        not: { type: "number" },
        const: { type: "boolean" },
      },
    });
    const props = out.properties as Record<string, unknown>;
    expect(props.if).toEqual({ type: "string" });
    expect(props.not).toEqual({ type: "number" });
    expect(props.const).toEqual({ type: "boolean" });
    expect(new Set(out.required as string[])).toEqual(new Set(["if", "not", "const"]));
  });

  it("preserves enum values (not stripped like const)", () => {
    const out = geminiSchemaToOpenAI({ type: "string", enum: ["a", "b"] });
    expect(out).toEqual({ type: "string", enum: ["a", "b"] });
  });
});

describe("geminiSchemaToOpenAI — strict-mode object invariants", () => {
  it("forces additionalProperties:false + all-required on nested objects and array items", () => {
    const out = geminiSchemaToOpenAI({
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "number" } },
          required: ["a"], // deliberately incomplete — converter must widen it
        },
        list: {
          type: "array",
          items: { type: "object", properties: { c: { type: "string" } } },
        },
      },
    });
    assertStrict(out);
    const outer = (out.properties as Record<string, unknown>).outer as Record<string, unknown>;
    expect(new Set(outer.required as string[])).toEqual(new Set(["a", "b"]));
  });
});

describe("zodToOpenAISchema — end-to-end contract", () => {
  it("produces a strict-mode-valid schema from a nested Zod object", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      tags: z.array(z.string()),
      address: z.object({ city: z.string(), zip: z.string().nullable() }),
    });
    const out = zodToOpenAISchema(schema);
    assertStrict(out);
    // even an .optional() Zod field is REQUIRED in OpenAI strict mode
    expect(new Set(out.required as string[])).toEqual(
      new Set(["name", "age", "tags", "address"]),
    );
  });

  it("holds the invariants on an enum + array-of-objects schema", () => {
    const schema = z.object({
      verdict: z.enum(["yes", "no"]),
      items: z.array(z.object({ id: z.string(), score: z.number() })),
    });
    assertStrict(zodToOpenAISchema(schema));
  });
});
