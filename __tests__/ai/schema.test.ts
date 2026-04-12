import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToGeminiSchema } from "@/lib/ai/schema";

describe("zodToGeminiSchema", () => {
  it("preserves a property literally named 'title' (clashes with JSON Schema keyword)", () => {
    // Regression: `title` was being stripped from `properties` as an
    // unsupported JSON Schema keyword, leaving `required` referencing
    // a missing property → Gemini 400 "property is not defined".
    const schema = z.object({
      title: z.string(),
      value: z.number(),
    });

    const gemini = zodToGeminiSchema(schema);
    const props = gemini.properties as Record<string, unknown>;
    const required = gemini.required as string[];

    expect(props).toHaveProperty("title");
    expect(required).toContain("title");
  });

  it("preserves 'title' inside nested array items", () => {
    const schema = z.object({
      items: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
        }),
      ),
    });

    const gemini = zodToGeminiSchema(schema);
    const items = (gemini.properties as Record<string, Record<string, unknown>>)
      .items.items as Record<string, unknown>;
    const itemProps = items.properties as Record<string, unknown>;
    const itemRequired = items.required as string[];

    expect(itemProps).toHaveProperty("title");
    expect(itemRequired).toContain("title");
    // Every required entry must correspond to a defined property.
    for (const key of itemRequired) {
      expect(itemProps).toHaveProperty(key);
    }
  });

  it("still strips unsupported JSON Schema keywords at the schema level", () => {
    // `examples` is a JSON Schema keyword — it must still be stripped
    // when it appears as a schema-level annotation.
    const schema = z.object({
      name: z.string().describe("user name"),
    });
    const gemini = zodToGeminiSchema(schema);
    expect(gemini).not.toHaveProperty("examples");
    expect(gemini).not.toHaveProperty("$schema");
  });

  it("produces schemas where every required property is present in properties", () => {
    // Covers any Zod schema with a property name that collides with a
    // JSON Schema keyword (title, examples, const, if, then, else, etc.).
    const schema = z.object({
      title: z.string(),
      const: z.string(),
      examples: z.array(z.string()),
      if: z.boolean(),
    });

    const gemini = zodToGeminiSchema(schema);
    const props = gemini.properties as Record<string, unknown>;
    const required = gemini.required as string[];

    for (const key of required) {
      expect(props).toHaveProperty(key);
    }
  });
});
