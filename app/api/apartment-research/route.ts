import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { z } from "zod";

// (c) Zod schema for structured validation of research output
const FloorPlanVariantSchema = z.object({
  name: z.string().nullable().optional(),
  sqft: z.union([z.string(), z.number()]).nullable().optional(),
  floor_plan_image_url: z.string().nullable().optional(),
  room_layout: z.string().nullable().optional(),
  living_dining_combined: z.boolean().nullable().optional(),
  kitchen_style: z.string().nullable().optional(),
  room_dimensions: z.record(z.string(), z.string().nullable()).nullable().optional(),
  notable_spatial_features: z.array(z.string()).nullable().optional(),
});

const ResearchOutputSchema = z.object({
  building_style: z.string().nullable().optional(),
  finishes: z.object({
    flooring: z.string().nullable().optional(),
    countertops: z.string().nullable().optional(),
    cabinetry: z.string().nullable().optional(),
    appliances: z.string().nullable().optional(),
    fixtures: z.string().nullable().optional(),
  }).nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  windows: z.string().nullable().optional(),
  ceiling_height: z.string().nullable().optional(),
  layout_style: z.string().nullable().optional(),
  floor_plan: z.object({
    found: z.boolean().nullable().optional(),
    source: z.string().nullable().optional(),
    unit_type_searched: z.string().nullable().optional(),
    total_sqft: z.union([z.string(), z.number()]).nullable().optional(),
    unit_variants: z.array(FloorPlanVariantSchema).nullable().optional(),
    room_layout: z.string().nullable().optional(),
    living_dining_combined: z.boolean().nullable().optional(),
    kitchen_style: z.string().nullable().optional(),
    room_dimensions: z.record(z.string(), z.string().nullable()).nullable().optional(),
    notable_spatial_features: z.array(z.string()).nullable().optional(),
  }).nullable().optional(),
  amenities: z.array(z.string()).nullable().optional(),
  neighborhood_vibe: z.string().nullable().optional(),
  design_aesthetic: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  confidence_notes: z.array(z.string()).nullable().optional(),
  summary: z.string().nullable().optional(),
  // Populated by the unit-matching pass (post-research). Identifies the
  // specific floor-plan variant the user's apartment corresponds to,
  // so every downstream agent references one unit layout — not the whole list.
  matched_unit: z.object({
    variant: FloorPlanVariantSchema.nullable(),
    match_method: z.enum([
      "exact_sqft",
      "closest_sqft",
      "vision_disambiguated",
      "vision_only",
      "single_variant",
      "no_match",
      "user_uploaded_floor_plan",
    ]),
    confidence: z.enum(["high", "medium", "low"]),
    match_notes: z.string(),
    candidates_considered: z.array(z.string()).nullable().optional(),
  }).nullable().optional(),
  // Populated by the googleMaps enrichment pass (post-primary research).
  location_context: z.object({
    primary_orientation: z.string().nullable().optional(),
    likely_light_direction: z.string().nullable().optional(),
    view_character: z.string().nullable().optional(),
    nearby_design_references: z.array(z.string()).nullable().optional(),
    neighborhood_aesthetic_cues: z.array(z.string()).nullable().optional(),
    confidence: z.string().nullable().optional(),
  }).nullable().optional(),
}).passthrough(); // Allow extra fields

/**
 * Attempt to repair truncated or malformed JSON by closing unclosed braces/brackets.
 */
function repairAndParseJSON(raw: string): Record<string, unknown> {
  let json = raw.trim();
  // Remove trailing commas before } or ]
  json = json.replace(/,\s*([}\]])/g, "$1");

  // Track structure to close properly
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

  // Close unclosed string
  if (inString) json += '"';

  // Remove trailing incomplete value (e.g., `"key": ` or `"key": "truncated`)
  // by removing the last key-value if it ends with : or : "...
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

  // Close unclosed structures in reverse order
  while (stack.length > 0) {
    json += stack.pop();
  }

  try {
    return JSON.parse(json);
  } catch (e) {
    console.error("[apartment-research] JSON repair failed:", (e as Error).message, "\nTruncated input:", raw.slice(0, 300));
    throw new Error("Could not parse building research response after repair attempt");
  }
}

/**
 * Robustly parse a model response that may be raw JSON, wrapped in markdown
 * code fences (```json ... ```), or truncated. Used for both the primary
 * research pass and the targeted second pass.
 */
function parseModelJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    // Fallback: extract JSON from markdown code blocks first
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const inner = jsonMatch[1].trim();
      try {
        return JSON.parse(inner);
      } catch {
        return repairAndParseJSON(inner);
      }
    }
    // Or locate the outermost { ... } span
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(raw.slice(braceStart, braceEnd + 1));
      } catch {
        return repairAndParseJSON(raw.slice(braceStart));
      }
    }
    if (braceStart !== -1) {
      // Truncated — only opening brace found, try to repair
      return repairAndParseJSON(raw.slice(braceStart));
    }
    // Last resort: attempt to repair the raw text after stripping a leading
    // fence marker if present (handles unterminated ```json blocks).
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (stripped.startsWith("{")) {
      return repairAndParseJSON(stripped);
    }
    throw new Error("Could not parse model JSON response");
  }
}

// ─── Unit matching helpers ────────────────────────────────────────────

type Variant = Record<string, unknown>;

