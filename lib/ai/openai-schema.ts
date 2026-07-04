/**
 * Convert Zod schemas to OpenAI-compatible JSON Schema for strict mode.
 *
 * OpenAI strict mode requires:
 * - All $ref inlined (no $defs)
 * - additionalProperties: false on every object
 * - ALL properties listed in required
 * - Nullable via anyOf: [{...schema}, { type: "null" }]
 *
 * Uses Zod v4's toJSONSchema(), then transforms for OpenAI compatibility.
 */

import { z } from "zod";

const STRIP_KEYS = new Set([
  "$schema",
  "$id",
  "examples",
  "const",
  "if",
  "then",
  "else",
  "not",
  "patternProperties",
  "dependentSchemas",
  "unevaluatedProperties",
  "propertyNames",
]);

function cleanForOpenAI(
  schema: Record<string, unknown>,
  defs?: Record<string, unknown>,
  isPropertyMap = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!isPropertyMap && STRIP_KEYS.has(key)) continue;
    if (!isPropertyMap && (key === "$defs" || key === "definitions")) continue;

    // Resolve $ref
    if (!isPropertyMap && key === "$ref" && typeof value === "string" && defs) {
      const refName = value.replace("#/$defs/", "").replace("#/definitions/", "");
      const resolved = defs[refName];
      if (resolved && typeof resolved === "object") {
        return cleanForOpenAI(resolved as Record<string, unknown>, defs);
      }
      continue;
    }

    // Handle anyOf — convert nullable pattern, otherwise take first option
    if (!isPropertyMap && key === "anyOf" && Array.isArray(value)) {
      const nonNull = value.filter(
        (v) => !(typeof v === "object" && v && (v as Record<string, unknown>).type === "null"),
      );
      const hasNull = nonNull.length < value.length;
      if (nonNull.length === 1) {
        const inner = cleanForOpenAI(nonNull[0] as Record<string, unknown>, defs);
        if (hasNull) {
          // OpenAI nullable: anyOf with the schema + { type: "null" }
          return { anyOf: [inner, { type: "null" }] };
        }
        return inner;
      }
      if (nonNull.length > 0) {
        return cleanForOpenAI(nonNull[0] as Record<string, unknown>, defs);
      }
      continue;
    }

    // Handle allOf — inline single-element allOf
    if (!isPropertyMap && key === "allOf" && Array.isArray(value)) {
      if (value.length === 1) {
        return cleanForOpenAI(value[0] as Record<string, unknown>, defs);
      }
      // Multi-element: merge properties. Object.assign lets a later branch's
      // `properties` replace an earlier branch's, but the earlier branch's
      // `required` (added by the strict-mode pass when that branch was cleaned)
      // would otherwise SURVIVE and reference properties that no longer exist —
      // an invalid strict schema that 400s the request. Re-derive the strict
      // invariants from the FINAL merged properties so `required` always matches.
      const merged: Record<string, unknown> = {};
      for (const sub of value) {
        const cleaned = cleanForOpenAI(sub as Record<string, unknown>, defs);
        Object.assign(merged, cleaned);
      }
      if (
        merged.type === "object" &&
        typeof merged.properties === "object" &&
        merged.properties !== null
      ) {
        merged.additionalProperties = false;
        merged.required = Object.keys(merged.properties as Record<string, unknown>);
      }
      return merged;
    }

    // Handle oneOf — take first option
    if (!isPropertyMap && key === "oneOf" && Array.isArray(value)) {
      if (value.length >= 1) {
        return cleanForOpenAI(value[0] as Record<string, unknown>, defs);
      }
      continue;
    }

    const childIsPropertyMap = !isPropertyMap && key === "properties";

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = cleanForOpenAI(
        value as Record<string, unknown>,
        defs,
        childIsPropertyMap,
      );
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? cleanForOpenAI(item as Record<string, unknown>, defs)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  // Strict mode: every object must have additionalProperties: false
  // and all properties in required
  if (result.type === "object" && typeof result.properties === "object" && result.properties !== null) {
    result.additionalProperties = false;
    const propKeys = Object.keys(result.properties as Record<string, unknown>);
    result.required = propKeys;
  }

  return result;
}

/**
 * Convert a Zod schema to an OpenAI-compatible JSON Schema for strict mode.
 *
 * Usage:
 *   const schema = zodToOpenAISchema(MyZodSchema);
 *   // Pass to response_format: { type: "json_schema", json_schema: { strict: true, schema } }
 */
export function zodToOpenAISchema(zodSchema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(zodSchema) as Record<string, unknown>;

  const defs = (jsonSchema.$defs || jsonSchema.definitions) as
    | Record<string, unknown>
    | undefined;

  return cleanForOpenAI(jsonSchema, defs);
}

/**
 * Convert a pre-built Gemini responseSchema to OpenAI strict-mode format.
 * Used when the agent already has a plain JSON Schema object (not a Zod type).
 */
export function geminiSchemaToOpenAI(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = (schema.$defs || schema.definitions) as
    | Record<string, unknown>
    | undefined;

  return cleanForOpenAI(schema, defs);
}
