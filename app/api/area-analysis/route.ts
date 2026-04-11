import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { validateRoomHarmony, performFinalAssessment } from "@/lib/agents/validation-agent";
import { computeHarmonyScores, formatMathScoresForPrompt, type MathHarmonyResult } from "@/lib/validation/harmony-math";
import { computeFinalHarmonyScore, type MathDimensionCaps } from "@/lib/scoring/harmony-composite";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { parseUserContext, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import { validateAreaAnalysis } from "@/lib/agents/area-analysis-validator";
import { ROOM_FURNISHING_TIERS } from "@/lib/config/pipeline";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roomId = request.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!diagnosis) return NextResponse.json({ analysis: null });

  // Only return data from a proper area-analysis run (has what_it_needs field).
  // Apartment-level diagnosis (keep/replace/add format) is too shallow — let
  // the focus page fall through to POST for a detailed area analysis.
  const djson = diagnosis.diagnosis_json as Record<string, unknown>;
  if (Array.isArray(djson.what_it_needs) && djson.what_it_needs.length > 0) {
    return NextResponse.json({ analysis: djson });
  }

  return NextResponse.json({ analysis: null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { room_id, project_id } = await request.json();
  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  // Dedup: if a valid area-analysis already exists for this room, return it
  // (prevents duplicate work from React StrictMode double-mount)
  const { data: existingDiagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDiagnosis) {
    const existingJson = existingDiagnosis.diagnosis_json as Record<string, unknown>;
    if (Array.isArray(existingJson.what_it_needs) && existingJson.what_it_needs.length > 0) {
      console.log(`[area-analysis] Returning existing analysis (dedup) for room ${room_id}`);
      return NextResponse.json({ analysis: existingJson });
    }
  }

  // Load this room with images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Load project with building research and apartment analysis
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id || room.project_id)
    .single();

  // Load other rooms for cross-room awareness
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("*, room_images(*), room_diagnoses(*)")
    .eq("project_id", project_id || room.project_id)
    .neq("id", room_id);

  // Build vision content
  const contentBlocks: AIContentBlock[] = [];

  // Extract user-provided sqft override from context (e.g., "My apt sq ft is 725")
  const userSqftMatch = room.user_context?.match(/(?:sq\s*ft|square\s*feet?|sqft)\s*(?:is|:)?\s*(\d{3,5})/i)
    || room.user_context?.match(/(\d{3,5})\s*(?:sq\s*ft|square\s*feet?|sqft)/i);
  const userSqft = userSqftMatch ? parseInt(userSqftMatch[1], 10) : null;

  // Inject building research if available
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const floorPlan = br.floor_plan as Record<string, unknown> | undefined;
    // Use user-provided sqft if available, otherwise fall back to building research
    const effectiveSqft = userSqft || floorPlan?.total_sqft || "unknown";
    const floorPlanSection = floorPlan
      ? `\nFloor Plan: ${effectiveSqft} sqft${userSqft ? " (per client)" : ""} | Living/dining combined: ${floorPlan.living_dining_combined ?? "unknown"} | Kitchen: ${floorPlan.kitchen_style || "unknown"}
Room layout: ${floorPlan.room_layout || "unknown"}
Room dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}
Spatial features: ${Array.isArray(floorPlan.notable_spatial_features) ? floorPlan.notable_spatial_features.join(", ") : "unknown"}`
      : "";

    contentBlocks.push({
      type: "text",
      text: `--- BUILDING CONTEXT ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout: ${br.layout_style || "unknown"} | Windows: ${br.windows || "unknown"} | Ceiling: ${br.ceiling_height || "unknown"}
Aesthetic: ${br.design_aesthetic || "unknown"}${floorPlanSection}
---`,
    });
  }

  // Inject apartment analysis if available
  if (project?.apartment_analysis) {
    const aa = project.apartment_analysis as Record<string, unknown>;
    contentBlocks.push({
      type: "text",
      text: `--- APARTMENT-LEVEL ANALYSIS (already completed) ---
Overall: ${aa.overall || ""}
${JSON.stringify(aa.rooms || {}, null, 2)}
---
Use this apartment-level context to ensure cross-room coherence in your area analysis.`,
    });
  }

  // Parse user context into structured constraints (exclusions, keep items, requests)
  const parsedContext = room.user_context ? parseUserContext(room.user_context) : null;
  const parsedContextBlock = parsedContext ? formatParsedContextForPrompt(parsedContext) : "";

  if (parsedContext) {
    console.log(`[area-analysis] User context parsed:`, {
      exclusions: parsedContext.exclusions,
      keepItems: parsedContext.additionalKeepItems,
      requests: parsedContext.explicitRequests.map(r => r.item),
      lifestyle: parsedContext.lifestyleNotes,
    });
  } else {
    console.warn(`[area-analysis] ⚠️ No user_context found on room ${room_id} — user preferences will NOT be applied`);
  }

  const userContextNote = room.user_context
    ? `\n\nIMPORTANT — USER NOTES ABOUT THESE PHOTOS:\n"${room.user_context}"\nTake these notes into account when analyzing the room. If they say to ignore something, don't include it in your assessment. If they express a preference for keeping or liking something, RESPECT that — design around it, don't suggest removing it.`
    : "";

  // Build keep-items protection block — merge explicit keep_items with parsed keep items from user context
  const keepItems = room.keep_items as string[] | null;
  const replaceItems = room.replace_items as string[] | null;
  const priorities = room.priorities as string[] | null;

  const allKeepItems = [
    ...(keepItems || []),
    ...(parsedContext?.additionalKeepItems || []),
  ];

  const keepItemsBlock = allKeepItems.length > 0
    ? `\n\n⚠️ ITEMS THE CLIENT WANTS TO KEEP — DO NOT SUGGEST REMOVING THESE:\n${allKeepItems.map((item: string) => `- ${item}`).join("\n")}\nThese items are NON-NEGOTIABLE. Include them in "what_works" and design AROUND them. NEVER put these in "what_should_go". Do NOT recommend buying a NEW version of these items — the client already has them and wants to keep them.`
    : "";

  const replaceItemsBlock = replaceItems?.length
    ? `\n\nITEMS THE CLIENT WANTS TO REPLACE/REMOVE:\n${replaceItems.map((item: string) => `- ${item}`).join("\n")}\nThese should appear in "what_should_go" and new items should solve the same functional need.`
    : "";

  const prioritiesBlock = priorities?.length
    ? `\n\nCLIENT PRIORITIES & LIFESTYLE NEEDS:\n${priorities.map((p: string) => `- ${p}`).join("\n")}\nWeight these heavily in your recommendations. If hosting is a priority, ensure enough seating and dining capacity. If comfort is key, prioritize deeply comfortable pieces over photogenic ones.`
    : "";

  // (p) Budget context — inform the AI about the budget constraint
  const budgetDollars = room.budget_dollars as number | null;
  const budgetMode = room.budget_mode as string | null;
  const budgetBlock = budgetDollars
    ? `\n\nBUDGET: $${budgetDollars.toLocaleString()} total for this room (${budgetMode || "balanced"} tier).\nKeep your recommendations within this budget. Include approximate price ranges in specs to help stay on target. High-priority items should get more budget allocation.`
    : budgetMode
    ? `\n\nBUDGET MODE: ${budgetMode}. ${budgetMode === "budget" ? "Prioritize affordable options." : budgetMode === "best_possible" ? "Quality and design are more important than price." : "Balance quality with reasonable pricing."}`
    : "";

  // ── TARGET ROOM PHOTOS (clearly labeled) ──
  const targetImageCount = (room.room_images || []).length;
  contentBlocks.push({
    type: "text",
    text: `═══════════════════════════════════════════════════════════
>>> TARGET ROOM: ${room.name} (${room.room_type}) — THIS IS THE ROOM YOU ARE ANALYZING <<<
═══════════════════════════════════════════════════════════${userContextNote}
${parsedContextBlock}${keepItemsBlock}${replaceItemsBlock}${prioritiesBlock}${budgetBlock}

The next ${targetImageCount} photo(s) are ALL from the ${room.name}. Your analysis, recommendations, and "what_it_needs" must be ONLY about this room.`,
  });

  for (const img of room.room_images || []) {
    contentBlocks.push({
      type: "image",
      source: { type: "url", url: img.image_url },
    });
  }

  contentBlocks.push({
    type: "text",
    text: `═══ END OF ${room.name.toUpperCase()} PHOTOS ═══`,
  });

  // ── APARTMENT CONTEXT PHOTOS (for overall feel/materials/aesthetic) ──
  // Include photos from other rooms so the model sees the full apartment vibe,
  // but with extremely clear labeling so it doesn't confuse rooms.
  if (otherRooms && otherRooms.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `\n═══════════════════════════════════════════════════════════
APARTMENT CONTEXT — OTHER ROOMS (for overall feel & material palette ONLY)
═══════════════════════════════════════════════════════════
These photos show the REST of the apartment. Study them to understand:
- The apartment's overall material palette (floors, countertops, trim)
- The existing color scheme and finishes throughout the home
- The aesthetic thread that ties the rooms together
- What furniture/decor choices have already been made elsewhere

⚠️ DO NOT analyze these rooms. DO NOT recommend items for these rooms.
⚠️ DO NOT confuse items in these photos with items in the ${room.name}.
⚠️ Your ENTIRE analysis must be about the ${room.name} above — these photos are CONTEXT ONLY.`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const otherRoom of otherRooms as any[]) {
      const diagnoses = otherRoom.room_diagnoses as Array<{ diagnosis_json: Record<string, unknown> }> | undefined;
      const otherDiagnosis = diagnoses?.[diagnoses.length - 1];
      const djson = otherDiagnosis?.diagnosis_json;
      const summary = djson?.summary as string | undefined;
      const direction = djson?.design_direction as string | undefined;
      const otherImages = (otherRoom.room_images || []) as Array<{ image_url: string }>;

      // Label each other room clearly
      const contextLines = [`── ${otherRoom.name} (${otherRoom.room_type}) ──`];
      if (summary) contextLines.push(`Summary: ${summary}`);
      if (direction) contextLines.push(`Design direction: ${direction}`);

      contentBlocks.push({
        type: "text",
        text: contextLines.join("\n"),
      });

      // Include up to 2 photos per other room for visual context
      for (const img of otherImages.slice(0, 2)) {
        contentBlocks.push({
          type: "image",
          source: { type: "url", url: img.image_url },
        });
      }
    }

    contentBlocks.push({
      type: "text",
      text: `═══ END OF APARTMENT CONTEXT ═══\n\nRemember: You are analyzing the **${room.name}** ONLY. The apartment context photos above are just for understanding the overall aesthetic and materials.`,
    });
  }

  contentBlocks.push({
    type: "text",
    text: `\nDo a deep, thorough analysis of the ${room.name}. You know the owner's preferences (see system prompt). Also consider the other rooms so everything stays cohesive across the apartment.

## ANALYSIS PROCESS — Follow these steps in order:
Step 1: Study ALL room photos carefully. Note every piece of furniture, every finish, every lighting condition, every window/door.
Step 2: Identify what's working (keep) and what's not (replace/remove). Be specific — name items with material + color.
Step 3: Determine the design direction based on the apartment's existing finishes and the client's preferences.
Step 4: List EVERY item the room needs, starting with the highest-impact pieces.
Step 5: For each recommended item, specify EXACT placement in the room with spatial reasoning.
Step 6: Verify that all items work together as a set — consistent palette, varied materials, correct scale.

IMPORTANT — MULTI-FUNCTION ROOMS: If this room serves multiple functions (e.g. a living room with a dining area, or a combined living/dining space), you MUST include items for ALL zones — dining table, dining chairs, lighting for the dining zone, seating for the living zone, etc. Do NOT limit recommendations to just the primary function. A living/dining combo typically needs 8-15 items across both zones.

Return JSON:
{
  "summary": "3-4 sentence assessment of the current state — mention dominant colors, materials, what's working, what's broken. Be specific.",
  "what_it_needs": [
    {
      "category": "snake_case category slug: area_rug, coffee_table, accent_chair, wall_art, throw_pillows, side_table, floor_lamp, table_lamp, storage_cabinet, credenza, media_console, dining_table, dining_chairs, bookshelf, console_table, curtains, pendant_light, throw_blanket, plant, vase, tray, kitchen_runner",
      "search_title": "A highly specific search query — see SEARCH TITLE FORMAT below",
      "description": "Why this item is needed — what specific problem it solves from the diagnosis. 2-3 sentences.",
      "priority": "high | medium | low",
      "specs": "Exact ideal dimensions (e.g. '48-54 inches wide, 20 inches deep'), preferred materials (e.g. 'solid walnut or oak'), color range (e.g. 'warm ivory, cream, or oatmeal'), approximate price range for the tier",
      "placement": "WHERE in the room this item goes and HOW it's oriented. Be spatial and specific. Consider window positions (don't block natural light), door swings (leave clearance), outlet access (lamps/media need power), and traffic paths. Examples: 'Centered under the pendant light, between the sofa and TV wall, long edge parallel to the sofa' or 'Left of the sofa, angled 15° toward the window to create a reading nook with natural light — outlet on south wall within 3ft' or 'On the wall opposite the entry, centered between the two windows at eye level (58 inches center)' or 'Under the dining table, extending 24 inches beyond the table on all sides for chair pullback'"
    }
  ],
  "what_works": ["5-8 specific items that should stay — name each item with material + color + WHERE it currently sits"],
  "what_should_go": ["specific items to replace or remove — name each item and explain why"],
  "design_direction": "A detailed paragraph (4-6 sentences) describing the overall design direction — color strategy (name exact colors), material mixing strategy, texture layering plan, the feeling we're going for. Reference the apartment's finishes and overall coherence.",
  "recommended_palette": ["List of 4-8 specific colors recommended for this room, e.g. 'warm ivory', 'walnut brown', 'sage green', 'matte black'"],
  "recommended_materials": ["List of 4-6 materials to use, e.g. 'solid walnut', 'linen', 'brushed brass', 'natural wool'"],
  "recommended_textures": ["List of 3-5 textures to layer, e.g. 'bouclé', 'woven rattan', 'matte ceramic', 'raw linen'"],
  "spatial_layout": "A paragraph describing the overall furniture arrangement strategy — traffic flow, conversation zones, sightlines, focal points, how the zones connect. Think about how someone moves through the room and how groups of furniture relate to each other spatially.",
  "lighting_conditions": "Describe the room's lighting: which direction windows face (north/south/east/west), how much natural light at different times of day, existing artificial lighting (overhead, recessed, lamps), dark corners or areas that need task lighting. Note if south-facing (bright, warm) or north-facing (cooler, diffused). Mention any glare issues on screens or reflective surfaces.",
  "window_door_positions": "List every window and door with its wall position and approximate size. E.g. 'Large window centered on south wall (~6ft wide), entry door on east wall (left corner), closet door on north wall (right side), balcony slider on west wall (~8ft wide)'. Note which open inward/outward and door swing clearance needed.",
  "outlet_positions": "Best-guess locations of electrical outlets based on photos and typical apartment layouts. E.g. 'Outlets visible: south wall flanking window, east wall near entry, north wall behind where TV sits. Likely outlets: west wall for kitchen peninsula.' Note any spots where lamps or media consoles would need extension cords."
}

## SEARCH TITLE FORMAT — CRITICAL
Each search_title will be used to find real products on furniture websites. Before writing each one, verify it includes:
✓ Material (required for all furniture): "solid walnut", "linen", "wool", "bouclé", "brass"
✓ Color or finish (required): "warm ivory", "natural oak", "matte black"
✓ Size/dimensions (required except small decor): "8x10", "48 inch", "36 inch diameter"
✓ Style descriptor (required): "mid-century", "modern", "organic", "minimalist"
✓ Product type (required): "area rug", "coffee table", "floor lamp"

GOOD search_title examples:
✓ "Large 8x10 hand-knotted wool area rug in warm cream with subtle geometric texture"
✓ "Solid walnut round coffee table 36-40 inch diameter with tapered legs and lower shelf"
✓ "Modern arc floor lamp in brushed brass with linen drum shade 72 inches tall"
✓ "Set of 2 mid-century upholstered dining chairs walnut frame cream fabric"
✓ "Woven rattan media console 60-70 inches wide with closed storage natural finish"

BAD search_title examples (will return category pages, not products):
✗ "Coffee table" — no material, no color, no size
✗ "Area rug in cream" — no size, no material, no texture description
✗ "Modern lamp" — no material, no size, no specific type
✗ "Throw pillows" — no material, no color, no size, no quantity
✗ "Wall art" — no medium, no size, no color palette, no style

## HOW MANY ITEMS TO RECOMMEND — MINIMUM COUNTS BY ROOM TYPE
You MUST recommend at least this many items (more is better):
- Living room: 10+ items | Bedroom: 9+ items | Dining room: 8+ items
- Studio/combined living+dining: 12+ items | Home office: 7+ items
- Entryway: 6+ items | Nursery: 8+ items | Kitchen: 6+ items

Walk through ALL THREE TIERS before finalizing your list:

**TIER 1 — ESSENTIAL** (room can't function without these):
Anchor furniture, primary rug, primary lighting, main surfaces

**TIER 2 — STANDARD** (expected in a well-furnished room):
Accent seating, secondary lighting, textiles (curtains/throw pillows/blankets), wall art, storage

**TIER 3 — FINISHING** (decorative completeness):
Plants, decorative objects, vases, trays, candles, accent lighting, books/display items

Do NOT return fewer items than the minimum. An incomplete list means the client's apartment will feel bare and unfinished. Include ALL THREE TIERS.

Be extremely specific. Name exact colors, materials, dimensions. Think like a world-class designer charging $500/hr.`,
  });

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, image_count: (room.room_images || []).length },
  });

  try {
    const profile = buildDesignProfile(project);
    const response = await geminiProvider.chat({
      model: selectModel("area_analysis"),
      system: getSystemPrompt(profile),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 16000,
      temperature: 0.3,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "high" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response is unstructured JSON
    let analysis = extractJsonObject<Record<string, any>>(response.content);

    // If the AI returned a truncated response, the JSON may be incomplete
    if (response.truncated) {
      throw new Error("AI response was truncated (MAX_TOKENS). The analysis was too long to complete. Try with fewer room photos.");
    }

    // If the AI returned an array instead of an object, unwrap the first element
    if (Array.isArray(analysis)) {
      if (analysis.length > 0 && typeof analysis[0] === "object" && analysis[0] !== null) {
        console.log(`[area-analysis] AI returned an array — unwrapping first element with keys: ${Object.keys(analysis[0]).join(", ")}`);
        analysis = analysis[0];
      } else {
        throw new Error(`AI returned an empty or invalid array. This is a model output format error — retrying should fix it.`);
      }
    }
    if (!analysis.what_it_needs || !Array.isArray(analysis.what_it_needs)) {
      throw new Error(`AI response missing required field "what_it_needs". Got keys: ${Object.keys(analysis).join(", ")}. This is a model output format error — retrying should fix it.`);
    }
    if (!analysis.what_works || !Array.isArray(analysis.what_works)) {
      throw new Error(`AI response missing required field "what_works". Got keys: ${Object.keys(analysis).join(", ")}. This is a model output format error.`);
    }
    if (!analysis.design_direction || typeof analysis.design_direction !== "string") {
      throw new Error(`AI response missing required field "design_direction". Got keys: ${Object.keys(analysis).join(", ")}. This is a model output format error.`);
    }

    console.log(`[area-analysis] AI response: ${analysis.what_it_needs.length} items needed, ${analysis.what_works.length} items working, ${analysis.what_should_go?.length || 0} items to go`);

    // ── Post-validation: enforce user constraints ────────────────────
    // Catch cases where the LLM ignored exclusions, keep items, or explicit requests
    if (parsedContext || allKeepItems.length > 0) {
      const validation = validateAreaAnalysis(analysis, allKeepItems, room.user_context || undefined);
      if (validation.wasModified) {
        analysis = validation.patched;
        console.log(`[area-analysis] Post-validation patched ${validation.issues.length} constraint violation(s):`,
          validation.issues.map(i => `${i.type}: ${i.description}`).join("; "));
      }
    }

    // ── Post-analysis: furnishing gap diagnostic ─────────────────────
    {
      const roomKey = (room.room_type || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
      const tiers = ROOM_FURNISHING_TIERS[roomKey] || ROOM_FURNISHING_TIERS["living_room"];
      const itemCount = analysis.what_it_needs.length;
      if (itemCount < tiers.minItemCount) {
        const bundleCategories = new Set<string>(
          analysis.what_it_needs.map((i: { category: string }) =>
            (i.category || "").toLowerCase().replace(/[\s-]+/g, "_"))
        );
        const matchesCat = (set: Set<string>, cat: string) =>
          [...set].some(bc => bc.includes(cat) || cat.includes(bc) || bc.replace(/s$/, "") === cat.replace(/s$/, ""));
        const missingEssential = tiers.essential.filter(c => !matchesCat(bundleCategories, c));
        const missingStandard = tiers.standard.filter(c => !matchesCat(bundleCategories, c));
        console.warn(`[area-analysis] Furnishing gap: ${itemCount} items returned (minimum: ${tiers.minItemCount}). Missing essential: [${missingEssential.join(", ")}]. Missing standard: [${missingStandard.join(", ")}]`);
        analysis._furnishing_gap = {
          item_count: itemCount,
          min_item_count: tiers.minItemCount,
          missing_essential: missingEssential,
          missing_standard: missingStandard,
        };
      }
    }

    // ── Harmony + Spatial validation loop ────────────────────────────
    // Validate every recommended item, apply revisions for any score < 10,
    // then re-validate until all items score 10/10 or max rounds reached.
    const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);
    const br = project?.building_research as Record<string, unknown> | undefined;
    const rawFloorPlan = br?.floor_plan as Record<string, unknown> | undefined;
    // Override floor plan sqft with user-provided value if available
    const floorPlan = rawFloorPlan
      ? { ...rawFloorPlan, ...(userSqft ? { total_sqft: userSqft } : {}) }
      : userSqft ? { total_sqft: userSqft } : undefined;
    // Build cross-room context for apartment-wide coherence checks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const otherRoomsForHarmony = (otherRooms || []).map((r: any) => {
      const diagnoses = r.room_diagnoses as Array<{ diagnosis_json: Record<string, unknown>; design_direction_json?: Record<string, unknown> }> | undefined;
      const latestDiag = diagnoses?.[diagnoses.length - 1];
      const dj = latestDiag?.diagnosis_json;
      const dd = latestDiag?.design_direction_json as Record<string, unknown> | undefined;
      return {
        name: r.name as string,
        roomType: r.room_type as string,
        designDirection: (dj?.design_direction as string) || undefined,
        palette: (dd?.recommended_palette as string[]) || (dj?.recommended_palette as string[]) || undefined,
        materials: (dd?.recommended_materials as string[]) || (dj?.recommended_materials as string[]) || undefined,
        keyItems: (dj?.what_works as string[])?.slice(0, 5) || undefined,
      };
    });

    const harmonyCtx = {
      roomType: room.room_type,
      roomName: room.name,
      roomImageUrls,
      buildingResearch: br,
      apartmentAnalysis: project?.apartment_analysis as Record<string, unknown> | undefined,
      designProfile: profile,
      floorPlan,
      userContext: room.user_context || undefined,
      otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
    };

    const MAX_HARMONY_ROUNDS = 10;
    /** Target: every item must score >= 9.5/10 to stop iterating */
    const TARGET_SCORE = 9.5;
    let validation = null;
    let latestMathResult: MathHarmonyResult | null = null;

    // ── Convergence tracking ──
    const bestScores = new Map<string, number>();
    /** Best version of each item: the analysis snapshot that produced the highest score */
    const bestVersions = new Map<string, { score: number; searchTitle: string; specs: string; placement?: string; rationale?: string }>();
    const previouslyRevised = new Set<string>();
    const stabilizedItems = new Set<string>(); // Items locked in — no more revisions
    // Revision history: per-item list of {round, score, specs, searchTitle, rootCause, rationale}
    const revisionHistory = new Map<string, Array<{ round: number; score: number; specs?: string; searchTitle?: string; rootCause?: string; rationale?: string }>>();
    // Track previous-round scores for stale detection
    const prevRoundScores = new Map<string, number>();

    let totalRoundsCompleted = 0;

    // ── Phase 1: Iterative refinement rounds — stop when ALL scores >= 9.5/10 ──
    for (let round = 1; round <= MAX_HARMONY_ROUNDS; round++) {
      const mathCtx = {
        roomType: room.room_type,
        floorPlan,
        otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
        buildingResearch: br,
      };
      latestMathResult = computeHarmonyScores(analysis, mathCtx);
      const mathScoresText = formatMathScoresForPrompt(latestMathResult);
      console.log(`[area-analysis] Round ${round} math scores: overall=${latestMathResult.overall.toFixed(2)}`);

      const harmonyResult = await validateRoomHarmony(analysis, { ...harmonyCtx, mathScoresText });

      if (!harmonyResult.success || !harmonyResult.data) {
        if (round === 1) {
          console.error(`[area-analysis] Harmony validation failed on round 1: ${harmonyResult.error}`);
          throw new Error(`Harmony validation failed: ${harmonyResult.error}`);
        }
        console.warn(`[area-analysis] Harmony round ${round} failed (${harmonyResult.error}), using last good state`);
        break;
      }

      const harmony = harmonyResult.data;

      if (!harmony.item_scores || !Array.isArray(harmony.item_scores)) {
        if (round === 1) {
          throw new Error(`Harmony validation failed: missing item_scores in response. Got keys: ${Object.keys(harmony).join(", ")}.`);
        }
        console.warn(`[area-analysis] Harmony round ${round} returned invalid data, using last good state`);
        break;
      }

      // Item attention guard: verify all items got scores (catch AI "forgetting" items)
      const expectedCategories = (analysis.what_it_needs as Array<{ category: string }>).map(i => i.category);
      const scoredCategories = new Set(harmony.item_scores.map((s: { category: string }) => s.category));
      const missingCategories = expectedCategories.filter(c => !scoredCategories.has(c));
      if (missingCategories.length > 0) {
        console.warn(`[area-analysis] Round ${round}: AI missed ${missingCategories.length} item(s): ${missingCategories.join(", ")}. Injecting conservative defaults.`);
        for (const cat of missingCategories) {
          harmony.item_scores.push({
            category: cat,
            harmony_score: 5.0,
            sub_scores: { color_fit: 5, spatial_fit: 5, material_fit: 5, style_coherence: 5, cross_room_fit: 5, functional_fit: 5 },
            keeps_well_with: [],
            clashes_with: [],
            drop: false,
            reason: "Not scored by AI — conservative defaults for next round",
            root_cause: "missing_score",
          });
        }
      }

      // Apply per-dimension math caps + composite scoring (weighted geometric mean + pairwise penalties)
      const mathItemMap = new Map(
        (latestMathResult?.itemScores || []).map((s) => [s.category, s])
      );
      for (const s of harmony.item_scores) {
        const mathItem = mathItemMap.get(s.category);

        // Build per-dimension math caps from the math module's outputs
        const mathCaps: MathDimensionCaps = {};
        if (latestMathResult) {
          // Color: use per-item color fit if available, fall back to palette_harmony
          // Per-item scoring measures how well THIS item's colors fit the palette,
          // rather than applying a single global penalty to every item
          const perItemFit = latestMathResult.color.per_item_color_fit?.get(s.category);
          if (perItemFit !== undefined) {
            // Blend per-item fit (70%) with palette harmony (30%) — the palette
            // harmony provides a baseline coherence signal while per-item fit
            // captures whether this specific item's colors work
            mathCaps.color_fit = perItemFit * 0.7 + latestMathResult.color.palette_harmony * 0.3;
          } else {
            mathCaps.color_fit = latestMathResult.color.palette_harmony;
          }
          // Spatial: use per-item spatial score if available, otherwise fall back to global average
          mathCaps.spatial_fit = latestMathResult.spatial.per_item_spatial?.get(s.category)
            ?? (latestMathResult.spatial.room_coverage_ratio + latestMathResult.spatial.clearance_score) / 2;
          // Material: evidence-only — no longer used as a cap.
          // Material observations (wood species, metal finishes) are injected into
          // the AI prompt as evidence; the AI scores material_fit freely.
          // Cross-room: use color cross_room_coherence
          mathCaps.cross_room_fit = latestMathResult.color.cross_room_coherence;
        }

        // Compute final harmony score using weighted geometric mean + pairwise penalty
        const compositeResult = computeFinalHarmonyScore(
          s.sub_scores,
          mathCaps,
          s.category,
          harmony.pairwise_conflicts || []
        );

        // Blend AI assessment with composite: AI expertise + math guardrails
        const computedScore = compositeResult.harmony_score;
        if (computedScore < s.harmony_score) {
          const divergence = s.harmony_score - computedScore;
          if (divergence > 3.0) {
            // Wild divergence — hard floor with 1-point grace
            const floored = Math.round((computedScore + 1.0) * 10) / 10;
            console.log(`[area-analysis] Round ${round}: "${s.category}" wild divergence: AI=${s.harmony_score} vs composite=${computedScore} → floored to ${floored}`);
            s.harmony_score = floored;
          } else {
            // Normal divergence — blend 70% AI + 30% composite
            const blended = Math.round((s.harmony_score * 0.7 + computedScore * 0.3) * 10) / 10;
            console.log(`[area-analysis] Round ${round}: "${s.category}" composite ${computedScore} < AI ${s.harmony_score} — blended to ${blended} (geoMean=${compositeResult.composite_before_pairwise}, pairFactor=${compositeResult.pairwise_factor})`);
            s.harmony_score = blended;
          }
        }

        // Log per-dimension caps if any were applied
        for (const cap of compositeResult.cappedDimensions) {
          console.log(`[area-analysis] Round ${round}: "${s.category}" ${cap.dimension}: AI=${cap.aiScore} capped to ${cap.mathCap} by math`);
        }

        // Log worst pairwise conflict
        if (compositeResult.worstConflict) {
          const wc = compositeResult.worstConflict;
          console.log(`[area-analysis] Round ${round}: "${s.category}" pairwise penalty: ${wc.item_a}↔${wc.item_b} compatibility=${wc.compatibility} (${wc.conflict_type}: ${wc.reason})`);
        }

        // Persistent violation penalty removed: with soft caps, violations are
        // naturally reflected in dampened scores. The old escalating penalty
        // (-0.3/round) created death spirals on items with unfixable math ceilings.
      }

      // Update best-ever scores and best versions
      const needs = analysis.what_it_needs as Array<Record<string, unknown>>;
      for (const s of harmony.item_scores) {
        const prev = bestScores.get(s.category) || 0;
        if (s.harmony_score > prev) {
          bestScores.set(s.category, s.harmony_score);
          // Snapshot the current best version of this item
          const item = needs.find((n) => n.category === s.category);
          if (item) {
            bestVersions.set(s.category, {
              score: s.harmony_score,
              searchTitle: (s.revised_search_title || item.search_title) as string,
              specs: (s.revised_specs || item.specs) as string,
              placement: (s.revised_placement || item.placement) as string | undefined,
              rationale: s.rationale,
            });
          }
        }
      }

      // ── Stabilization checks ──
      for (const s of harmony.item_scores) {
        if (stabilizedItems.has(s.category)) continue;

        // (A) Target reached: score >= 9.5 → lock in
        if (s.harmony_score >= TARGET_SCORE) {
          console.log(`[area-analysis] Round ${round}: "${s.category}" reached ${s.harmony_score}/10 (≥ ${TARGET_SCORE}) — locked in`);
          stabilizedItems.add(s.category);
          continue;
        }

        // (B) Stale detection: revised last round but score didn't improve → revert to best version and lock in
        const prevScore = prevRoundScores.get(s.category);
        if (prevScore !== undefined && previouslyRevised.has(s.category) && s.harmony_score <= prevScore) {
          // Revert to the best-ever version instead of locking in the degraded score
          const bestVersion = bestVersions.get(s.category);
          const bestScore = bestScores.get(s.category) || s.harmony_score;
          if (bestVersion && bestScore > s.harmony_score) {
            console.log(`[area-analysis] Round ${round}: "${s.category}" stale — score ${s.harmony_score}/10 (was ${prevScore}) after revision, reverting to best version (score ${bestScore})`);
            const item = needs.find((n) => n.category === s.category);
            if (item) {
              if (bestVersion.searchTitle) item.search_title = bestVersion.searchTitle;
              if (bestVersion.specs) item.specs = bestVersion.specs;
              if (bestVersion.placement) item.placement = bestVersion.placement;
            }
          } else {
            console.log(`[area-analysis] Round ${round}: "${s.category}" stale — score ${s.harmony_score}/10 (was ${prevScore}) after revision, locked in`);
          }
          stabilizedItems.add(s.category);
          continue;
        }

        // (C) Oscillation detection: check if root_cause contradicts a prior revision
        const history = revisionHistory.get(s.category);
        if (history && history.length >= 2 && s.root_cause) {
          const rootCauseLower = s.root_cause.toLowerCase();
          // Detect warm/cool oscillation
          const isWarmCoolFlip =
            (rootCauseLower.includes("too warm") && history.some((h) => h.rootCause?.toLowerCase().includes("too cool"))) ||
            (rootCauseLower.includes("too cool") && history.some((h) => h.rootCause?.toLowerCase().includes("too warm"))) ||
            (rootCauseLower.includes("too yellow") && history.some((h) => h.rootCause?.toLowerCase().includes("too cool"))) ||
            (rootCauseLower.includes("too cool") && history.some((h) => h.rootCause?.toLowerCase().includes("too yellow")));
          // Detect size oscillation (too large ↔ too small)
          const isSizeFlip =
            (rootCauseLower.includes("too large") && history.some((h) => h.rootCause?.toLowerCase().includes("too small"))) ||
            (rootCauseLower.includes("too small") && history.some((h) => h.rootCause?.toLowerCase().includes("too large"))) ||
            (rootCauseLower.includes("undersized") && history.some((h) => h.rootCause?.toLowerCase().includes("too large"))) ||
            (rootCauseLower.includes("too large") && history.some((h) => h.rootCause?.toLowerCase().includes("undersized")));
          // Detect generic spec oscillation: same root_cause type appeared before with a different fix
          const rootCauseType = rootCauseLower.split(":")[0]?.trim();
          const sameTypeCount = history.filter((h) => h.rootCause?.toLowerCase().startsWith(rootCauseType)).length;

          if (isWarmCoolFlip || isSizeFlip || sameTypeCount >= 2) {
            // Find the best-scoring version from history and bestVersions
            const bestVersion = bestVersions.get(s.category);
            const bestEntry = history.reduce((best, h) => h.score > best.score ? h : best, history[0]);
            const useVersion = bestVersion && bestVersion.score >= bestEntry.score ? bestVersion : bestEntry;
            console.log(`[area-analysis] Round ${round}: "${s.category}" oscillating (${isWarmCoolFlip ? "warm/cool" : isSizeFlip ? "size" : "repeated " + rootCauseType}) — locking in best version (score ${useVersion.score})`);
            stabilizedItems.add(s.category);

            // Restore best version's specs
            const item = needs.find((n) => n.category === s.category);
            if (item && useVersion.searchTitle) {
              item.search_title = useVersion.searchTitle;
            }
            if (item && useVersion.specs) {
              item.specs = useVersion.specs;
            }
            if (item && 'placement' in useVersion && useVersion.placement) {
              item.placement = useVersion.placement;
            }
            continue;
          }
        }
      }

      totalRoundsCompleted = round;

      validation = {
        confidence: harmony.confidence,
        overall_cohesion: harmony.overall_cohesion,
        palette_coherence: harmony.palette_coherence,
        material_coherence: harmony.material_coherence,
        spatial_flow: harmony.spatial_flow,
        issues: harmony.issues,
        item_scores: harmony.item_scores,
        pairwise_conflicts: harmony.pairwise_conflicts || [],
        math_scores: latestMathResult ? {
          overall: latestMathResult.overall,
          color: { ...latestMathResult.color, per_item_color_fit: Object.fromEntries(latestMathResult.color.per_item_color_fit) },
          spatial: { ...latestMathResult.spatial, per_item_spatial: Object.fromEntries(latestMathResult.spatial.per_item_spatial) },
          material: latestMathResult.material,
          proportion: latestMathResult.proportion,
        } : undefined,
        rounds_completed: round,
      };

      // Determine which items need revision: anything below 9.5 (excluding stabilized)
      const needsRevision = harmony.item_scores.filter((s) => {
        if (stabilizedItems.has(s.category)) return false;
        if (s.drop) return true;
        if (s.harmony_score >= TARGET_SCORE) return false;
        return true;
      });

      const belowTarget = harmony.item_scores.filter((s) => s.harmony_score < TARGET_SCORE);
      console.log(`[area-analysis] Harmony round ${round}: confidence=${harmony.confidence}/10, cohesion=${harmony.overall_cohesion}/10, items=${harmony.item_scores.length}, below ${TARGET_SCORE}=${belowTarget.length}, actionable=${needsRevision.length}, stabilized=${stabilizedItems.size}, scores=[${harmony.item_scores.map((s) => `${s.category}:${s.harmony_score}`).join(", ")}]`);

      // ── STOP CONDITION: ALL items >= 9.5/10 ──
      const allAtTarget = harmony.item_scores.every((s) => s.harmony_score >= TARGET_SCORE || stabilizedItems.has(s.category));
      if (allAtTarget || needsRevision.length === 0) {
        console.log(`[area-analysis] All items at ${TARGET_SCORE}+/10 or stabilized — moving to final assessment after ${round} round(s)`);
        break;
      }

      // (g) Early exit: convergence velocity check — if average improvement < 0.2 per round, stop
      if (round >= 3) {
        let totalImprovement = 0;
        let itemCount = 0;
        for (const s of harmony.item_scores) {
          if (stabilizedItems.has(s.category)) continue;
          const prev = prevRoundScores.get(s.category);
          if (prev !== undefined) {
            totalImprovement += s.harmony_score - prev;
            itemCount++;
          }
        }
        const avgImprovement = itemCount > 0 ? totalImprovement / itemCount : 0;
        if (avgImprovement < 0.2 && itemCount > 0) {
          console.log(`[area-analysis] Round ${round}: convergence velocity ${avgImprovement.toFixed(2)} < 0.2 threshold — early exit to save LLM rounds`);
          break;
        }
      }

      // Record current scores for next-round stale detection
      prevRoundScores.clear();
      for (const s of harmony.item_scores) {
        prevRoundScores.set(s.category, s.harmony_score);
      }

      // Apply revisions
      if (harmony.confidence < 7 && harmony.revisedAnalysis) {
        console.log(`[area-analysis] Round ${round}: confidence ${harmony.confidence}/10 — using full revised analysis`);
        analysis = harmony.revisedAnalysis;
        previouslyRevised.clear();
      } else {
        const revised: Array<Record<string, unknown>> = [];
        let revisedCount = 0;
        const actionableCategories = new Set(needsRevision.map((s) => s.category));

        for (const item of needs) {
          const score = harmony.item_scores.find(
            (s) => s.category === item.category
          );

          if (score?.drop && actionableCategories.has(score.category)) {
            console.log(`[area-analysis] Round ${round}: dropping "${item.category}" — score ${score.harmony_score}/10 | root cause: ${score.root_cause || score.reason}`);
            continue;
          }

          if (score && actionableCategories.has(score.category) && (score.revised_search_title || score.revised_placement || score.revised_specs)) {
            console.log(`[area-analysis] Round ${round}: revising "${item.category}" — score ${score.harmony_score}/10 | root cause: ${score.root_cause || score.reason}`);

            const newSearchTitle = score.revised_search_title || (item.search_title as string);
            const newSpecs = score.revised_specs || (item.specs as string);

            revised.push({
              ...item,
              search_title: newSearchTitle,
              specs: newSpecs,
              placement: score.revised_placement || item.placement,
            });
            previouslyRevised.add(item.category as string);
            revisedCount++;

            // Record in revision history
            const cat = item.category as string;
            if (!revisionHistory.has(cat)) revisionHistory.set(cat, []);
            revisionHistory.get(cat)!.push({
              round,
              score: score.harmony_score,
              specs: newSpecs,
              searchTitle: newSearchTitle,
              rootCause: score.root_cause || undefined,
              rationale: score.rationale || undefined,
            });
          } else {
            revised.push(item);
          }
        }

        analysis.what_it_needs = revised;

        if (revisedCount === 0) {
          console.log(`[area-analysis] Round ${round}: no actionable revisions — moving to final assessment`);
          break;
        }
      }

      // ── Max rounds reached: restore best versions for each item ──
      if (round === MAX_HARMONY_ROUNDS) {
        console.log(`[area-analysis] Max harmony rounds (${MAX_HARMONY_ROUNDS}) reached — restoring best versions for each item`);
        const finalNeeds = analysis.what_it_needs as Array<Record<string, unknown>>;
        for (const item of finalNeeds) {
          const cat = item.category as string;
          const bestVersion = bestVersions.get(cat);
          if (bestVersion) {
            console.log(`[area-analysis] Restoring best version for "${cat}": score=${bestVersion.score}/10`);
            item.search_title = bestVersion.searchTitle;
            item.specs = bestVersion.specs;
            if (bestVersion.placement) item.placement = bestVersion.placement;
          }
        }
        console.log(`[area-analysis] Best scores after ${MAX_HARMONY_ROUNDS} rounds: ${Array.from(bestScores.entries()).map(([cat, s]) => `${cat}=${s}`).join(", ")}`);
      }
    }

    // ── Phase 2: Final comprehensive AI assessment ──
    console.log(`[area-analysis] Starting final assessment after ${totalRoundsCompleted} iterative rounds (${stabilizedItems.size} items stabilized)`);

    // Compute fresh math scores for the final state
    const finalMathCtx = {
      roomType: room.room_type,
      floorPlan,
      otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
      buildingResearch: br,
    };
    latestMathResult = computeHarmonyScores(analysis, finalMathCtx);
    const finalMathText = formatMathScoresForPrompt(latestMathResult);

    // Convert revisionHistory Map to plain object for the prompt
    const revisionHistoryObj: Record<string, Array<{ round: number; score: number; specs?: string; searchTitle?: string; rootCause?: string; rationale?: string }>> = {};
    for (const [cat, entries] of revisionHistory) {
      revisionHistoryObj[cat] = entries;
    }

    const finalResult = await performFinalAssessment(analysis, {
      ...harmonyCtx,
      mathScoresText: finalMathText,
      revisionHistory: revisionHistoryObj,
      stabilizedItems: Array.from(stabilizedItems),
      roundsCompleted: totalRoundsCompleted,
    });

    if (finalResult.success && finalResult.data) {
      const final = finalResult.data;
      console.log(`[area-analysis] Final assessment: confidence=${final.confidence}/10, cohesion=${final.overall_cohesion}/10, needs_more=${final.needs_more_rounds}, budget=${final.round_budget}, scores=[${final.item_scores.map((s) => `${s.category}:${s.final_score}`).join(", ")}]`);

      // Apply final scores as the definitive validation.
      // Apply per-dimension math caps to each final score (same logic as main loop).
      // The AI prompt instructs the AI to respect math scores but we enforce it here too.
      const finalPairwise = final.pairwise_conflicts || [];
      validation = {
        confidence: final.confidence,
        overall_cohesion: final.overall_cohesion,
        palette_coherence: final.palette_coherence,
        material_coherence: final.material_coherence,
        spatial_flow: final.spatial_flow,
        issues: final.issues,
        item_scores: final.item_scores.map((s) => {
          // Build math caps from final math result (same formula as main loop)
          const finalMathCaps: MathDimensionCaps = {};
          if (latestMathResult) {
            const perItemFit = latestMathResult.color.per_item_color_fit?.get(s.category);
            finalMathCaps.color_fit = perItemFit !== undefined
              ? perItemFit * 0.7 + latestMathResult.color.palette_harmony * 0.3
              : latestMathResult.color.palette_harmony;
            finalMathCaps.spatial_fit = latestMathResult.spatial.per_item_spatial?.get(s.category)
              ?? (latestMathResult.spatial.room_coverage_ratio + latestMathResult.spatial.clearance_score) / 2;
            // Material: evidence-only — no cap
            finalMathCaps.cross_room_fit = latestMathResult.color.cross_room_coherence;
          }
          // Apply composite with soft blending (same as main loop)
          let harmonyScore = s.final_score;
          if (s.sub_scores && latestMathResult) {
            const compositeResult = computeFinalHarmonyScore(s.sub_scores, finalMathCaps, s.category, finalPairwise);
            if (compositeResult.harmony_score < harmonyScore) {
              const divergence = harmonyScore - compositeResult.harmony_score;
              if (divergence > 3.0) {
                const floored = Math.round((compositeResult.harmony_score + 1.0) * 10) / 10;
                console.log(`[area-analysis] Final assessment: "${s.category}" wild divergence: AI=${harmonyScore} vs composite=${compositeResult.harmony_score} → floored to ${floored}`);
                harmonyScore = floored;
              } else {
                const blended = Math.round((harmonyScore * 0.7 + compositeResult.harmony_score * 0.3) * 10) / 10;
                console.log(`[area-analysis] Final assessment: "${s.category}" composite ${compositeResult.harmony_score} < AI ${harmonyScore} — blended to ${blended}`);
                harmonyScore = blended;
              }
            }
          }
          return {
            category: s.category,
            harmony_score: harmonyScore,
            sub_scores: s.sub_scores,
            keeps_well_with: [] as string[],
            clashes_with: [] as string[],
            revised_search_title: s.revised_search_title,
            revised_specs: s.revised_specs,
            revised_placement: s.revised_placement,
            drop: false,
            root_cause: s.root_cause,
            reason: s.reason,
            rationale: s.rationale,
          };
        }),
        pairwise_conflicts: final.pairwise_conflicts || [],
        math_scores: {
          overall: latestMathResult.overall,
          color: { ...latestMathResult.color, per_item_color_fit: Object.fromEntries(latestMathResult.color.per_item_color_fit) },
          spatial: { ...latestMathResult.spatial, per_item_spatial: Object.fromEntries(latestMathResult.spatial.per_item_spatial) },
          material: latestMathResult.material,
          proportion: latestMathResult.proportion,
        },
        rounds_completed: totalRoundsCompleted,
        final_assessment: true,
      };

      // ── Phase 3: If final assessment says more work needed, do targeted rounds ──
      if (final.needs_more_rounds && final.round_budget > 0) {
        const itemsNeedingWork = final.item_scores.filter((s) => s.needs_more_work);
        console.log(`[area-analysis] Final assessment requests ${final.round_budget} more rounds for ${itemsNeedingWork.length} items: ${itemsNeedingWork.map((s) => s.category).join(", ")}`);

        // Apply the final assessment's revisions first
        const needs = analysis.what_it_needs as Array<Record<string, unknown>>;
        for (const item of needs) {
          const finalItem = itemsNeedingWork.find((s) => s.category === item.category);
          if (finalItem) {
            if (finalItem.revised_search_title) item.search_title = finalItem.revised_search_title;
            if (finalItem.revised_specs) item.specs = finalItem.revised_specs;
            if (finalItem.revised_placement) item.placement = finalItem.revised_placement;
          }
        }

        // Lock all items that DON'T need more work — only iterate on flagged ones
        const postFinalStabilized = new Set(stabilizedItems);
        for (const s of final.item_scores) {
          if (!s.needs_more_work) postFinalStabilized.add(s.category);
        }

        for (let extraRound = 1; extraRound <= final.round_budget; extraRound++) {
          const postRound = totalRoundsCompleted + extraRound;
          console.log(`[area-analysis] Post-final round ${extraRound}/${final.round_budget} (total round ${postRound})`);

          latestMathResult = computeHarmonyScores(analysis, finalMathCtx);
          const mathText = formatMathScoresForPrompt(latestMathResult);

          const harmonyResult = await validateRoomHarmony(analysis, { ...harmonyCtx, mathScoresText: mathText });

          if (!harmonyResult.success || !harmonyResult.data) {
            console.warn(`[area-analysis] Post-final round ${extraRound} failed — using current state`);
            break;
          }

          const harmony = harmonyResult.data;
          if (!harmony.item_scores || !Array.isArray(harmony.item_scores)) break;

          // Apply per-dimension composite scoring (same as main loop)
          for (const s of harmony.item_scores) {
            const postMathCaps: MathDimensionCaps = {};
            if (latestMathResult) {
              // Use per-item color fit if available (same logic as main loop)
              const postPerItemFit = latestMathResult.color.per_item_color_fit?.get(s.category);
              if (postPerItemFit !== undefined) {
                postMathCaps.color_fit = postPerItemFit * 0.7 + latestMathResult.color.palette_harmony * 0.3;
              } else {
                postMathCaps.color_fit = latestMathResult.color.palette_harmony;
              }
              postMathCaps.spatial_fit = latestMathResult.spatial.per_item_spatial?.get(s.category)
                ?? (latestMathResult.spatial.room_coverage_ratio + latestMathResult.spatial.clearance_score) / 2;
              // Material: evidence-only — no cap
              postMathCaps.cross_room_fit = latestMathResult.color.cross_room_coherence;
            }
            const compositeResult = computeFinalHarmonyScore(s.sub_scores, postMathCaps, s.category, harmony.pairwise_conflicts || []);
            if (compositeResult.harmony_score < s.harmony_score) {
              const divergence = s.harmony_score - compositeResult.harmony_score;
              if (divergence > 3.0) {
                const floored = Math.round((compositeResult.harmony_score + 1.0) * 10) / 10;
                console.log(`[area-analysis] Post-final round ${extraRound}: "${s.category}" wild divergence: AI=${s.harmony_score} vs composite=${compositeResult.harmony_score} → floored to ${floored}`);
                s.harmony_score = floored;
              } else {
                const blended = Math.round((s.harmony_score * 0.7 + compositeResult.harmony_score * 0.3) * 10) / 10;
                console.log(`[area-analysis] Post-final round ${extraRound}: "${s.category}" composite ${compositeResult.harmony_score} < AI ${s.harmony_score} — blended to ${blended}`);
                s.harmony_score = blended;
              }
            }
          }

          // Only revise items that the final assessment flagged
          let revisedCount = 0;
          const revisedNeeds: Array<Record<string, unknown>> = [];

          for (const item of analysis.what_it_needs as Array<Record<string, unknown>>) {
            const score = harmony.item_scores.find((s) => s.category === item.category);
            if (!score || postFinalStabilized.has(item.category as string)) {
              revisedNeeds.push(item);
              continue;
            }
            if (score.harmony_score >= TARGET_SCORE) {
              console.log(`[area-analysis] Post-final round ${extraRound}: "${item.category}" now ${score.harmony_score}/10 (≥ ${TARGET_SCORE}) — stabilized`);
              postFinalStabilized.add(item.category as string);
              revisedNeeds.push(item);
              continue;
            }
            if (score.revised_search_title || score.revised_specs || score.revised_placement) {
              console.log(`[area-analysis] Post-final round ${extraRound}: revising "${item.category}" — ${score.harmony_score}/10 | ${score.root_cause || score.reason}`);
              revisedNeeds.push({
                ...item,
                search_title: score.revised_search_title || item.search_title,
                specs: score.revised_specs || item.specs,
                placement: score.revised_placement || item.placement,
              });
              revisedCount++;
            } else {
              revisedNeeds.push(item);
            }
          }

          analysis.what_it_needs = revisedNeeds;

          // Update validation with latest scores
          validation = {
            ...validation,
            item_scores: harmony.item_scores.map((s) => ({
              category: s.category,
              harmony_score: s.harmony_score,
              keeps_well_with: s.keeps_well_with || [],
              clashes_with: s.clashes_with || [],
              revised_search_title: s.revised_search_title,
              revised_specs: s.revised_specs,
              revised_placement: s.revised_placement,
              drop: s.drop,
              root_cause: s.root_cause,
              reason: s.reason,
              rationale: s.rationale,
            })),
            rounds_completed: postRound,
            math_scores: {
              overall: latestMathResult.overall,
              color: { ...latestMathResult.color, per_item_color_fit: Object.fromEntries(latestMathResult.color.per_item_color_fit) },
              spatial: { ...latestMathResult.spatial, per_item_spatial: Object.fromEntries(latestMathResult.spatial.per_item_spatial) },
              material: latestMathResult.material,
              proportion: latestMathResult.proportion,
            },
          };

          if (revisedCount === 0) {
            console.log(`[area-analysis] Post-final round ${extraRound}: no more revisions needed — done`);
            break;
          }
        }
      }
    } else {
      console.warn(`[area-analysis] Final assessment failed (${finalResult.error}) — using iterative-round validation`);
    }

    // ── Post-harmony re-validation: re-enforce user constraints ──────
    // The harmony loop can revise/drop items in ways that violate user
    // exclusions, keep-item protections, or explicit requests. Re-run
    // the deterministic validator as a final gate before saving.
    if (parsedContext || allKeepItems.length > 0) {
      const postHarmonyValidation = validateAreaAnalysis(analysis, allKeepItems, room.user_context || undefined);
      if (postHarmonyValidation.wasModified) {
        analysis = postHarmonyValidation.patched;
        console.log(`[area-analysis] Post-harmony re-validation patched ${postHarmonyValidation.issues.length} constraint violation(s):`,
          postHarmonyValidation.issues.map(i => `${i.type}: ${i.description}`).join("; "));
      }
    }

    // (n) Add confidence intervals to per-item scores
    // (o) Generate scoring_explanation summary for the final output
    if (validation && latestMathResult) {
      const itemScores = validation.item_scores as Array<Record<string, unknown>>;
      for (const item of itemScores) {
        const mathItem = latestMathResult.itemScores.find(m => m.category === item.category);
        const hasFloorPlanDims = !!(floorPlan as Record<string, unknown> | undefined)?.room_dimensions;
        const hasBuildingResearch = !!br;

        // (n) Confidence interval: wider when data is sparse
        let uncertainty = 0.5; // base uncertainty
        if (!hasFloorPlanDims) uncertainty += 0.4; // no floor plan dims → spatial scores unreliable
        if (!hasBuildingResearch) uncertainty += 0.3; // no building research → less context
        if (mathItem && mathItem.violations.length > 0) uncertainty += 0.2; // violations introduce uncertainty
        if (otherRoomsForHarmony.length === 0) uncertainty += 0.2; // no cross-room data

        const score = (item.harmony_score as number) || 5;
        item.confidence_interval = {
          low: Math.max(0, Math.round((score - uncertainty) * 10) / 10),
          high: Math.min(10, Math.round((score + uncertainty) * 10) / 10),
          uncertainty: Math.round(uncertainty * 10) / 10,
          factors: [
            ...(!hasFloorPlanDims ? ["no room dimensions"] : []),
            ...(!hasBuildingResearch ? ["no building research"] : []),
            ...(mathItem && mathItem.violations.length > 0 ? ["has spatial violations"] : []),
            ...(otherRoomsForHarmony.length === 0 ? ["no cross-room data"] : []),
          ],
        };
      }

      // (o) Generate scoring_explanation summary
      const spatialViolations = latestMathResult.spatial.violations.length;
      const materialConflicts = latestMathResult.material.conflicts.length;
      const colorConflicts = latestMathResult.color.pair_conflicts.length;
      const proportionIssues = latestMathResult.proportion.issues.length;

      const summaryParts: string[] = [];
      if (spatialViolations > 0) summaryParts.push(`${spatialViolations} spatial violation${spatialViolations > 1 ? "s" : ""}`);
      if (materialConflicts > 0) summaryParts.push(`${materialConflicts} material conflict${materialConflicts > 1 ? "s" : ""}`);
      if (colorConflicts > 0) summaryParts.push(`${colorConflicts} color conflict${colorConflicts > 1 ? "s" : ""}`);
      if (proportionIssues > 0) summaryParts.push(`${proportionIssues} proportion issue${proportionIssues > 1 ? "s" : ""}`);

      const overallQuality = latestMathResult.overall >= 0.85 ? "high"
        : latestMathResult.overall >= 0.7 ? "good"
        : latestMathResult.overall >= 0.5 ? "moderate"
        : "needs improvement";

      (validation as Record<string, unknown>).scoring_explanation = {
        summary: summaryParts.length > 0
          ? `Math analysis found: ${summaryParts.join(", ")}. Overall quality: ${overallQuality} (${latestMathResult.overall.toFixed(2)}/1.0).`
          : `No math violations detected. Overall quality: ${overallQuality} (${latestMathResult.overall.toFixed(2)}/1.0).`,
        math_overall: latestMathResult.overall,
        color_harmony: latestMathResult.color.palette_harmony,
        spatial_score: (latestMathResult.spatial.room_coverage_ratio + latestMathResult.spatial.clearance_score) / 2,
        material_balance: (latestMathResult.material.material_balance + latestMathResult.material.wood_coherence + latestMathResult.material.metal_coherence + latestMathResult.material.soft_hard_ratio) / 4,
        proportion_score: (latestMathResult.proportion.rug_coverage + latestMathResult.proportion.height_relationships + latestMathResult.proportion.visual_balance) / 3,
        total_violations: spatialViolations + materialConflicts + colorConflicts + proportionIssues,
        rounds_completed: totalRoundsCompleted,
      };
    }

    // (p) Add budget summary to output if budget is set
    if (budgetDollars && analysis.what_it_needs) {
      const items = analysis.what_it_needs as Array<{ category: string; specs?: string; priority?: string }>;
      // Estimate prices from specs if they contain price ranges
      let estimatedTotal = 0;
      const itemBudgets: Array<{ category: string; estimated_price?: string }> = [];
      for (const item of items) {
        const priceMatch = item.specs?.match(/\$(\d[\d,]*)\s*[-–]\s*\$?(\d[\d,]*)/);
        if (priceMatch) {
          const low = parseInt(priceMatch[1].replace(",", ""), 10);
          const high = parseInt(priceMatch[2].replace(",", ""), 10);
          const mid = (low + high) / 2;
          estimatedTotal += mid;
          itemBudgets.push({ category: item.category, estimated_price: `$${low}-$${high}` });
        } else {
          itemBudgets.push({ category: item.category });
        }
      }

      (analysis as Record<string, unknown>).budget_summary = {
        budget_dollars: budgetDollars,
        budget_mode: budgetMode,
        estimated_total: estimatedTotal > 0 ? estimatedTotal : null,
        within_budget: estimatedTotal > 0 ? estimatedTotal <= budgetDollars : null,
        overage: estimatedTotal > budgetDollars ? estimatedTotal - budgetDollars : null,
        per_item: itemBudgets.filter(b => b.estimated_price),
      };

      if (estimatedTotal > budgetDollars && estimatedTotal > 0) {
        console.warn(`[area-analysis] Budget warning: estimated $${estimatedTotal} exceeds budget of $${budgetDollars} by $${estimatedTotal - budgetDollars}`);
      }
    }

    // Save as detailed diagnosis
    await supabase.from("room_diagnoses").insert({
      room_id,
      diagnosis_json: { ...analysis, validation },
      design_direction_json: {
        style_notes: analysis.design_direction,
        recommended_palette: analysis.recommended_palette || [],
        recommended_materials: analysis.recommended_materials || [],
        recommended_textures: analysis.recommended_textures || [],
        recommended_furniture_types: analysis.what_it_needs.map((n: { category: string }) => n.category),
      },
      missing_categories: analysis.what_it_needs.map((n: { category: string }) => n.category),
      action_list: analysis.what_it_needs,
      model_used: selectModel("area_analysis"),
    });

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { analysis, validation },
      tokens_used: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    });

    return NextResponse.json({ analysis, validation });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[area-analysis] Error:", errorMessage, err);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: `Analysis failed: ${errorMessage}` }, { status: 500 });
  }
}