type MatchMethod =
  | "exact_sqft"
  | "closest_sqft"
  | "vision_disambiguated"
  | "vision_only"
  | "single_variant"
  | "no_match"
  | "user_uploaded_floor_plan";

interface UnitMatchResult {
  variant: Variant | null;
  match_method: MatchMethod;
  confidence: "high" | "medium" | "low";
  match_notes: string;
  candidates_considered?: string[];
}

function parseSqft(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/[\d,]+/);
    if (m) {
      const n = parseInt(m[0].replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function variantLabel(v: Variant): string {
  const name = (v.name as string | null | undefined) ?? "unnamed";
  const sqft = parseSqft(v.sqft);
  return sqft !== null ? `${name} (${sqft} sf)` : name;
}

/**
 * Ask Gemini vision to pick which candidate floor-plan variant matches the
 * user's actual room photos. Returns null if the model is unsure or if no
 * candidates have floor-plan images to compare against.
 */
async function disambiguateWithVision(
  candidates: Variant[],
  userImageUrls: string[],
  unitLabel: string,
  userSqft: number | null,
): Promise<{ variant: Variant; confidence: "high" | "medium" | "low"; reasoning: string } | null> {
  const withImages = candidates.filter((c) => c.floor_plan_image_url);
  if (withImages.length === 0 || userImageUrls.length === 0) return null;

  const blocks: Array<
    | { type: "image"; source: { type: "url"; url: string } }
    | { type: "text"; text: string }
  > = [
    {
      type: "text",
      text: `The user lives in a ${unitLabel} apartment${userSqft ? ` of approximately ${userSqft} sqft` : ""}. Below are floor-plan images for ${withImages.length} candidate unit variants, followed by photos the user took INSIDE their actual apartment. Your job is to decide which floor plan matches the user's apartment.`,
    },
  ];

  for (let i = 0; i < withImages.length; i++) {
    const c = withImages[i];
    const sqft = parseSqft(c.sqft);
    blocks.push({
      type: "text",
      text: `\n--- Candidate ${i + 1}: "${String(c.name ?? "unnamed")}"${sqft ? ` (${sqft} sqft)` : ""} ---`,
    });
    blocks.push({ type: "image", source: { type: "url", url: c.floor_plan_image_url as string } });
    if (c.room_layout) {
      blocks.push({ type: "text", text: `Layout description: ${String(c.room_layout)}` });
    }
  }

  blocks.push({ type: "text", text: "\n--- USER'S APARTMENT PHOTOS ---" });
  for (const url of userImageUrls.slice(0, 6)) {
    blocks.push({ type: "image", source: { type: "url", url } });
  }

  blocks.push({
    type: "text",
    text: `\nCompare the user's photos to each floor plan. Match on:\n- number of windows per wall and window placement\n- room adjacencies (which rooms connect to which)\n- kitchen layout (galley / open to living / L-shape / U-shape)\n- presence of dining area, balcony door, walk-in closet, en-suite bath\n- any unique architectural features\n\nReturn JSON only:\n{\n  "matched_variant_name": "exact name of the chosen candidate, or null if you cannot confidently pick",\n  "confidence": "high | medium | low",\n  "reasoning": "1-2 sentences citing the specific visual evidence"\n}`,
  });

  try {
    const res = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: "You are an architectural vision assistant. Match user-provided apartment photos to floor-plan diagrams by comparing visible features. Never guess — if the photos don't show enough to decide, return matched_variant_name: null.",
      messages: [{ role: "user", content: blocks }],
      max_tokens: 64000,
      // No temperature override — Gemini 3 is optimized for its default (1.0).
    });

    const raw = res.content.trim();
    if (!raw) return null;
    const data = parseModelJSON(raw) as {
      matched_variant_name?: string | null;
      confidence?: "high" | "medium" | "low";
      reasoning?: string;
    };
    if (!data.matched_variant_name) return null;

    const picked = withImages.find(
      (c) => String(c.name ?? "").toLowerCase().trim() === String(data.matched_variant_name).toLowerCase().trim(),
    );
    if (!picked) return null;

    return {
      variant: picked,
      confidence: data.confidence ?? "medium",
      reasoning: data.reasoning ?? "",
    };
  } catch (e) {
    console.warn("[apartment-research] Vision disambiguation failed:", (e as Error).message);
    return null;
  }
}

/**
 * Decide which variant corresponds to the user's actual apartment, combining
 * sqft matching (primary signal) with vision disambiguation (tiebreaker).
 */
