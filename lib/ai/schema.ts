/**
 * Convert Zod schemas to Gemini-compatible responseSchema objects.
 *
 * Gemini's responseSchema uses a subset of OpenAPI 3.0 Schema:
 * - No $ref / $defs (must be fully inlined)
 * - No additionalProperties
 * - Supports: type, properties, items, required, enum, minimum, maximum, default, nullable, description
 *
 * Uses Zod v4's built-in toJSONSchema(), then strips unsupported keys.
 */

import { z } from "zod";

/** Keys that Gemini's responseSchema does NOT support. */
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  "additionalProperties",
  "propertyNames",
  "$id",
  "title",
  "examples",
  "const",
  "if",
  "then",
  "else",
  "allOf",
  "oneOf",
  "not",
  "patternProperties",
  "dependentSchemas",
  "unevaluatedProperties",
  "minItems",
  "maxItems",
]);

/**
 * Recursively strip keys that Gemini doesn't understand and inline $refs.
 */
function cleanForGemini(
  schema: Record<string, unknown>,
  defs?: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;

    // Resolve $ref if present
    if (key === "$ref" && typeof value === "string" && defs) {
      const refName = value.replace("#/$defs/", "").replace("#/definitions/", "");
      const resolved = defs[refName];
      if (resolved && typeof resolved === "object") {
        return cleanForGemini(resolved as Record<string, unknown>, defs);
      }
      continue;
    }

    if (key === "anyOf" && Array.isArray(value)) {
      // Gemini doesn't support anyOf well. If it's a nullable pattern
      // (anyOf: [{type: X}, {type: "null"}]), convert to nullable.
      const nonNull = value.filter(
        (v) => !(typeof v === "object" && v && (v as Record<string, unknown>).type === "null")
      );
      if (nonNull.length === 1 && nonNull.length < value.length) {
        const inner = cleanForGemini(nonNull[0] as Record<string, unknown>, defs);
        return { ...inner, nullable: true };
      }
      // Otherwise take the first non-null option
      if (nonNull.length > 0) {
        return cleanForGemini(nonNull[0] as Record<string, unknown>, defs);
      }
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = cleanForGemini(value as Record<string, unknown>, defs);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? cleanForGemini(item as Record<string, unknown>, defs)
          : item
      );
    } else {
      result[key] = value;
    }
  }

  // Gemini 3 honors `propertyOrdering` for object schemas — emitting JSON
  // keys in a fixed, known order makes the stringified response byte-
  // identical across runs (helpful for response-level caching or diffing).
  // We derive it from the order of keys in `properties` when present.
  if (result.type === "object" && typeof result.properties === "object" && result.properties !== null) {
    const props = result.properties as Record<string, unknown>;
    // Only set if not already supplied by the caller.
    if (!result.propertyOrdering) {
      result.propertyOrdering = Object.keys(props);
    }
  }

  return result;
}

/**
 * Convert a Zod schema to a Gemini-compatible responseSchema object.
 *
 * Usage:
 *   const responseSchema = zodToGeminiSchema(MyZodSchema);
 *   // Pass to geminiProvider.chat({ responseSchema, ... })
 */
export function zodToGeminiSchema(zodSchema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(zodSchema) as Record<string, unknown>;

  const defs = (jsonSchema.$defs || jsonSchema.definitions) as
    | Record<string, unknown>
    | undefined;

  return cleanForGemini(jsonSchema, defs);
}
