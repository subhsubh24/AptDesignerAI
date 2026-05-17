import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import { validateRoomHarmony, performFinalAssessment } from "@/lib/agents/validation-agent";
import { selfConsistent, seedForSample } from "@/lib/agents/self-consistency";
import { computeHarmonyScores, formatMathScoresForPrompt, type MathHarmonyResult } from "@/lib/validation/harmony-math";
import { computeFinalHarmonyScore, type MathDimensionCaps } from "@/lib/scoring/harmony-composite";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { parseUserContextAsync, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import { validateAreaAnalysisAsync } from "@/lib/agents/area-analysis-validator";
import { selfReviewAreaAnalysis, filterUnanchoredItems } from "@/lib/agents/self-correction";
import { reconcileKeepReplace } from "@/lib/agents/keep-replace-reconciler";
import { verifyWhatShouldGoAgainstPhotos, verifyWhatWorksAgainstPhotos } from "@/lib/agents/photo-grounding-validator";
import { inferReplacementsFromPhotos } from "@/lib/agents/infer-replacements";
import { ROOM_FURNISHING_TIERS, ORCHESTRATOR } from "@/lib/config/pipeline";
import { runDesignCoordinator, type DesignCoordinatorState, type DesignCoordinatorTool } from "@/lib/agents/design-coordinator";
import { buildIdentifiedPiecesBlock } from "@/lib/prompts/product-identification";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import { enrichWhatItNeeds } from "@/lib/agents/whatitneeds-enricher";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { userOwnsRoom } from "@/lib/auth/ownership";
import type { DesignDirection, IdentifiedProduct, ExtractedFloorPlan } from "@/lib/types/database";

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

// In-flight lock: coalesces concurrent POSTs for the same room.
// React 18 StrictMode double-mounts the focus page's useEffect, which
// fires two identical POSTs ~ms apart. The DB-level dedup check below
// only catches already-saved analyses; two in-flight requests would both
// see "nothing saved" and both run the 3-5 minute pipeline. This Map
// short-circuits the second caller to await the first caller's response.
const inFlightAnalyses = new Map<string, Promise<NextResponse>>();

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`area-analysis:${user.id}`, RATE_LIMITS.areaAnalysis);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many area-analysis requests. Please wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  const { room_id, project_id } = await request.json();
  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If another request for the same room is already running, wait for it.
  // Key includes user.id so concurrent requests from different users never share
  // a result built under a different auth context.
  const inflightKey = `${user.id}:${room_id}`;
  const existing = inFlightAnalyses.get(inflightKey);
  if (existing) {
    console.log(`[area-analysis] Coalescing in-flight request for room ${room_id}`);
    return existing;
  }

  const work = runAnalysis(supabase, room_id, project_id);
  inFlightAnalyses.set(inflightKey, work);
  try {
    return await work;
  } finally {
    inFlightAnalyses.delete(inflightKey);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client type is complex
export async function runAnalysis(
  supabase: any,
  room_id: string,
  project_id: string | undefined,
  options?: { forceRefresh?: boolean; extraDirection?: string },
): Promise<NextResponse> {
  // Dedup: if a valid area-analysis already exists for this room, return it
  const { data: existingDiagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", room_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDiagnosis && !options?.forceRefresh) {
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

  // Refine-chat passes accumulated client direction. Merge it into user_context
  // so the entire analysis (context parsing, prompt, validation) treats the
  // chat refinements as authoritative client notes.
  if (options?.extraDirection && options.extraDirection.trim()) {
    room.user_context = [room.user_context, options.extraDirection]
      .filter((s: unknown) => s && String(s).trim())
      .join("\n\n");
  }

  // Load project + other rooms in parallel (both need project_id which we have after room load)
  const effectiveProjectId = project_id || room.project_id;
  const [{ data: project }, { data: otherRooms }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", effectiveProjectId).single(),
    supabase.from("rooms").select("*, room_images(*), room_diagnoses(*)").eq("project_id", effectiveProjectId).neq("id", room_id),
  ]);

  // Extract floor plan data from building_research (new structured extraction)
  const brForFP = project?.building_research as Record<string, unknown> | undefined;
  const floorPlanImageUrl = brForFP?.floor_plan_image_url as string | undefined;
  const extractedFloorPlan = brForFP?.extracted_floor_plan as ExtractedFloorPlan | undefined;

  // Build vision content
  const contentBlocks: AIContentBlock[] = [];

  // Inject floor plan image as first block — authoritative spatial ground truth
  if (floorPlanImageUrl) {
    contentBlocks.push({
      type: "text",
      text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features (windows/doors/built-ins), and building orientation. Use this as the ground truth for all spatial facts. Do not infer or contradict any dimension readable from this plan.",
    });
    contentBlocks.push({ type: "image", source: { type: "url", url: floorPlanImageUrl } });
  }

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

    // Prefer structured extracted floor plan text over legacy floor_plan object
    const floorPlanSection = extractedFloorPlan
      ? `\n\n${formatExtractedFloorPlanForPrompt(extractedFloorPlan, room.room_type)}`
      : floorPlan
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
  const parsedContext = room.user_context ? await parseUserContextAsync(room.user_context) : null;
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

    // 90-day freshness window anchored to the room's own creation time
    // (not wall-clock) so the same room always sees the same sibling context
    // regardless of when the analysis is re-run.
    const roomCreatedMs = room.created_at ? Date.parse(room.created_at) : Date.now();
    const staleCutoffMs = (Number.isFinite(roomCreatedMs) ? roomCreatedMs : Date.now()) - 90 * 24 * 60 * 60 * 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const otherRoom of otherRooms as any[]) {
      const diagnoses = otherRoom.room_diagnoses as Array<{ diagnosis_json: Record<string, unknown>; created_at?: string }> | undefined;
      // Filter to fresh entries, then sort descending so we use the most recent.
      const sortedDiagnoses = diagnoses
        ?.filter((d) => {
          if (!d.created_at) return false;
          const t = Date.parse(d.created_at);
          return Number.isFinite(t) && t >= staleCutoffMs;
        })
        .slice()
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      const otherDiagnosis = sortedDiagnoses?.[0];
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

  // ── IDENTIFIED PRODUCTS (from the furniture-recognition pipeline) ──
  // Pulled from the most-recent diagnosis for this room. Only verified &
  // non-rejected entries make it into the prompt — the block is empty
  // (byte-for-byte inert) when the feature is off or no rows exist.
  let identifiedProducts: IdentifiedProduct[] = [];
  try {
    const { data: latestDiag } = await supabase
      .from("room_diagnoses")
      .select("diagnosis_json")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dj = latestDiag?.diagnosis_json as { identified_products?: IdentifiedProduct[] } | undefined;
    identifiedProducts = dj?.identified_products ?? [];
  } catch {
    // best-effort — identified_products missing is non-fatal
  }
  const identifiedPiecesBlock = buildIdentifiedPiecesBlock(identifiedProducts);

  // ── SHARED CONTEXT (goes into both Pass A and Pass B) ──
  // Pass A prompt — UNDERSTAND the room. No what_it_needs here; that's Pass B.
  const passAPrompt = `\nStudy the ${room.name} photos carefully. This is PASS 1 of 2. Your job is to UNDERSTAND the room — diagnose it, determine design direction, and capture spatial/environmental context. A separate pass will produce the shopping list (what_it_needs) — do NOT produce recommendations here.

<process>
Step 1: Study ALL room photos. Note every piece of furniture, finish, lighting condition, window/door.
Step 2: Identify what's working (keep) and what's not (replace/remove). Name items with material + color.
Step 3: Determine design direction based on the apartment's finishes and client preferences.
Step 4: Capture spatial & environmental context (layout, lighting, windows/doors, outlets) precisely — Pass 2 depends on this to place items.
</process>

<example_good_output>
{
  "summary": "A 450-sqft studio with grey LVP flooring, white walls, south-facing windows providing strong natural light. The charcoal Kivik sectional anchors the living zone. The space lacks warmth — no textiles, no accent lighting, bare walls. The kitchen's white quartz counters and brushed nickel hardware establish a cool-neutral base.",
  "what_works": [
    "IKEA Kivik sectional in Hillared anthracite — good scale for the space, low-profile, positioned correctly against the west wall",
    "White oak-look floating shelves above the desk — warm tone balances the grey floor, well-mounted",
    "Black metal desk lamp on the corner desk — functional, fits the industrial accent story",
    "Woven jute basket by the bookshelf — adds organic texture, practical storage"
  ],
  "what_should_go": [
    "Black metal folding TV tray used as coffee table — undersized (18x12 inch), wrong material family, visually harsh",
    "Blue plastic storage bins visible under desk — visual clutter, wrong material story, cheap look",
    "Mismatched throw pillows on sectional — competing patterns, no color cohesion"
  ],
  "style_name": "Nordic Charcoal",
  "design_direction": "Build on the charcoal sectional + grey LVP + white walls as a cool-neutral canvas, then inject warmth through natural oak, warm cream textiles, and brass accents. The 60-30-10 ratio: 60% cool greys/whites (existing), 30% warm wood + cream (new pieces), 10% matte brass + sage green (accents). This creates a Scandinavian-inspired space that feels intentional rather than unfinished.",
  "recommended_palette": ["charcoal grey", "warm cream", "natural oak", "matte brass", "sage green", "soft white"],
  "recommended_materials": ["solid oak", "linen", "brushed brass", "natural wool", "matte ceramic"],
  "recommended_textures": ["bouclé", "ribbed knit", "raw linen weave", "matte ceramic"],
  "spatial_layout": "The sectional defines a clear living zone against the west wall. Traffic flows from the entry (north) past the kitchen peninsula to the living zone. A 5ft clearance between the sectional and the south windows allows a reading nook. The TV wall (east) has 8ft of unbroken wall space for a media console + art. The desk zone (northeast corner) is separated by a 3ft gap.",
  "lighting_conditions": "South-facing windows deliver strong direct light from 10am-4pm; the west wall gets warm indirect light in late afternoon. The northeast desk corner is the darkest zone — needs task lighting. No existing floor or table lamps. Current ceiling light is a single warm-white dome.",
  "window_door_positions": "South wall: two 4ft-wide windows centered, sills at 30 inch, 6ft between them. Entry door: north wall, left side, swings inward 90° (24 inch clearance needed). No other doors.",
  "outlet_positions": "South wall: one outlet between windows (ideal for lamp). West wall: one outlet behind sectional (accessible). East wall: one outlet center-low (TV/media). North wall: one outlet near entry (desk area). Northeast corner: no visible outlet — extension cord likely needed for desk lamp."
}
</example_good_output>

<critical_rules>
WHAT_WORKS RULES — every entry MUST be a physical object the client owns and can move:
✅ CORRECT: furniture (sofas, tables, chairs, shelves), decor (lamps, baskets, art), textiles (rugs, pillows, throws)
❌ WRONG — NEVER include these: flooring, countertops, cabinetry, appliances, windows, walls, ceiling fixtures, built-in shelving, paint color, tile, backsplash
Architectural finishes belong in "summary", "spatial_layout", or "lighting_conditions" — NOT in what_works.

WHAT_SHOULD_GO RULES — every entry MUST be a removable physical item visible in the photos:
✅ CORRECT: "Cheap particle-board TV stand — wrong scale, laminate peeling" / "Mismatched throw pillows — competing patterns" / "Existing dark grey fabric sectional — undersized for the planned upgraded living area"
❌ WRONG — NEVER include these: absences ("lack of X", "no rug"), architectural features ("builder-grade ceiling light", "bare flooring"), hypotheticals ("any big-box furniture sets"), things tenants cannot change (ceiling fixtures, HVAC vents, wall outlets, appliances), abstract/vague catch-alls ("general clutter", "generic rental furniture", "filler decor", "miscellaneous items").

🎯 BE CONCRETE AND SPECIFIC. Each entry must NAME the exact physical object you see — color + material + form. NEVER use vague phrases like "general clutter", "personal items", "rental aesthetic", or "generic furniture". If you can see a dark grey fabric sectional that should go, write "Dark grey fabric sectional sofa — undersized for the planned upgrades", NOT "generic seating".

🪑 MAJOR FURNITURE REPLACEMENT: If a major piece of furniture (sofa, coffee table, media console / TV stand, dining table, area rug, accent chair, dresser, desk) is visible in the photos AND is NOT in the keep list AND your design_direction implies upgrading it, you MUST list the existing version as a specific entry in what_should_go. Do not skip this — the replace list is how the system knows which existing items are leaving.

⚠️ HALLUCINATION TRAP: Do NOT invent items to justify a purchase recommendation. If you plan to recommend buying a rug, DO NOT also claim there's already a bad rug in the room unless you can clearly see one in the photos. The same applies to all categories — only list items you can actually see.
</critical_rules>

<output_format>
Return JSON only — no prose, no markdown fences. Every field is required.
{
  "summary": "3-4 sentence assessment — dominant colors, materials, what's working, what's broken. Mention flooring, countertops, and wall finishes HERE (not in what_works).",
  "what_works": ["item name + material + color + position — ONLY movable furniture and decor the client owns"],
  "what_should_go": ["item name + why it doesn't work — ONLY removable physical objects visible in photos"],
  "style_name": "2-3 word evocative label derived from the room's actual physical cues. GOOD: 'Industrial Warmth', 'Cognac and Charcoal'. BAD (never use): 'Tech Minimalism', 'Contemporary Modern', 'Refined Minimalism'.",
  "design_direction": "4-6 sentences — color strategy, material mixing, texture layering. Reference specific apartment finishes. Explain how the direction serves this client.",
  "recommended_palette": ["4-8 specific colors — e.g. 'warm ivory', 'walnut brown', 'sage green'"],
  "recommended_materials": ["4-6 materials — e.g. 'solid walnut', 'linen', 'brushed brass'"],
  "recommended_textures": ["3-5 textures — e.g. 'bouclé', 'woven rattan', 'matte ceramic'"],
  "spatial_layout": "paragraph — traffic flow, conversation zones, sightlines, focal points. Include flooring, wall finishes, and built-in features here.",
  "lighting_conditions": "window direction, natural light at different times, existing artificial lighting (ceiling fixtures, etc.), dark corners, glare",
  "window_door_positions": "every window and door with wall position + approximate size, door swing clearance",
  "outlet_positions": "best-guess outlet locations from photos + typical layouts — note spots needing extension cords"
}
</output_format>

Be extremely specific. Name exact colors, materials, dimensions. Do NOT include what_it_needs or any shopping recommendations.${identifiedPiecesBlock ? `\n\n${identifiedPiecesBlock}` : ""}`;

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, image_count: (room.room_images || []).length },
  });

  try {
    const profile = buildDesignProfile(project);
    const model = selectModel("area_analysis");
    const system = getSystemPrompt(profile);

    /**
     * Pass A — UNDERSTAND the room.
     * Vision-heavy. Consumes all the shared context + room photos + apartment
     * context photos. Produces everything EXCEPT what_it_needs.
     *
     * contentBlocks (floor plan, building context, room photos, apartment
     * context photos) are stable across all N self-consistency samples. Hoist
     * them into `cacheScope` so Gemini re-tokenizes them at the cheaper cached
     * rate instead of paying full input cost N times.
     */
    const passARoomUrls = (room.room_images || []).map(
      (img: { image_url: string }) => img.image_url,
    );
    const areaSessionKey = crypto
      .createHash("sha256")
      .update(`area|${room.room_type}|${passARoomUrls.join("|")}`)
      .digest("hex")
      .slice(0, 16);

    const passAContent: AIContentBlock[] = [
      { type: "text", text: passAPrompt },
    ];

    // Self-consistency: sample N Pass A analyses in parallel (different seeds),
    // then use a judge LLM to pick the most coherent one. Pass A's output
    // (palette, materials, spatial_layout) is consumed unchanged by Pass B and
    // every downstream step, so variance here propagates to the entire room.
    // Default N=3, configurable via SELF_CONSISTENCY_N. See
    // lib/agents/self-consistency.ts for details.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    type PassASample = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: Record<string, any>;
      tokens: { input: number; output: number; thinking: number };
    };

    const generatePassASample = async (seed: number): Promise<PassASample | null> => {
      try {
        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: passAContent }],
          max_tokens: 16384,
          seed,
          responseMimeType: "application/json",
          cacheScope: contentBlocks.length > 0
            ? { sessionKey: areaSessionKey, content: contentBlocks }
            : undefined,
          tools: [
            { googleSearch: {} as Record<string, never> },
            { codeExecution: {} as Record<string, never> },
          ],
        });
        if (response.truncated) {
          console.warn("[area-analysis] Pass A sample truncated — discarding");
          return null;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        const raw = extractJsonObject<any>(response.content);
        const obj: Record<string, unknown> = Array.isArray(raw) && raw.length > 0 ? raw[0] : raw;
        if (!obj || typeof obj !== "object") return null;
        // Minimum viability: need at least a palette and materials to drive Pass B
        if (!Array.isArray((obj as Record<string, unknown>).recommended_palette) ||
            !Array.isArray((obj as Record<string, unknown>).recommended_materials)) {
          return null;
        }
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: obj as Record<string, any>,
          tokens: {
            input: response.usage?.input_tokens ?? 0,
            output: response.usage?.output_tokens ?? 0,
            thinking: response.usage?.thinking_tokens ?? 0,
          },
        };
      } catch (err) {
        console.warn(`[area-analysis] Pass A sample (seed ${seed}) failed:`, err);
        return null;
      }
    };

    const judgePassA = async (candidates: PassASample[]): Promise<number> => {
      const summaries = candidates.map((s, i) => {
        const c = s.data;
        const palette = Array.isArray(c.recommended_palette) ? c.recommended_palette : [];
        const materials = Array.isArray(c.recommended_materials) ? c.recommended_materials : [];
        const textures = Array.isArray(c.recommended_textures) ? c.recommended_textures : [];
        const whatWorks = Array.isArray(c.what_works) ? c.what_works : [];
        const whatGo = Array.isArray(c.what_should_go) ? c.what_should_go : [];
        return [
          `=== CANDIDATE ${i} ===`,
          `Summary: ${typeof c.summary === "string" ? c.summary : ""}`,
          `Design direction: ${typeof c.design_direction === "string" ? c.design_direction : ""}`,
          `What works (${whatWorks.length}): ${whatWorks.slice(0, 4).join("; ")}`,
          `What should go (${whatGo.length}): ${whatGo.slice(0, 4).join("; ")}`,
          `Palette (${palette.length}): ${palette.join(", ")}`,
          `Materials (${materials.length}): ${materials.join(", ")}`,
          `Textures: ${textures.join(", ")}`,
          `Spatial layout: ${typeof c.spatial_layout === "string" ? (c.spatial_layout as string).slice(0, 200) : ""}`,
        ].join("\n");
      }).join("\n\n");

      const judgePrompt = `You are a senior design critic comparing ${candidates.length} candidate analyses of the same room. Pick the ONE best candidate to drive the shopping list.

Evaluation criteria (in order):
1. **Palette–material–style coherence** — colors, materials, textures, and design_direction must describe ONE consistent aesthetic. A candidate that says "mid-century" with walnut + brass + boucle beats one that mixes walnut + chrome + lacquer.
2. **Concreteness** — specific colors ("warm walnut brown", "sage green") beat vague ones ("neutrals"). Specific materials ("boucle", "solid oak") beat categories ("fabric", "wood").
3. **Spatial honesty** — spatial_layout should reference actual geometry (windows, doors, traffic paths), not platitudes about "conversation zones".
4. **Diagnostic specificity** — what_should_go should name items + reasons, not generic complaints.

${summaries}

Return ONLY a JSON object: {"best_index": <integer 0 to ${candidates.length - 1}>, "reason": "<one sentence>"}`;

      try {
        // Feed the judge the same room/apartment photos the generators saw
        // (via cacheScope so token cost is amortized). Without images, the
        // judge rewards fluent specificity over ACCURATE observation — e.g.
        // a hallucinated "warm walnut floors" on a grey-LVP room can win
        // because it reads better. Grounding the judge on the actual photos
        // forces it to prefer accuracy.
        const resp = await geminiProvider.chat({
          model,
          system: getSystemPrompt(profile),
          messages: [{ role: "user", content: [{ type: "text", text: judgePrompt }] }],
          max_tokens: 4096,
          seed: DETERMINISTIC_SEED,
          thinkingConfig: { thinkingLevel: "low" },
          cacheScope:
            contentBlocks.length > 0
              ? { sessionKey: areaSessionKey, content: contentBlocks }
              : undefined,
          tools: [
            { codeExecution: {} as Record<string, never> },
          ],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        const parsed = extractJsonObject<any>(resp.content);
        const idx = typeof parsed?.best_index === "number" ? parsed.best_index : 0;
        console.log(`[area-analysis] Pass A judge chose candidate ${idx} of ${candidates.length}: ${parsed?.reason ?? "(no reason)"}`);
        return idx;
      } catch (err) {
        console.warn("[area-analysis] Pass A judge failed — defaulting to sample 0:", err);
        return 0;
      }
    };

    const selection = await selfConsistent<PassASample>({
      generate: generatePassASample,
      judge: judgePassA,
      label: "area-analysis.passA",
      qualityCheck: (sample) => {
        const d = sample.data;
        const palette = Array.isArray(d.recommended_palette) ? d.recommended_palette : [];
        const materials = Array.isArray(d.recommended_materials) ? d.recommended_materials : [];
        const whatWorks = Array.isArray(d.what_works) ? d.what_works : [];
        return palette.length >= 3 && materials.length >= 3 && whatWorks.length >= 1
          && typeof d.summary === "string" && d.summary.length > 50;
      },
    });
    const understanding = selection.chosen.data;
    // Sum tokens across every surviving sample — the generation cost is N×,
    // not 1×, and we want usage accounting to reflect that.
    const passATokens = selection.candidates.reduce(
      (acc, s) => ({ input: acc.input + s.tokens.input, output: acc.output + s.tokens.output, thinking: acc.thinking + (s.tokens.thinking ?? 0) }),
      { input: 0, output: 0, thinking: 0 },
    );
    // Suppress unused-import warning; seedForSample is reserved for future
    // callers that want per-sample seed inspection.
    void seedForSample;

    console.log(`[area-analysis] Pass A (understanding) complete — ${(understanding.what_works as unknown[] | undefined)?.length || 0} keeps, palette: ${((understanding.recommended_palette as unknown[] | undefined) || []).length}, materials: ${((understanding.recommended_materials as unknown[] | undefined) || []).length}, selected sample ${selection.judgeIndex} of ${selection.candidates.length}`);

    /**
     * Pass B — FURNISH the room.
     * Consumes Pass A's understanding as an explicit design brief. No photos
     * here — the job is pure planning (what to buy, specs, placement)
     * grounded in Pass A's direction and spatial context.
     */
    const roomKey = (room.room_type || "living_room").toLowerCase().replace(/[\s-]+/g, "_");
    const tiersForRoom = ROOM_FURNISHING_TIERS[roomKey] || ROOM_FURNISHING_TIERS["living_room"];

    const passBPrompt = `You are an interior designer producing the shopping list for the ${room.name}. Pass 1 already analyzed the room and produced the design brief below — your only job now is to translate that brief into a complete tiered list of items with specs and placements.

Do NOT re-diagnose the room. Do NOT produce what_works / what_should_go / design_direction / palette / materials / textures / spatial_layout / lighting_conditions / window_door_positions / outlet_positions — those come from Pass 1 unchanged. Only produce \`what_it_needs\`.

## PASS 1 DESIGN BRIEF (SOURCE OF TRUTH — do not contradict)
${JSON.stringify(understanding, null, 2)}
${keepItemsBlock}${replaceItemsBlock}${prioritiesBlock}${budgetBlock}${userContextNote}${parsedContextBlock ? `\n\n${parsedContextBlock}` : ""}${identifiedPiecesBlock ? `\n\n${identifiedPiecesBlock}\n\nDo NOT re-recommend any of the identified pieces above. If the room's existing anchor (e.g. a confirmed KIVIK sectional) already covers a Tier-1 category, SKIP that category and move the budget toward complementary pieces. Scale any new pieces against the CANONICAL dimensions listed so proportions match.` : ""}

## YOUR TASK
Produce a tiered, complete \`what_it_needs\` list:

**TIER 1 — ESSENTIAL**: anchor furniture, primary rug, primary lighting, main surfaces
**TIER 2 — STANDARD**: accent seating, secondary lighting, textiles, wall art, storage
**TIER 3 — FINISHING**: plants, decorative objects, vases, trays, candles, books

MINIMUM item count for ${room.room_type}: ${tiersForRoom.minItemCount}. More is better.
Essential categories: ${tiersForRoom.essential.join(", ")}
Standard categories: ${tiersForRoom.standard.join(", ")}

MULTI-FUNCTION ROOMS: if the room serves multiple functions (e.g. combined living/dining), include items for ALL zones — don't limit to primary function. A living/dining combo typically needs 8-15 items across both.

## MATERIAL COMMITMENT — BE BOLD
The design direction from Pass 1 has a specific material story. Commit to it fully in your item choices. Do NOT hedge with safe neutral alternatives when the direction calls for something specific:
- If Pass 1 says "cognac leather" as a supporting material → spec cognac leather (not "warm-toned upholstery")
- If Pass 1 says "solid walnut" → spec solid walnut (not "wood-toned surface")
- If Pass 1 says "matte black" → spec matte black (not "dark finish")
A design-forward choice that commits to the material story beats a safe choice that hedges. The harmony loop will catch true clashes — don't pre-censor yourself.

## SEARCH TITLE FORMAT — CRITICAL
Each search_title must include: material + color/finish + size + style + product type.
✓ "Large 8x10 hand-knotted wool area rug in warm cream with subtle geometric texture"
✓ "Solid walnut round coffee table 36-40 inch diameter with tapered legs and lower shelf"
✗ "Coffee table" — no material, color, size

## PLACEMENT must be SPATIAL
Reference Pass 1's \`spatial_layout\`, \`window_door_positions\`, and \`outlet_positions\`. Examples:
✓ "Centered under the pendant, between the sofa and TV wall, long edge parallel to the sofa"
✓ "Left of the sofa, angled 15° toward the south window — outlet on south wall within 3ft"

## SCOPE — NO WINDOW TREATMENTS
Never recommend curtains, drapes, blinds, shades, valances, or any window covering. Window treatments are out of scope for this product — do not include them in what_it_needs under any category name (not "curtains", not "window_treatments", not "drapery"). If a window looks bare, solve it with other items (furniture placement, lighting, plants, wall art) instead.

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "what_it_needs": [
    {
      "category": "snake_case slug (area_rug, coffee_table, accent_chair, wall_art, throw_pillows, side_table, floor_lamp, table_lamp, storage_cabinet, credenza, media_console, dining_table, dining_chairs, bookshelf, console_table, pendant_light, throw_blanket, plant, vase, tray)",
      "search_title": "Highly specific search query — material + color + size + style + type",
      "description": "Why this item — what problem from Pass 1's diagnosis it solves. 2-3 sentences.",
      "priority": "high | medium | low",
      "specs": "Exact dimensions, materials, color range, approximate price range for the budget tier",
      "placement": "EXACT position: which wall, how far from which landmark (window, door, corner). Reference spatial_layout and window_door_positions from Pass 1. E.g., 'Against the south wall, centered between the two windows' or 'In the empty corner between the east wall and the entry door, 2ft from each wall'. NEVER write vague placements like 'in the room' or 'by the wall'."
    }
  ]
}

At least ${tiersForRoom.minItemCount} items. Do NOT return fewer. Include all three tiers.

## CRITICAL — FOUNDATIONAL FURNITURE IS MANDATORY
Tier 1 essentials for ${room.room_type} MUST be present: [${tiersForRoom.essential.join(", ")}]. These are NON-NEGOTIABLE. A living room without a coffee table/media console/dining set is incomplete — the room cannot function without them.

Exception: If the Pass 1 "what_works" list already contains one of these (e.g. "keep the existing coffee table"), then SKIP that category in what_it_needs. Otherwise, it MUST appear.

Use Google Search to verify current pricing and material availability when needed. Use Code Execution for spatial calculations (clearances, rug sizing, table proportions relative to room dimensions).

## FEW-SHOT EXAMPLE (one what_it_needs entry — follow this level of specificity)
{
  "category": "coffee_table",
  "search_title": "Solid walnut round coffee table 42 inch diameter with tapered legs and lower shelf",
  "description": "Solves Pass 1's diagnosis of a 'floating seating zone with no anchor between the sectional and TV wall'. The 42-inch round in warm walnut ties to the Pass 1 material story (solid oak + walnut + brass) while the round profile prevents sharp corners on the primary traffic path.",
  "priority": "high",
  "specs": "42 inch diameter × 17 inch tall, solid walnut top with tapered oak legs and lower metal-inlay shelf, warm walnut brown finish, ~$650-950 (mid-range tier)",
  "placement": "Centered in front of the sectional's chaise, 14 inches off the sofa front (reachable from seated position), directly under the ceiling light to anchor the zone. Sits on the 8x10 rug with all legs on."
}`;

    const passBResponse = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: passBPrompt }] }],
      max_tokens: 32768,
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      tools: [
        { googleSearch: {} as Record<string, never> },
        { codeExecution: {} as Record<string, never> },
      ],
    });
    if (passBResponse.truncated) {
      throw new Error("AI response was truncated during Pass B (furnishing). The item list was too long.");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    const furnishingRaw = extractJsonObject<any>(passBResponse.content);
    // Gemini occasionally collapses the `{ "what_it_needs": [...] }` wrapper
    // and emits either (a) the bare items array, (b) a single item object with
    // keys like `category / search_title / description / priority / specs /
    // placement`, or (c) the wrapped shape we actually asked for. Normalize
    // all three into the expected `{ what_it_needs: [...] }` shape so the
    // downstream validator doesn't fail on a minor format drift.
    const ITEM_KEYS = new Set([
      "category",
      "search_title",
      "description",
      "priority",
      "specs",
      "placement",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merged LLM response
    const looksLikeItem = (v: any): boolean =>
      !!v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !("what_it_needs" in v) &&
      Object.keys(v).some((k) => ITEM_KEYS.has(k));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merged LLM response
    let furnishing: Record<string, any>;
    if (Array.isArray(furnishingRaw)) {
      // Case (a): top-level array. Treat it as the items list directly if the
      // entries look like item objects; otherwise fall back to the first entry.
      if (furnishingRaw.length > 0 && furnishingRaw.every(looksLikeItem)) {
        furnishing = { what_it_needs: furnishingRaw };
      } else {
        furnishing = furnishingRaw[0] ?? {};
      }
    } else if (looksLikeItem(furnishingRaw)) {
      // Case (b): a single item object — wrap it into a one-element list.
      furnishing = { what_it_needs: [furnishingRaw] };
      console.warn(
        `[area-analysis] Pass B returned a single item instead of a wrapper — coercing to what_it_needs[1]`,
      );
    } else {
      // Case (c): already the expected shape (or something else we'll fail on).
      furnishing = furnishingRaw ?? {};
    }
    console.log(`[area-analysis] Pass B (furnishing) complete — ${furnishing.what_it_needs?.length || 0} items`);

    // Enrich any what_it_needs items that lack specific dimensions or materials.
    // Pass B instructs the LLM to include these, but it doesn't always comply.
    // The enricher runs one batch call to fill in missing search_title/specs fields,
    // grounded in the Pass 1 design brief. Failures fall back to the original items.
    if (Array.isArray(furnishing.what_it_needs) && furnishing.what_it_needs.length > 0) {
      // Compute sqft from available sources: user-provided override first, then building_research floor_plan
      const enricherSqft = userSqft
        ?? ((brForFP?.floor_plan as Record<string, unknown> | undefined)?.total_sqft as number | undefined);
      furnishing.what_it_needs = await enrichWhatItNeeds(
        furnishing.what_it_needs,
        {
          roomType: room.room_type,
          roomSqft: enricherSqft,
          designDirection: {
            recommended_palette: (understanding.recommended_palette as string[] | undefined) ?? [],
            recommended_materials: (understanding.recommended_materials as string[] | undefined) ?? [],
            recommended_textures: (understanding.recommended_textures as string[] | undefined) ?? [],
            recommended_furniture_types: (understanding.recommended_furniture_types as string[] | undefined) ?? [],
            style_notes: (understanding.design_direction as string | undefined) ?? "",
          } as DesignDirection,
          pass1Brief: JSON.stringify({
            design_direction: understanding.design_direction,
            recommended_palette: understanding.recommended_palette,
            recommended_materials: understanding.recommended_materials,
            spatial_layout: understanding.spatial_layout,
          }),
        }
      );
    }

    // Merge Pass A + Pass B into the legacy analysis shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merged LLM response
    let analysis: Record<string, any> = {
      ...understanding,
      what_it_needs: furnishing.what_it_needs,
    };

    // Synthesize a response-compatible object for downstream code that reads `response.usage`.
    const response = {
      usage: {
        input_tokens: passATokens.input + (passBResponse.usage?.input_tokens || 0),
        output_tokens: passATokens.output + (passBResponse.usage?.output_tokens || 0),
        thinking_tokens: passATokens.thinking + (passBResponse.usage?.thinking_tokens || 0),
      },
    } as { usage: { input_tokens: number; output_tokens: number; thinking_tokens: number } };

    if (!analysis.what_it_needs || !Array.isArray(analysis.what_it_needs)) {
      throw new Error(`AI Pass B missing required field "what_it_needs". Got keys: ${Object.keys(furnishing).join(", ")}.`);
    }
    if (!analysis.what_works || !Array.isArray(analysis.what_works)) {
      throw new Error(`AI Pass A missing required field "what_works". Got keys: ${Object.keys(understanding).join(", ")}.`);
    }
    if (!analysis.design_direction || typeof analysis.design_direction !== "string") {
      throw new Error(`AI Pass A missing required field "design_direction". Got keys: ${Object.keys(understanding).join(", ")}.`);
    }

    console.log(`[area-analysis] AI response: ${analysis.what_it_needs.length} items needed, ${analysis.what_works.length} items working, ${analysis.what_should_go?.length || 0} items to go`);

    // ── Filter prose entries from what_works ──────────────────────────
    // Pass A occasionally returns explanatory prose instead of actual
    // furniture items (e.g. "None identified — existing furniture is
    // categorized as disjointed..."). These poison the pipeline.
    {
      const NON_ITEM_PATTERNS = [
        /^none\b/i,
        /^nothing\b/i,
        /^no (?:items?|furniture|pieces?|elements?)\b/i,
        /^not applicable\b/i,
        /^n\/a\b/i,
      ];
      const isProseEntry = (entry: string): boolean => {
        const head = entry.split(/\s[—–-]\s|:\s/)[0].trim();
        return NON_ITEM_PATTERNS.some((p) => p.test(head));
      };
      if (Array.isArray(analysis.what_works)) {
        const before = analysis.what_works as string[];
        const after = before.filter((e) => typeof e === "string" && !isProseEntry(e));
        if (after.length < before.length) {
          const dropped = before.filter((e) => typeof e === "string" && isProseEntry(e));
          analysis.what_works = after;
          console.log(`[area-analysis] Filtered ${dropped.length} prose entry/entries from what_works: ${dropped.join("; ")}`);
        }
      }
      if (Array.isArray(analysis.what_should_go)) {
        const before = analysis.what_should_go as string[];
        const after = before.filter((e) => typeof e === "string" && !isProseEntry(e));
        if (after.length < before.length) {
          const dropped = before.filter((e) => typeof e === "string" && isProseEntry(e));
          analysis.what_should_go = after;
          console.log(`[area-analysis] Filtered ${dropped.length} prose entry/entries from what_should_go: ${dropped.join("; ")}`);
        }
      }
    }

    // ── Category dedup: collapse duplicate categories into one item ──
    // Pass B occasionally emits the same category twice (e.g. two "plant"
    // entries). Downstream scoring treats them as independent items, which
    // wastes tokens and produces "plant:8.4 / plant:8.4" style duplicates
    // in the final output. Collapse them by category, keeping the higher-
    // priority entry and concatenating placement hints.
    {
      const seen = new Map<string, Record<string, unknown>>();
      const dropped: string[] = [];
      const priorityRank = (p: unknown) =>
        p === "high" ? 3 : p === "medium" ? 2 : p === "low" ? 1 : 0;
      for (const item of analysis.what_it_needs as Array<Record<string, unknown>>) {
        const cat = String(item.category || "").toLowerCase().replace(/[\s-]+/g, "_");
        if (!cat) continue;
        const existing = seen.get(cat);
        if (!existing) {
          seen.set(cat, item);
          continue;
        }
        // Duplicate category — keep the higher-priority version, merge placement.
        dropped.push(cat);
        const keep = priorityRank(item.priority) > priorityRank(existing.priority) ? item : existing;
        const drop = keep === item ? existing : item;
        const keepPlacement = String(keep.placement || "").trim();
        const dropPlacement = String(drop.placement || "").trim();
        if (dropPlacement && keepPlacement && !keepPlacement.includes(dropPlacement)) {
          keep.placement = `${keepPlacement}; alt: ${dropPlacement}`;
        } else if (dropPlacement && !keepPlacement) {
          keep.placement = dropPlacement;
        }
        seen.set(cat, keep);
      }
      if (dropped.length > 0) {
        analysis.what_it_needs = Array.from(seen.values());
        console.log(`[area-analysis] Deduplicated ${dropped.length} duplicate categor${dropped.length === 1 ? "y" : "ies"}: ${dropped.join(", ")} — now ${analysis.what_it_needs.length} items`);
      }
    }

    // ── Photo-grounding: verify Pass A's what_should_go AND what_works ──
    // Pass A occasionally hallucinates concrete-sounding items it expects to
    // see but doesn't ("dining chairs", "plastic storage bins", "glass dining
    // table"). It also lists architectural elements like "roller shades" or
    // "hardwood flooring" in what_works, which belong to the building, not the
    // user's furniture. Every downstream text-only step trusts these because
    // they sound real. These two image-based LLM calls catch both classes.
    // Conservative: drops only entries the model confidently rejects. Fails open.
    let photoVerifiedEntries: string[] = [];
    const groundingImageUrls = (room.room_images || [])
      .map((img: { image_url: string }) => img.image_url)
      .filter(Boolean);

    if (Array.isArray(analysis.what_should_go) && analysis.what_should_go.length > 0 && groundingImageUrls.length > 0) {
      const grounding = await verifyWhatShouldGoAgainstPhotos(
        analysis.what_should_go as string[],
        groundingImageUrls,
        room.room_type,
      );
      if (!grounding.fellBack) {
        photoVerifiedEntries = grounding.what_should_go;
        if (grounding.dropped.length > 0) {
          analysis.what_should_go = grounding.what_should_go;
          console.log(`[area-analysis] Photo-grounding dropped ${grounding.dropped.length} hallucinated what_should_go: ${grounding.dropped.map((d) => `"${d.entry}" (${d.reason})`).join("; ")}`);
        }
      }
    }

    if (Array.isArray(analysis.what_works) && analysis.what_works.length > 0 && groundingImageUrls.length > 0) {
      const worksGrounding = await verifyWhatWorksAgainstPhotos(
        analysis.what_works as string[],
        groundingImageUrls,
        room.room_type,
      );
      if (!worksGrounding.fellBack && worksGrounding.dropped.length > 0) {
        analysis.what_works = worksGrounding.what_works;
        console.log(`[area-analysis] Photo-grounding dropped ${worksGrounding.dropped.length} hallucinated/architectural what_works: ${worksGrounding.dropped.map((d) => `"${d.entry}" (${d.reason})`).join("; ")}`);
      }
    }

    // ── Reconciliation: cross-check Pass A's keep/replace lists against Pass B's shopping list ──
    // Pass A saw photos and produced what_works/what_should_go. Pass B did NOT
    // see photos and produced what_it_needs. Only AT THIS POINT do we have all
    // three lists in one place. The reconciler resolves contradictions:
    // cross-reference hallucinations, user-keep conflicts, duplicates, and
    // abstract non-items. It defaults to trusting Pass A's photo observations.
    {
      const reconciled = await reconcileKeepReplace({
        summary: String(analysis.summary || ""),
        what_works: Array.isArray(analysis.what_works) ? (analysis.what_works as string[]) : [],
        what_should_go: Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]) : [],
        what_it_needs: analysis.what_it_needs,
        keep_items: allKeepItems,
        room_type: room.room_type,
      });
      if (!reconciled.fellBack && reconciled.decisions.length > 0) {
        analysis.what_works = reconciled.what_works;
        analysis.what_should_go = reconciled.what_should_go;
        console.log(`[area-analysis] Reconciler applied ${reconciled.decisions.length} change(s):`,
          reconciled.decisions.join("; "));
      }
    }

    // ── Self-review: LLM checks its own output for consistency ───────
    {
      const selfReview = await selfReviewAreaAnalysis(
        analysis, allKeepItems, room.room_type,
        parsedContext?.explicitRequests?.map((r) => r.item),
      );
      if (selfReview.wasCorrepted) {
        analysis = selfReview.output as typeof analysis;
        console.log(`[area-analysis] Self-correction applied (${selfReview.correctionRounds} round(s)):`,
          selfReview.issues.join("; "));
      }
    }

    // ── Cross-reference hallucination filter ──────────────────────
    // Deterministic check: if a what_should_go entry's head noun matches a
    // what_it_needs category AND is not grounded in summary/keep items,
    // Pass A likely invented it to justify the purchase. Drop it.
    {
      const filtered = filterUnanchoredItems(analysis, allKeepItems, photoVerifiedEntries);
      const origGo = Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]) : [];
      const filtGo = Array.isArray(filtered.what_should_go) ? (filtered.what_should_go as string[]) : [];
      if (filtGo.length < origGo.length) {
        const dropped = origGo.filter((e) => !filtGo.includes(e));
        analysis.what_should_go = filtGo;
        console.log(`[area-analysis] Cross-reference filter dropped ${dropped.length} hallucinated what_should_go: ${dropped.join("; ")}`);
      }
    }

    // ── Ensure user keep items appear in what_works ────────────────
    // Runs AFTER self-correction so the LLM can't strip injected entries.
    // If the user said "keep the bookshelf" and no what_works entry mentions
    // "bookshelf", inject a stub so the Keep section isn't empty.
    // Also removes conflicting entries from what_should_go (user said keep,
    // not remove). Only checks worksText — NOT goText, because single-word
    // synonym matches against goText caused false positives (e.g. "lamp" in
    // keep matching "lighting" in a what_should_go reason).
    if (allKeepItems.length > 0 && Array.isArray(analysis.what_works)) {
      const KEEP_SYNONYMS: Record<string, string[]> = {
        sofa: ["sectional", "couch"], sectional: ["sofa", "couch"], couch: ["sofa", "sectional"],
        bookshelf: ["bookcase", "shelving"], bookcase: ["bookshelf"], shelving: ["bookshelf", "bookcase"],
        rug: ["carpet"], carpet: ["rug"], lamp: ["light"], light: ["lamp"],
        tv: ["television"], television: ["tv"], ottoman: ["footstool", "pouf"],
      };
      const KEEP_INJECT_GENERIC = new Set([
        "floor", "wall", "ceiling", "corner", "back", "front", "left", "right",
        "side", "top", "bottom", "near", "next", "behind", "above", "below",
        "black", "white", "grey", "gray", "brown", "blue", "red", "green",
        "beige", "tan", "cream", "ivory", "natural", "neutral",
        "small", "large", "long", "short", "tall", "wide", "narrow", "big", "mini",
        "two", "three", "four", "five", "set", "pair", "the", "and", "with",
        "also", "possible", "for", "next", "from", "arc",
      ]);
      const inWorksText = (term: string, haystack: string): boolean => {
        const norm = term.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
        if (!norm) return false;
        if (haystack.includes(norm)) return true;
        const significantWords = norm.split(/\s+/).filter(w => w.length >= 3 && !KEEP_INJECT_GENERIC.has(w));
        if (significantWords.length === 0) return false;
        let matchCount = 0;
        for (const word of significantWords) {
          if (haystack.includes(word)) { matchCount++; continue; }
          const syns = KEEP_SYNONYMS[word];
          if (syns?.some((s) => haystack.includes(s))) { matchCount++; }
        }
        if (significantWords.length >= 3) return matchCount >= Math.ceil(significantWords.length * 0.6);
        return matchCount > 0;
      };
      const stripCtx = (s: string) => s.replace(/\b(?:behind|next to|near|beside|by|on top of|under|also|if possible)\b.*/gi, "").trim();
      const worksText = (analysis.what_works as string[]).join(" ").toLowerCase();
      const injected: string[] = [];
      const movedFromGo: string[] = [];
      const seen = new Set<string>();
      for (const ki of allKeepItems) {
        const stripped = stripCtx(ki);
        if (!stripped || seen.has(stripped.toLowerCase())) continue;
        seen.add(stripped.toLowerCase());
        if (inWorksText(stripped, worksText)) continue;
        (analysis.what_works as string[]).push(`${stripped} — kept per client request`);
        injected.push(stripped);
        // Remove conflicting entries from what_should_go
        if (Array.isArray(analysis.what_should_go)) {
          const goArr = analysis.what_should_go as string[];
          const conflicting = goArr.filter((e) => inWorksText(stripped, e.toLowerCase()));
          if (conflicting.length > 0) {
            analysis.what_should_go = goArr.filter((e) => !conflicting.includes(e));
            movedFromGo.push(...conflicting);
          }
        }
      }
      if (injected.length > 0) {
        console.log(`[area-analysis] Injected ${injected.length} missing keep item(s) into what_works: ${injected.join(", ")}`);
      }
      if (movedFromGo.length > 0) {
        console.log(`[area-analysis] Removed ${movedFromGo.length} keep-conflicting entry/entries from what_should_go: ${movedFromGo.join("; ")}`);
      }
    }

    // ── Infer replacements from Pass B gap ─────────────────────────
    // LLM-based: look at room photos to determine which Pass B purchases
    // are replacing existing visible items. Falls back to deterministic
    // text matching if no photos or LLM fails.
    {
      const inferredReplacements = await inferReplacementsFromPhotos(
        {
          summary: String(analysis.summary || ""),
          design_direction: String(analysis.design_direction || ""),
          spatial_layout: String(analysis.spatial_layout || ""),
          what_works: Array.isArray(analysis.what_works) ? (analysis.what_works as string[]) : [],
          what_should_go: Array.isArray(analysis.what_should_go) ? (analysis.what_should_go as string[]) : [],
          what_it_needs: analysis.what_it_needs,
        },
        allKeepItems,
        groundingImageUrls,
        room.room_type || "living_room",
      );
      if (inferredReplacements.length > 0) {
        if (!Array.isArray(analysis.what_should_go)) {
          analysis.what_should_go = [];
        }
        for (const inf of inferredReplacements) {
          (analysis.what_should_go as string[]).push(inf.entry);
        }
        console.log(`[area-analysis] Inferred ${inferredReplacements.length} replacement(s) into what_should_go: ${inferredReplacements.map((r) => r.category).join(", ")}`);
      }
    }

    // ── Post-validation: enforce user constraints ────────────────────
    // Catch cases where the LLM ignored exclusions, keep items, or explicit requests
    if (parsedContext || allKeepItems.length > 0) {
      const validation = await validateAreaAnalysisAsync(analysis, allKeepItems, room.user_context || undefined);
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
      const diagnoses = r.room_diagnoses as Array<{ diagnosis_json: Record<string, unknown>; design_direction_json?: Record<string, unknown>; created_at?: string }> | undefined;
      const sortedDiag = diagnoses?.slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      const latestDiag = sortedDiag?.[0];
      const dj = latestDiag?.diagnosis_json;
      const dd = latestDiag?.design_direction_json as Record<string, unknown> | undefined;
      return {
        name: r.name as string,
        roomType: r.room_type as string,
        designDirection: (dj?.design_direction as string) || undefined,
        palette: (dd?.recommended_palette as string[]) || (dj?.recommended_palette as string[]) || undefined,
        materials: (dd?.recommended_materials as string[]) || (dj?.recommended_materials as string[]) || undefined,
        keyItems: (dj?.what_works as string[])?.slice(0, 5) || undefined,
        // Structured direction (full DesignDirection) — used by harmony-math for
        // palette Delta-E, material Euclidean, and style Jaccard cross-room metrics.
        directionStructured: dd
          ? ({
              recommended_palette: (dd.recommended_palette as string[]) ?? [],
              recommended_materials: (dd.recommended_materials as string[]) ?? [],
              recommended_textures: (dd.recommended_textures as string[]) ?? [],
              recommended_furniture_types: (dd.recommended_furniture_types as string[]) ?? [],
              style_notes: (dd.style_notes as string) ?? ((dj?.design_direction as string) ?? ""),
            } as DesignDirection)
          : null,
      };
    });

    // Build the current room's structured direction from the analysis object —
    // used for cross-apartment coherence computations against sibling rooms.
    const currentRoomDirection: DesignDirection | null =
      analysis.design_direction || analysis.recommended_palette || analysis.recommended_materials
        ? {
            recommended_palette: (analysis.recommended_palette as string[]) ?? [],
            recommended_materials: (analysis.recommended_materials as string[]) ?? [],
            recommended_textures: (analysis.recommended_textures as string[]) ?? [],
            recommended_furniture_types: ((analysis.what_it_needs as Array<{ category: string }> | undefined) ?? []).map((n) => n.category),
            style_notes: (analysis.design_direction as string) ?? "",
          }
        : null;

    // Build a cacheScope for room images — these are sent repeatedly across
    // all harmony/validation rounds and are the heaviest content. Caching them
    // avoids re-tokenizing 4+ images every round.
    const harmonyCacheBlocks: AIContentBlock[] = [];
    if (floorPlanImageUrl) {
      harmonyCacheBlocks.push({
        type: "text",
        text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features, and orientation.",
      });
      harmonyCacheBlocks.push({ type: "image", source: { type: "url", url: floorPlanImageUrl } });
    }
    for (const url of roomImageUrls.slice(0, 4)) {
      harmonyCacheBlocks.push({ type: "image", source: { type: "url", url } });
    }
    const harmonyCacheSessionKey = crypto
      .createHash("sha256")
      .update(`harmony|${room_id}|${roomImageUrls.join("|")}`)
      .digest("hex")
      .slice(0, 16);
    const harmonyCacheScope = harmonyCacheBlocks.length > 0
      ? { sessionKey: harmonyCacheSessionKey, content: harmonyCacheBlocks }
      : undefined;

    const harmonyCtx = {
      roomType: room.room_type,
      roomName: room.name,
      roomImageUrls,
      buildingResearch: br,
      apartmentAnalysis: project?.apartment_analysis as Record<string, unknown> | undefined,
      designProfile: profile,
      floorPlan,
      floorPlanImageUrl,
      extractedFloorPlan,
      userContext: room.user_context || undefined,
      otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
      identifiedContext: identifiedPiecesBlock || undefined,
      cacheScope: harmonyCacheScope,
    };

    // ── Design Coordinator (agentic) vs. Hardcoded Harmony Loop ──────
    // When the DesignCoordinator is enabled (default ON), an agent with
    // native function calling orchestrates the harmony/validation phase.
    // It decides how many rounds to run, when to re-search trends, when
    // to finalize — all based on objective score signals. The hardcoded
    // loop remains as a fallback (ENABLE_DESIGN_COORDINATOR=0).

    // Harmony loop runs until convergence: stops when ALL items reach
    // TARGET_SCORE OR no items improved last round (early-exit on plateau)
    // OR every item is stabilized/locked. NO artificial round cap — the
    // existing convergence-velocity check (avg improvement < 0.2) handles
    // the "stop chasing diminishing returns" case organically. A high
    // SAFETY_HARMONY_LIMIT exists only to prevent infinite loops in the
    // pathological case where convergence never triggers.
    const SAFETY_HARMONY_LIMIT = 50;
    /** Target: items at or above this score are "locked in" and skip revision. */
    const TARGET_SCORE = 8.5;
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
    let consecutiveLowVelocityRounds = 0;

    // ── Phase 1: Iterative refinement rounds — stop when ALL scores >= 9.5/10 ──
    for (let round = 1; round <= SAFETY_HARMONY_LIMIT; round++) {
      const mathCtx = {
        roomType: room.room_type,
        floorPlan,
        otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
        buildingResearch: br,
        designDirection: currentRoomDirection,
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

        // Log per-dimension caps if any were applied (only real reductions).
        for (const cap of compositeResult.cappedDimensions) {
          console.log(`[area-analysis] Round ${round}: "${s.category}" ${cap.dimension}: AI=${cap.aiScore} → ${cap.cappedTo} (math anchor ${cap.mathCap})`);
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

      // Deterministic confidence — blend math (source of truth) with AI assessment.
      // Without this, the AI converges at ~8.5-9.2 regardless of real state.
      const roundMathConfidence = latestMathResult ? Math.round(latestMathResult.overall * 100) / 10 : undefined;
      const roundBlendedConfidence = roundMathConfidence !== undefined
        ? Math.round((roundMathConfidence * 0.7 + harmony.confidence * 0.3) * 10) / 10
        : harmony.confidence;
      validation = {
        confidence: roundBlendedConfidence,
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
      if (round >= 2) {
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
          consecutiveLowVelocityRounds++;
          if (consecutiveLowVelocityRounds >= 2) {
            console.log(`[area-analysis] Round ${round}: convergence velocity ${avgImprovement.toFixed(2)} < 0.2 for ${consecutiveLowVelocityRounds} consecutive rounds — early exit to save LLM rounds`);
            break;
          }
        } else {
          consecutiveLowVelocityRounds = 0;
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
      if (round === SAFETY_HARMONY_LIMIT) {
        console.log(`[area-analysis] Max harmony rounds (${SAFETY_HARMONY_LIMIT}) reached — restoring best versions for each item`);
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
        console.log(`[area-analysis] Best scores after ${SAFETY_HARMONY_LIMIT} rounds: ${Array.from(bestScores.entries()).map(([cat, s]) => `${cat}=${s}`).join(", ")}`);
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
      designDirection: currentRoomDirection,
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
      // Deterministic confidence — blend math (source of truth) with AI assessment.
      // Without this, the AI prompt converges at ~8.5-9.2 regardless of actual state.
      const mathConfidence = latestMathResult ? Math.round(latestMathResult.overall * 100) / 10 : undefined;
      const blendedConfidence = mathConfidence !== undefined
        ? Math.round((mathConfidence * 0.7 + final.confidence * 0.3) * 10) / 10
        : final.confidence;
      validation = {
        confidence: blendedConfidence,
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

      // Apply the final assessment's revisions — no additional loop needed.
      // Items converge by round 1-2; running further rounds after the final
      // assessment historically added cost without measurable quality gain.
      const itemsNeedingWork = final.item_scores.filter((s) => s.needs_more_work);
      if (itemsNeedingWork.length > 0) {
        console.log(`[area-analysis] Final assessment: applying revisions for ${itemsNeedingWork.length} items: ${itemsNeedingWork.map((s) => s.category).join(", ")}`);
        const needs = analysis.what_it_needs as Array<Record<string, unknown>>;
        for (const item of needs) {
          const finalItem = itemsNeedingWork.find((s) => s.category === item.category);
          if (finalItem) {
            if (finalItem.revised_search_title) item.search_title = finalItem.revised_search_title;
            if (finalItem.revised_specs) item.specs = finalItem.revised_specs;
            if (finalItem.revised_placement) item.placement = finalItem.revised_placement;
          }
        }
      }
    } else {
      console.warn(`[area-analysis] Final assessment failed (${finalResult.error}) — using iterative-round validation`);
    }

    // ── Design Coordinator: post-harmony agentic review ──────────────
    // When enabled, the coordinator agent reviews the full pipeline output
    // using function calling + Google Search + Code Execution. It can
    // trigger additional harmony rounds or re-generation if the design
    // has fundamental issues that the deterministic loop missed.
    if (ORCHESTRATOR.enableDesignCoordinator) {
      const coordState: DesignCoordinatorState = {
        passAComplete: true,
        passBComplete: true,
        enrichmentComplete: true,
        harmonyRoundsCompleted: totalRoundsCompleted,
        finalAssessmentComplete: !!validation,
        itemCount: (analysis.what_it_needs as unknown[])?.length || 0,
        categories: ((analysis.what_it_needs as Array<{ category: string }>) || []).map((i) => i.category),
        latestScores: validation?.item_scores
          ? (validation.item_scores as Array<{ category: string; harmony_score: number }>).map((s) => ({
              category: s.category,
              score: s.harmony_score,
              stabilized: stabilizedItems.has(s.category),
            }))
          : undefined,
        convergenceVelocity: undefined,
        stabilizedCount: stabilizedItems.size,
        totalItems: (analysis.what_it_needs as unknown[])?.length || 0,
        overallCohesion: (validation as Record<string, unknown> | null)?.overall_cohesion as number | undefined,
        confidence: (validation as Record<string, unknown> | null)?.confidence as number | undefined,
      };

      const coordResult = await runDesignCoordinator(
        () => coordState,
        async (toolName: DesignCoordinatorTool, args: Record<string, unknown>) => {
          switch (toolName) {
            case "run_harmony_round": {
              const mathCtx = {
                roomType: room.room_type,
                floorPlan,
                otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
                buildingResearch: br,
                designDirection: currentRoomDirection,
              };
              latestMathResult = computeHarmonyScores(analysis, mathCtx);
              const mathScoresText = formatMathScoresForPrompt(latestMathResult);
              const harmonyResult = await validateRoomHarmony(analysis, { ...harmonyCtx, mathScoresText });
              if (!harmonyResult.success || !harmonyResult.data) {
                return { error: harmonyResult.error || "Harmony validation failed" };
              }
              const scores = harmonyResult.data.item_scores.map((s) => ({
                category: s.category,
                score: s.harmony_score,
                needsRevision: s.harmony_score < 8.5,
              }));
              const avgScore = scores.reduce((a, s) => a + s.score, 0) / scores.length;
              coordState.harmonyRoundsCompleted++;
              coordState.latestScores = scores.map((s) => ({ ...s, stabilized: false }));
              coordState.overallCohesion = harmonyResult.data.overall_cohesion;
              coordState.confidence = harmonyResult.data.confidence;
              return { avgScore, scores, cohesion: harmonyResult.data.overall_cohesion };
            }
            case "run_final_assessment": {
              const fMathCtx = {
                roomType: room.room_type,
                floorPlan,
                otherRooms: otherRoomsForHarmony.length > 0 ? otherRoomsForHarmony : undefined,
                buildingResearch: br,
                designDirection: currentRoomDirection,
              };
              latestMathResult = computeHarmonyScores(analysis, fMathCtx);
              const fMathText = formatMathScoresForPrompt(latestMathResult);
              const revHistObj: Record<string, Array<{ round: number; score: number; specs?: string; searchTitle?: string; rootCause?: string }>> = {};
              for (const [cat, entries] of revisionHistory) {
                revHistObj[cat] = entries;
              }
              const finalResult = await performFinalAssessment(analysis, {
                ...harmonyCtx,
                mathScoresText: fMathText,
                revisionHistory: revHistObj,
                stabilizedItems: Array.from(stabilizedItems),
                roundsCompleted: totalRoundsCompleted,
              });
              if (finalResult.success && finalResult.data) {
                coordState.finalAssessmentComplete = true;
                coordState.finalAssessmentResult = {
                  needsMoreRounds: finalResult.data.needs_more_rounds,
                  roundBudget: finalResult.data.round_budget,
                };
                return {
                  needsMoreRounds: finalResult.data.needs_more_rounds,
                  roundBudget: finalResult.data.round_budget,
                  confidence: finalResult.data.confidence,
                  cohesion: finalResult.data.overall_cohesion,
                };
              }
              return { error: finalResult.error || "Final assessment failed" };
            }
            case "search_design_trends": {
              const query = args.query as string;
              try {
                const searchResp = await geminiProvider.chat({
                  model: selectModel("validation"),
                  system: getSystemPrompt(profile),
                  messages: [{
                    role: "user",
                    content: [{
                      type: "text",
                      text: `Search for and summarize: ${query}\n\nReturn a concise summary of findings relevant to interior design recommendations.`,
                    }],
                  }],
                  max_tokens: 8192,
                  thinkingConfig: { thinkingLevel: "low" },
                  tools: [{ googleSearch: {} as Record<string, never> }],
                });
                coordState.designTrendSearches = [
                  ...(coordState.designTrendSearches || []),
                  query,
                ];
                return { query, summary: searchResp.content.slice(0, 1000) };
              } catch {
                return { query, error: "Search failed" };
              }
            }
            case "run_pass_a":
              return { error: "Pass A already completed before coordinator started. Use run_harmony_round to refine." };
            case "run_pass_b":
            case "rerun_pass_b": {
              const feedback = args.feedback as string | undefined;
              if (!feedback) {
                return { error: "Pass B already completed. Provide feedback to re-run, or use run_harmony_round to refine individual items." };
              }
              // Re-run Pass B with feedback by calling the same furnishing logic
              const passBRerunPrompt = `You are an interior designer revising the shopping list for the ${room.name}.

DESIGN BRIEF FROM PASS A:
${JSON.stringify({
  summary: (analysis as Record<string, unknown>).summary,
  design_direction: (analysis as Record<string, unknown>).design_direction,
  recommended_palette: (analysis as Record<string, unknown>).recommended_palette,
  recommended_materials: (analysis as Record<string, unknown>).recommended_materials,
  what_works: (analysis as Record<string, unknown>).what_works,
  what_should_go: (analysis as Record<string, unknown>).what_should_go,
}, null, 2)}

CURRENT ITEM LIST:
${JSON.stringify((analysis as Record<string, unknown>).what_it_needs, null, 2)}

REVISION FEEDBACK:
${feedback}

Produce a REVISED what_it_needs list that addresses the feedback. Keep items that are working well unchanged. Return JSON array of items with: category, search_title, description, priority, specs, placement.`;

              try {
                const rerunResp = await geminiProvider.chat({
                  model: selectModel("area_analysis"),
                  system: getSystemPrompt(profile),
                  messages: [{ role: "user", content: [{ type: "text", text: passBRerunPrompt }] }],
                  max_tokens: 32768,
                  seed: DETERMINISTIC_SEED,
                  responseMimeType: "application/json",
                });
                const rerunItems = extractJsonObject(rerunResp.content);
                const items = Array.isArray(rerunItems) ? rerunItems
                  : (rerunItems as Record<string, unknown>)?.what_it_needs;
                if (Array.isArray(items) && items.length > 0) {
                  (analysis as Record<string, unknown>).what_it_needs = items;
                  coordState.passBComplete = true;
                  return { success: true, itemCount: items.length, feedback };
                }
                return { error: "Re-run produced no items" };
              } catch (err) {
                return { error: `Pass B re-run failed: ${err instanceof Error ? err.message : "unknown"}` };
              }
            }
            case "run_enrichment":
              return { error: "Enrichment already completed before coordinator started." };
            case "finalize":
              return { reason: (args.reason as string) || "Coordinator finalized" };
            default:
              return { error: `Unknown tool: ${toolName}` };
          }
        },
        { roomName: room.name, roomType: room.room_type, budgetMode: budgetMode || undefined },
      );

      if (coordResult.success) {
        console.log(`[area-analysis] Design coordinator: ${coordResult.data?.reason || "finalized"} (${coordResult.tokensUsed || 0} tokens)`);
      }
    }

    // ── Post-harmony re-validation: re-enforce user constraints ──────
    // The harmony loop can revise/drop items in ways that violate user
    // exclusions, keep-item protections, or explicit requests. Re-run
    // the deterministic validator as a final gate before saving.
    if (parsedContext || allKeepItems.length > 0) {
      const postHarmonyValidation = await validateAreaAnalysisAsync(analysis, allKeepItems, room.user_context || undefined);
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
          const low = parseInt(priceMatch[1].replace(/,/g, ""), 10);
          const high = parseInt(priceMatch[2].replace(/,/g, ""), 10);
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