async function matchUnitVariant(
  variants: Variant[],
  userSqft: number | null,
  userImageUrls: string[],
  unitLabel: string,
): Promise<UnitMatchResult> {
  if (variants.length === 0) {
    return {
      variant: null,
      match_method: "no_match",
      confidence: "low",
      match_notes: "No unit variants were found in building research.",
    };
  }

  if (variants.length === 1) {
    return {
      variant: variants[0],
      match_method: "single_variant",
      confidence: "medium",
      match_notes: `Only one ${unitLabel} variant found; assumed to be the user's unit.`,
      candidates_considered: [variantLabel(variants[0])],
    };
  }

  // Try sqft match. "Exact" allows ±5 sqft to absorb rounding differences
  // between what a listing site shows (e.g. 724) and what a resident
  // remembers (725). Anything beyond that is almost certainly a different
  // floor plan and should NOT be silently accepted — buildings routinely
  // have multiple unit types within 20-30 sqft of each other.
  if (userSqft) {
    const EXACT_TOLERANCE = 5;
    const CLOSEST_TOLERANCE = 15;

    const scored = variants
      .map((v) => ({ v, sqft: parseSqft(v.sqft), diff: parseSqft(v.sqft) !== null ? Math.abs(parseSqft(v.sqft)! - userSqft) : Infinity }))
      .filter((s) => s.sqft !== null)
      .sort((a, b) => a.diff - b.diff);

    const exact = scored.filter((s) => s.diff <= EXACT_TOLERANCE);

    if (exact.length === 1) {
      return {
        variant: exact[0].v,
        match_method: "exact_sqft",
        confidence: "high",
        match_notes: `Exact sqft match (variant "${String(exact[0].v.name)}" at ${exact[0].sqft} sqft vs user's ${userSqft} sqft).`,
        candidates_considered: variants.map(variantLabel),
      };
    }

    if (exact.length > 1) {
      // Multiple variants share the sqft — try vision to disambiguate
      const exactVariants = exact.map((s) => s.v);
      const vision = await disambiguateWithVision(exactVariants, userImageUrls, unitLabel, userSqft);
      if (vision) {
        return {
          variant: vision.variant,
          match_method: "vision_disambiguated",
          confidence: vision.confidence,
          match_notes: `${exact.length} variants share ~${userSqft} sqft; vision picked "${String(vision.variant.name)}". ${vision.reasoning}`,
          candidates_considered: exactVariants.map(variantLabel),
        };
      }
      return {
        variant: exactVariants[0],
        match_method: "exact_sqft",
        confidence: "low",
        match_notes: `${exact.length} variants share ~${userSqft} sqft and vision could not disambiguate. Provisionally chose "${String(exactVariants[0].name)}".`,
        candidates_considered: exactVariants.map(variantLabel),
      };
    }

    // No exact match. Try "closest" ONLY within a tight window. Beyond that,
    // it's honest to say we couldn't find the unit rather than pick a
    // plausible-looking wrong one — that would pollute every downstream
    // agent's context with the wrong room dimensions.
    const closest = scored.filter((s) => s.diff <= CLOSEST_TOLERANCE);
    if (closest.length > 0) {
      return {
        variant: closest[0].v,
        match_method: "closest_sqft",
        confidence: "medium",
        match_notes: `No exact sqft match within ±${EXACT_TOLERANCE}; closest is "${String(closest[0].v.name)}" at ${closest[0].sqft} sqft (user reported ${userSqft}, diff ${closest[0].diff}).`,
        candidates_considered: variants.map(variantLabel),
      };
    }

    // Nothing within tolerance — try vision as last resort before giving up
    const vision = await disambiguateWithVision(variants, userImageUrls, unitLabel, userSqft);
    if (vision) {
      return {
        variant: vision.variant,
        match_method: "vision_only",
        confidence: vision.confidence,
        match_notes: `No variant within ±${CLOSEST_TOLERANCE} sqft of user's ${userSqft}. Vision picked "${String(vision.variant.name)}" (${parseSqft(vision.variant.sqft) ?? "?"} sqft) based on photo comparison. ${vision.reasoning}`,
        candidates_considered: variants.map(variantLabel),
      };
    }

    // Genuinely can't match — be honest. Include closest for user reference.
    const closestSeen = scored[0];
    return {
      variant: null,
      match_method: "no_match",
      confidence: "low",
      match_notes: `Could not confidently match user's ${userSqft} sqft unit. Closest variant is ${closestSeen ? `"${String(closestSeen.v.name)}" at ${closestSeen.sqft} sqft (${closestSeen.diff} sqft off)` : "unknown"}. The user's unit may not have been captured in research — consider re-running with the building's floor-plans page directly.`,
      candidates_considered: variants.map(variantLabel),
    };
  }

  // No sqft or nothing close enough — try vision alone
  const vision = await disambiguateWithVision(variants, userImageUrls, unitLabel, userSqft);
  if (vision) {
    return {
      variant: vision.variant,
      match_method: "vision_only",
      confidence: vision.confidence,
      match_notes: `Matched via vision comparison: "${String(vision.variant.name)}". ${vision.reasoning}`,
      candidates_considered: variants.map(variantLabel),
    };
  }

  return {
    variant: null,
    match_method: "no_match",
    confidence: "low",
    match_notes: `Could not confidently match the user's unit${userSqft ? ` (${userSqft} sqft)` : ""}. ${variants.length} variants considered; ${userImageUrls.length === 0 ? "no user photos available for vision disambiguation" : "vision was inconclusive"}.`,
    candidates_considered: variants.map(variantLabel),
  };
}

