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
 *
 * `isPropertyMap` indicates that `schema` is the value of a `properties` (or
 * `$defs`/`definitions`) map — its keys are user-defined property names, not
 * JSON Schema keywords, so they must NOT be filtered against UNSUPPORTED_KEYS
 * (otherwise a Zod field named e.g. `title` would be silently dropped, leaving
 * the parent's `required` array referencing a missing property).
 */
function cleanForGemini(
  schema: Record<string, unknown>,
  defs?: Record<string, unknown>,
  isPropertyMap = false
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!isPropertyMap && UNSUPPORTED_KEYS.has(key)) continue;

    // Resolve $ref if present (only meaningful when NOT inside a property map)
    if (!isPropertyMap && key === "$ref" && typeof value === "string" && defs) {
      const refName = value.replace("#/$defs/", "").replace("#/definitions/", "");
      const resolved = defs[refName];
      if (resolved && typeof resolved === "object") {
        return cleanForGemini(resolved as Record<string, unknown>, defs);
      }
      continue;
    }

    if (!isPropertyMap && key === "anyOf" && Array.isArray(value)) {
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

    // When we recurse into `properties`, its direct children are property-name
    // keys → sub-schemas. We must treat that nested object as a property map
    // so we don't filter property names against the keyword blacklist.
    const childIsPropertyMap = !isPropertyMap && key === "properties";

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = cleanForGemini(
        value as Record<string, unknown>,
        defs,
        childIsPropertyMap
      );
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