/**
 * Research an apartment building using Gemini Google Search + URL Context.
 * Gemini 3 models support combining these tools with structured JSON output.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { building_name, building_url, city, state, neighborhood, project_id, bedrooms, bathrooms, apartment_sqft, building_place_id, latitude, longitude } = await request.json();

  if (!building_name && !building_url) {
    return NextResponse.json({ error: "building_name or building_url required" }, { status: 400 });
  }

  const searchContext = [
    building_name,
    city,
    state,
    neighborhood,
    "apartments",
  ].filter(Boolean).join(" ");

  // Build unit type filter for floor plan search
  const unitBed = bedrooms ?? 1;
  const unitBath = bathrooms ?? 1;
  const unitLabel = `${unitBed} bedroom ${unitBath} bathroom`;

  // Shared honesty/ground-truth rules used by both calls.
  const honesty = `
CRITICAL RULES:
- ONLY include information you can actually find on the website or in search results.
- If a field isn't findable, set it to null. NEVER guess or invent values.
- If the website doesn't specify a finish, return "not specified" rather than guessing.
- Use confidence_notes to list what you couldn't find. This is important for user trust.`;

  // ── Prompt 1: Building-wide context (NO floor plans) ─────────────────
  // Splitting this from the floor-plan search was a deliberate fix: doing
  // both in one call used to crowd the output token budget — the model would
  // happily describe 5 amenities and 3 finishes in prose, then truncate the
  // variant list. Now each call has its full budget for one focused task.
  const buildingContextSchema = `{
  "building_style": "description of architectural and interior style",
  "finishes": {
    "flooring": "type and color, or 'not specified'",
    "countertops": "material and color, or 'not specified'",
    "cabinetry": "style and color, or 'not specified'",
    "appliances": "brand/tier, or 'not specified'",
    "fixtures": "style, or 'not specified'"
  },
  "features": ["notable features"],
  "windows": "window style and size, or null",
  "ceiling_height": "estimated height or null",
  "layout_style": "open concept, traditional, etc.",
  "amenities": ["relevant amenities"],
  "neighborhood_vibe": "character of the neighborhood",
  "design_aesthetic": "overall aesthetic the building conveys",
  "website_url": "building's official website URL if found",
  "confidence_notes": ["what you could NOT find or verify"],
  "summary": "2-3 sentence summary useful for an interior designer."
}`;

  const buildingContextPrompt = building_url
    ? `Read and analyze this apartment building's website: ${building_url}

Also search online for additional details about "${searchContext}".

Extract building-wide context useful for an interior designer. DO NOT describe floor plans or unit layouts — those are handled in a separate pass.

Focus on:
- Building style and architecture
- Standard finishes and fixtures across units
- Building-wide features (window type, ceiling height, layout style)
- Amenities (gym, roof deck, pet policy, etc.)
- Neighborhood character
- Overall design aesthetic
${honesty}

Return JSON:
${buildingContextSchema}`
    : `Search for "${searchContext}" and find the official apartment building website. Read the site and extract building-wide context useful for an interior designer. DO NOT describe floor plans — that's a separate pass.

Focus on:
- Building style and architecture
- Standard finishes (flooring, countertops, cabinetry)
- Amenities
- Neighborhood character
- Design aesthetic
${honesty}

Return JSON:
${buildingContextSchema}`;

  // ── Prompt 2: Floor plans ONLY (dedicated to variant exhaustiveness) ─
  // This call has ONE job: return every ${unitLabel} variant on the
  // building's floor-plans page. Sqft hint (when provided) directs the
  // model to the user's specific unit so it doesn't stop early.
  const floorPlanSchema = `{
  "floor_plan": {
    "found": true or false,
    "source": "exact URL(s) you visited — include the floor-plans page URL",
    "unit_type_searched": "${unitLabel}",
    "total_sqft": "sqft for the ${unitLabel} unit, or range if multiple — null if not found",
    "unit_variants": [
      {
        "name": "unit/plan name (e.g. 'A1', 'S 1.2', 'The Loop')",
        "sqft": "square footage for this specific variant (number as string)",
        "floor_plan_image_url": "direct URL to the floor plan image, or null",
        "room_layout": "description of how rooms connect based on the floor plan",
        "living_dining_combined": true/false/null,
        "kitchen_style": "open to living, galley, U-shaped, etc.",
        "room_dimensions": {
          "living_room": "WxD ft if explicitly stated, else null",
          "bedroom": "WxD ft if explicitly stated, else null",
          "kitchen": "WxD ft if explicitly stated, else null"
        },
        "notable_spatial_features": ["e.g. 'walk-in closet', 'balcony', 'en-suite bath'"]
      }
    ]
  }
}`;

  const sqftHint = typeof apartment_sqft === "number"
    ? `\n\n**USER'S UNIT SQFT: ${apartment_sqft}** — The user lives in a ${apartment_sqft} sqft unit. This EXACT variant exists on the building's floor-plans page. You MUST find it. If your first search doesn't return ${apartment_sqft} sqft, keep looking — check every variant tab/option on the floor-plans page.`
    : "";

  const floorPlanPrompt = `Find EVERY ${unitLabel} floor-plan variant for this building.

Building: ${building_name || searchContext}${building_url ? `\nWebsite: ${building_url}` : ""}${sqftHint}

## PROCESS
1. Navigate to the building's floor-plans page (usually /floor-plans, /floorplans, or /apartments on the main site).
2. Filter/select the ${unitBed}-bedroom ${unitBath}-bathroom category.
3. **Click through EVERY variant tab/card/option** — buildings typically have 4-10 variants per bed/bath count (e.g. "A1", "A2", "B1", "S 1.2", "N J1.6"). Skipping any is a failure.
4. For each variant, capture: name, sqft, floor-plan image URL, room layout description, kitchen style, living/dining arrangement, and any labeled dimensions.
5. If the building's own site doesn't have the full list, also check apartments.com and zillow listings for this building.

## OUTPUT RULES
- Return unit_variants as an array of **OBJECTS**, never strings. A variant like "S 1.2 (725 sf)" MUST be returned as { "name": "S 1.2", "sqft": "725", ... }.
- Return EVERY variant you find — do not abbreviate or summarize the list.
- If a variant has no floor-plan image URL, set that field to null. Still include the variant.
- If you genuinely cannot find any floor plans, set found: false and explain in a top-level "note" field.
${honesty}

Return JSON (and nothing else — no prose, no markdown fences):
${floorPlanSchema}`;

  try {
    // Pass 1: Building-wide context (finishes, amenities, style, etc.)
    const contextResponse = await geminiProvider.chat({
      model: selectModel("apartment_research"),
      system: "You are researching an apartment building's website to extract design-relevant building-wide context (finishes, style, amenities, neighborhood). You do NOT handle floor plans — that's a separate agent. Return ONLY facts you find; never guess.",
      messages: [{ role: "user", content: buildingContextPrompt }],
      max_tokens: 64000,
      // No temperature override — Gemini 3 is optimized for its default (1.0).
      tools: [{ googleSearch: {} }, { urlContext: {} }],
    });

    let research: Record<string, unknown>;
    const contextRaw = contextResponse.content.trim();
    if (!contextRaw) {
      throw new Error("Building research returned empty response — please try again");
    }
    try {
      research = parseModelJSON(contextRaw);
    } catch (e) {
      console.error("[apartment-research] Unparseable context response:", contextRaw.slice(0, 500));
      throw new Error((e as Error).message || "Could not parse building context response");
    }

    // Pass 2: Floor plans (dedicated budget — this is the part that used to
    // get crowded out of the single-call version). Run sequentially, not in
    // parallel, because both calls share the googleSearch tool quota.
    try {
      const fpResponse = await geminiProvider.chat({
        model: selectModel("apartment_research"),
        system: `You are a floor-plan research agent. Your ONLY job is to find every ${unitLabel} floor-plan variant for the given building and return them as structured JSON. Exhaustiveness matters more than brevity — if you find 8 variants, return all 8. Skipping variants is a failure. Return ONLY facts from the website; never invent dimensions or room layouts.`,
        messages: [{ role: "user", content: floorPlanPrompt }],
        max_tokens: 64000,
        // No temperature override — Gemini 3 is optimized for its default (1.0).
        tools: [{ googleSearch: {} }, { urlContext: {} }],
      });

      const fpRaw = fpResponse.content.trim();
      if (fpRaw) {
        try {
          const fpData = parseModelJSON(fpRaw);
          if (fpData.floor_plan) {
            research.floor_plan = fpData.floor_plan;
            const fpObj = fpData.floor_plan as Record<string, unknown>;
            const variants = (fpObj.unit_variants as unknown[] | undefined) ?? [];
            console.log(`[apartment-research] Floor-plan pass captured ${variants.length} variant(s)`);
          }
        } catch (e) {
          console.warn("[apartment-research] Floor-plan response unparseable:", (e as Error).message);
        }
      } else {
        console.warn("[apartment-research] Floor-plan pass returned empty response");
      }
    } catch (e) {
      console.warn("[apartment-research] Floor-plan pass failed:", (e as Error).message);
    }

    // Coerce common malformed variant shapes BEFORE Zod validation.
    // The model sometimes returns unit_variants as bare strings like
    // "N J1.6 (604 sf)" instead of objects. Convert those into the
    // expected { name, sqft } shape so downstream code (vision analysis,
    // dashboard rendering) still works.
    {
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      const rawVariants = fp?.unit_variants;
      if (Array.isArray(rawVariants)) {
        fp!.unit_variants = rawVariants.map((v) => {
          if (typeof v === "string") {
            // Parse patterns like "N J1.6 (604 sf)" → { name: "N J1.6", sqft: "604" }
            const match = v.match(/^(.+?)\s*\(\s*([\d,]+)\s*(?:sf|sqft|ft²|sq ft)?\s*\)\s*$/i);
            if (match) {
              return { name: match[1].trim(), sqft: match[2].replace(/,/g, "") };
            }
            return { name: v.trim(), sqft: null };
          }
          return v;
        });
      }
    }

    // (c) Validate research output with Zod — coerce bad types to null
    const validated = ResearchOutputSchema.safeParse(research);
    if (validated.success) {
      research = validated.data as Record<string, unknown>;
    } else {
      console.warn("[apartment-research] Schema validation warnings:", validated.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
      // Non-fatal: coerce known bad types (e.g., total_sqft: "varies" → null)
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      if (fp?.total_sqft && typeof fp.total_sqft !== "number" && typeof fp.total_sqft !== "string") {
        fp.total_sqft = null;
      }
    }

    // Diagnostic: what did the primary pass actually capture?
    {
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      const variants = (fp?.unit_variants as Array<Record<string, unknown>> | undefined) ?? [];
      const withImages = variants.filter(v => v?.floor_plan_image_url).length;
      const finishes = (research.finishes as Record<string, unknown> | undefined) ?? {};
      const finishFields = Object.entries(finishes).filter(([, v]) => v && v !== "not specified").map(([k]) => k);
      console.log(`[apartment-research] Primary pass captured: ${variants.length} variant(s), ${withImages} with image URLs; finishes filled: [${finishFields.join(", ") || "none"}]`);
    }

    // (a) Analyze floor plan images via Gemini vision if URLs were found
    const floorPlanData = research.floor_plan as Record<string, unknown> | undefined;
    const variants = floorPlanData?.unit_variants as Array<Record<string, unknown>> | undefined;
    if (variants?.length) {
      const imageUrls = variants
        .map(v => v.floor_plan_image_url as string | null)
        .filter((url): url is string => !!url);

      if (imageUrls.length > 0) {
        console.log(`[apartment-research] Analyzing ${imageUrls.length} floor plan image(s) via Gemini vision`);
        try {
          const visionBlocks: Array<{ type: "image"; source: { type: "url"; url: string } } | { type: "text"; text: string }> = [];
          for (const url of imageUrls.slice(0, 3)) {
            visionBlocks.push({ type: "image", source: { type: "url", url } });
          }
          visionBlocks.push({
            type: "text",
            text: `Analyze these floor plan images for a ${unitLabel} apartment. Extract:\n1. Actual room dimensions if labeled or measurable from scale\n2. Door and window positions on each wall\n3. Room spatial relationships (which rooms connect, open/closed)\n4. Any hallways, closets, or architectural features\n\nReturn JSON:\n{\n  "extracted_dimensions": { "living_room": "WxD ft or null", "bedroom": "WxD ft or null", "kitchen": "WxD ft or null" },\n  "door_positions": ["description of each door location"],\n  "window_positions": ["description of each window location"],\n  "spatial_relationships": "how rooms connect"\n}`,
          });

          const visionResponse = await geminiProvider.chat({
            model: selectModel("apartment_research"),
            system: "You are analyzing floor plan images. Extract spatial information that would help an interior designer plan furniture placement.",
            messages: [{ role: "user", content: visionBlocks }],
            max_tokens: 64000,
            // No temperature override — Gemini 3 is optimized for its default (1.0).
          });

          const visionRaw = visionResponse.content.trim();
          if (visionRaw) {
            try {
              const visionData = parseModelJSON(visionRaw);
              // Merge vision-extracted data into floor plan
              if (visionData.extracted_dimensions) {
                const existingDims = (floorPlanData?.room_dimensions as Record<string, string | null>) || {};
                const extractedDims = visionData.extracted_dimensions as Record<string, string | null>;
                // Only fill null dimensions
                for (const [room, dim] of Object.entries(extractedDims)) {
                  if (dim && (!existingDims[room] || existingDims[room] === "null")) {
                    existingDims[room] = dim;
                  }
                }
                (research.floor_plan as Record<string, unknown>).room_dimensions = existingDims;
                console.log("[apartment-research] Vision extracted room dimensions:", JSON.stringify(existingDims));
              }
              // Store vision analysis as additional context
              (research.floor_plan as Record<string, unknown>).vision_analysis = {
                door_positions: visionData.door_positions || [],
                window_positions: visionData.window_positions || [],
                spatial_relationships: visionData.spatial_relationships || null,
              };
            } catch (e) {
              console.warn("[apartment-research] Vision analysis unparseable:", (e as Error).message);
            }
          }
        } catch (e) {
          console.warn("[apartment-research] Floor plan vision analysis failed:", (e as Error).message);
        }
      }
    }

    // If the user uploaded their own floor plan, it IS the ground truth — we
    // don't need to match against building variants. Fetch the existing
    // building_research (set by POST /api/projects/:id/floor-plan) so we can
    // both skip variant matching and preserve the upload when we save below.
    let userUploadedFloorPlan: {
      image_url: string;
      extracted: Record<string, unknown> | null;
    } | null = null;
    if (project_id) {
      try {
        const { data: existingProj } = await supabase
          .from("projects")
          .select("building_research")
          .eq("id", project_id)
          .maybeSingle();
        const existingBr = (existingProj?.building_research as Record<string, unknown>) || {};
        const uploadedUrl = existingBr.floor_plan_image_url as string | undefined;
        const uploadedExtract = existingBr.extracted_floor_plan as Record<string, unknown> | undefined;
        if (uploadedUrl) {
          userUploadedFloorPlan = { image_url: uploadedUrl, extracted: uploadedExtract ?? null };
        }
      } catch (e) {
        console.warn("[apartment-research] Could not check for user-uploaded floor plan:", (e as Error).message);
      }
    }

    // ─── Unit matching pass ─────────────────────────────────────
    // Identify which specific variant corresponds to the user's apartment.
    // Priority: exact sqft → vision-disambiguated (for sqft ties) → closest
    // sqft within tolerance → vision-only (when no sqft provided). Result is
    // attached to research.floor_plan.matched_unit and also denormalized to
    // project.unit_plan_name for cheap access by downstream agents.
    //
    // SKIPPED when the user uploaded their own floor plan — their upload is
    // authoritative and any variant guess would just pollute downstream context.
    if (userUploadedFloorPlan) {
      const existingFp = (research.floor_plan as Record<string, unknown> | undefined) ?? {};
      existingFp.matched_unit = {
        variant: null,
        match_method: "user_uploaded_floor_plan",
        confidence: "high",
        match_notes: "User uploaded their own floor plan — using that as ground truth instead of matching building variants.",
        candidates_considered: null,
      };
      research.floor_plan = existingFp;
      console.log("[apartment-research] Skipped variant matching — user uploaded own floor plan");
    } else {
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      const variants = (fp?.unit_variants as Variant[] | undefined) ?? [];
      if (variants.length > 0) {
        // Fetch user room images (if we have a project_id) to enable vision matching
        let userImageUrls: string[] = [];
        if (project_id) {
          try {
            const { data: imgs } = await supabase
              .from("room_images")
              .select("image_url, rooms!inner(project_id)")
              .eq("rooms.project_id", project_id)
              .eq("image_type", "room")
              .limit(12);
            userImageUrls = ((imgs ?? []) as Array<{ image_url: string | null }>)
              .map((r) => r.image_url)
              .filter((u: string | null): u is string => typeof u === "string" && u.length > 0);
          } catch (e) {
            console.warn("[apartment-research] Could not fetch user room images:", (e as Error).message);
          }
        }

        const userSqft = typeof apartment_sqft === "number" ? apartment_sqft : null;
        try {
          const match = await matchUnitVariant(variants, userSqft, userImageUrls, unitLabel);
          (research.floor_plan as Record<string, unknown>).matched_unit = match;
          console.log(
            `[apartment-research] Unit match: ${match.variant ? String(match.variant.name) : "none"} (${match.match_method}, ${match.confidence}). ${match.match_notes}`,
          );
        } catch (e) {
          console.warn("[apartment-research] Unit matching failed:", (e as Error).message);
        }
      }
    }

    // ─── Google Maps enrichment pass ─────────────────────────────
    // googleMaps can't be combined with googleSearch OR urlContext in the
    // same call (Gemini rejects with INVALID_ARGUMENT). It must run solo.
    // We use it as a separate lookup for *location-aware* context the web
    // search alone misses: building orientation (→ natural light planning),
    // view character (→ palette cues), and neighborhood design vibe.
    // Results are merged into research.location_context — purely additive.
    if (building_name || building_place_id) {
      try {
        // Prefer structured location context (latLng + placeId) via toolConfig.
        // If we only have free-text location, fall back to embedding it in the
        // prompt — Maps grounding will still parse it, just with lower
        // confidence than structured retrievalConfig.
        let resolvedLat: number | undefined = typeof latitude === "number" ? latitude : undefined;
        let resolvedLng: number | undefined = typeof longitude === "number" ? longitude : undefined;

        // If the caller didn't pass coords but provided a project_id, pull
        // them from the projects table (populated at onboarding by the
        // location autocomplete).
        if ((resolvedLat === undefined || resolvedLng === undefined) && project_id) {
          const { data: proj } = await supabase
            .from("projects")
            .select("latitude, longitude, building_place_id")
            .eq("id", project_id)
            .maybeSingle();
          if (proj) {
            if (resolvedLat === undefined && typeof proj.latitude === "number") resolvedLat = proj.latitude;
            if (resolvedLng === undefined && typeof proj.longitude === "number") resolvedLng = proj.longitude;
          }
        }

        // NOTE: Gemini's Maps-grounding `retrievalConfig` only accepts `latLng`
        // (and optionally `languageCode`). `placeId` is NOT a valid input —
        // sending it produces HTTP 400 ("Unknown name \"placeId\" at
        // 'tool_config.retrieval_config'"). We therefore only pass latLng
        // structurally; the placeId (if any) is embedded into the prompt text
        // so the model can still use it for disambiguation.
        const mapsConfig: { latLng?: { latitude: number; longitude: number } } = {};
        if (typeof resolvedLat === "number" && typeof resolvedLng === "number") {
          mapsConfig.latLng = { latitude: resolvedLat, longitude: resolvedLng };
        }

        // Only fall back to text-embedded location if we couldn't resolve
        // structured context — avoids duplicating what retrievalConfig already
        // tells the model.
        const hasStructuredContext = !!mapsConfig.latLng || !!building_place_id;
        const textLocation = hasStructuredContext
          ? (building_name || "this building")
          : [building_name, neighborhood, city, state].filter(Boolean).join(", ");
        const placeIdHint = building_place_id
          ? ` (Google Maps place_id: ${building_place_id})`
          : "";

        console.log("[apartment-research] Maps enrichment inputs", {
          hasLatLng: !!mapsConfig.latLng,
          lat: resolvedLat ?? null,
          lng: resolvedLng ?? null,
          hasPlaceId: !!building_place_id,
          placeId: building_place_id ?? null,
          buildingName: building_name ?? null,
          textLocation,
          mode: mapsConfig.latLng ? "structured-latLng" : building_place_id ? "placeId-text-only" : "name-text-only",
        });

        const mapsResponse = await geminiProvider.chat({
          model: selectModel("apartment_research"),
          system: "You are an interior-design research assistant using Google Maps. Extract location-aware context that affects design decisions — orientation, typical view, neighborhood aesthetic character. Use all available evidence: satellite view, Street View, street geometry, and address data.",
          messages: [{
            role: "user",
            content: `Using Google Maps, look up ${textLocation}${placeIdHint}${mapsConfig.latLng ? " (structured lat/lng is attached via retrievalConfig)" : ""}.

Extract location-aware context using ALL available evidence. Return JSON:
{
  "primary_orientation": "N | S | E | W | NE | NW | SE | SW | null — which way does the building's main entrance/facade face? This is always a single cardinal direction (never 'mixed'). INFERENCE IS ALLOWED: a building whose address is on an E-W street faces N or S (whichever side the entrance is on); a building on a N-S street faces E or W. Use satellite/streetview to confirm. Only use null if genuinely indeterminate.",
  "likely_light_direction": "morning | afternoon | evening | mixed | null — the dominant natural light experience for most units. Derive from primary_orientation: N-facing = indirect/even light all day; S-facing = afternoon strongest; E-facing = morning; W-facing = afternoon/evening. Use 'mixed' only if the building spans a full city block (units face all four directions, so light varies by unit — primary_orientation is still set to the main entrance direction).",
  "view_character": "skyline | water | park | street | mixed-urban | industrial | residential | null",
  "nearby_design_references": ["up to 3 notable design-relevant nearby places — art museum, design district, architectural landmark"],
  "neighborhood_aesthetic_cues": ["2-4 short phrases describing the visual/material character of the block — e.g. 'prewar brick', 'modern glass towers', 'tree-lined brownstones'"],
  "confidence": "high | medium | low"
}

ORIENTATION INFERENCE RULES (prefer inference over null):
- Address on an E-W street (e.g. Madison St, Monroe St): main facade faces N if building is on the south side of the street, faces S if on the north side. Confirm with satellite/streetview.
- Address on a N-S street (e.g. State St, Michigan Ave): main facade faces E or W. Confirm with satellite/streetview.
- If the building spans a full block (bounded by streets on all four sides): primary_orientation = the street the main entrance is on (still a single direction), light = "mixed".
- Use null ONLY if the street direction is ambiguous AND satellite/streetview is unavailable.

CONFIDENCE RULES:
- "high" if primary_orientation AND likely_light_direction are populated (from any evidence — inference counts).
- "medium" if only one of orientation/light is filled, or if neighborhood_aesthetic_cues is rich but orientation is uncertain.
- "low" ONLY if orientation, light, AND view_character are all null.`,
          }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
          // googleMaps must run alone — combining with urlContext or googleSearch
          // produces INVALID_ARGUMENT from the Gemini API.
          // latLng is routed into toolConfig.retrievalConfig by
          // lib/ai/gemini.ts → convertTools(). (placeId is NOT a valid input
          // field — it is only returned as grounding metadata, so we embed it
          // into the prompt above instead of the config.)
          tools: [{ googleMaps: mapsConfig }],
        });

        const mapsRaw = mapsResponse.content.trim();
        if (mapsRaw) {
          try {
            const locationContext = parseModelJSON(mapsRaw) as Record<string, unknown>;

            // Post-process: Maps sometimes returns confidence: "high" even when
            // every orientation/light field came back null — that's incoherent.
            // Downgrade confidence to match what we actually got. The model's
            // own "confidence" rating is a self-assessment of the WHOLE reply,
            // so if the useful fields are null, the whole reply is low-signal.
            const orientation = locationContext.primary_orientation;
            const light = locationContext.likely_light_direction;
            const view = locationContext.view_character;
            const keyFieldsMissing = !orientation && !light && !view;
            if (keyFieldsMissing && locationContext.confidence !== "low") {
              console.log(
                `[apartment-research] Downgrading Maps confidence "${String(locationContext.confidence)}" → "low" (orientation, light, and view all null)`,
              );
              locationContext.confidence = "low";
            } else if (!orientation && !light && locationContext.confidence === "high") {
              // Orientation and light are the two fields that drive design
              // decisions (natural-light planning). If both are null, "high"
              // confidence is overstated — clamp to medium.
              console.log(
                "[apartment-research] Downgrading Maps confidence \"high\" → \"medium\" (orientation and light both null)",
              );
              locationContext.confidence = "medium";
            }

            research.location_context = locationContext;
            console.log("[apartment-research] Maps enrichment merged location_context", {
              orientation: locationContext.primary_orientation,
              light: locationContext.likely_light_direction,
              confidence: locationContext.confidence,
            });
          } catch (e) {
            console.warn("[apartment-research] Maps response unparseable:", (e as Error).message);
          }
        }
      } catch (e) {
        // Non-fatal — primary research is already complete
        console.warn("[apartment-research] Maps enrichment failed:", (e as Error).message);
      }
    }

    // Save to project if project_id provided.
    // If the user already uploaded their own floor plan, preserve it —
    // their upload is authoritative and must survive a building-research
    // refresh. We merge the upload keys back on top of the new research.
    if (project_id) {
      const fp = research.floor_plan as Record<string, unknown> | undefined;
      const matched = fp?.matched_unit as { variant: Variant | null } | undefined;
      const matchedName = matched?.variant?.name as string | null | undefined;

      const researchToSave: Record<string, unknown> = { ...research };
      if (userUploadedFloorPlan) {
        researchToSave.floor_plan_image_url = userUploadedFloorPlan.image_url;
        if (userUploadedFloorPlan.extracted) {
          researchToSave.extracted_floor_plan = userUploadedFloorPlan.extracted;
        }
      }

      await supabase
        .from("projects")
        .update({
          building_research: researchToSave,
          building_name: building_name || research.building_name,
          building_url: building_url || research.website_url,
          city,
          state,
          neighborhood,
          ...(typeof apartment_sqft === "number" ? { apartment_sqft } : {}),
          ...(matchedName ? { unit_plan_name: matchedName } : {}),
          ...(building_place_id ? { building_place_id } : {}),
        })
        .eq("id", project_id);
    }

    return NextResponse.json({ research });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Research failed";
    console.error("[apartment-research]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
