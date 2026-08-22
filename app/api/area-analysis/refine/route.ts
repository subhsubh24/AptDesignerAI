import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRoomOwnership } from "@/lib/auth/ownership";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { parseUserContextAsync, formatParsedContextForPrompt } from "@/lib/utils/parse-user-context";
import { validateAreaAnalysisAsync } from "@/lib/agents/area-analysis-validator";
import { semanticLookup, semanticStore } from "@/lib/ai/semantic-cache";
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import type { ExtractedFloorPlan } from "@/lib/types/database";

// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`area-refine:${user.id}`, RATE_LIMITS.areaAnalysisRefineFull);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many refinement requests. Please wait before retrying." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 300000) / 1000)) } },
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, user_feedback, previous_analysis } = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!room_id || !user_feedback) {
    return NextResponse.json({ error: "room_id and user_feedback required" }, { status: 400 });
  }

  // Ownership guard BEFORE the (paid) re-analysis: room_id is client-supplied and
  // the memory-store read is not user-scoped, so without this check any
  // authenticated caller could drive the LLM refinement on another user's room
  // (IDOR + LLM-cost abuse).
  const postOwnership = await requireRoomOwnership(supabase, room_id, user.id);
  if (postOwnership) return postOwnership;

  // Load room with images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Load project. Derive the project from the OWNED room (not a client-supplied
  // project_id) so the prompt can never be fed a different user's project.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", room.project_id)
    .single();

  // Load other rooms for cross-room awareness
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("name, room_type, room_diagnoses(diagnosis_json, design_direction_json)")
    .eq("project_id", project?.id || room.project_id)
    .neq("id", room_id)
    // .order() is required alongside .limit(): without one, Postgres/PostgREST
    // give no ordering guarantee and an unordered .limit() would silently
    // (and non-deterministically) drop an arbitrary subset of sibling rooms
    // once a project exceeds the cap — newest-first, matching the sibling
    // /api/area-analysis route's identical fetch.
    .order("created_at", { ascending: false })
    .limit(30);

  // Build content blocks
  const contentBlocks: AIContentBlock[] = [];

  // Building context + structured floor plan (image + extracted data)
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const floorPlan = br.floor_plan as Record<string, unknown> | undefined;
    const extractedFloorPlan = br.extracted_floor_plan as ExtractedFloorPlan | undefined;
    const floorPlanImageUrl = br.floor_plan_image_url as string | undefined;

    // Prefer the structured extractor output when available — it's more
    // detailed than the legacy building_research.floor_plan object.
    const structuredSection = extractedFloorPlan
      ? `\n\n${formatExtractedFloorPlanForPrompt(extractedFloorPlan, room.room_type)}`
      : floorPlan
        ? `\nFloor Plan: ${floorPlan.total_sqft || "unknown"} sqft | Living/dining combined: ${floorPlan.living_dining_combined ?? "unknown"} | Kitchen: ${floorPlan.kitchen_style || "unknown"}
Room dimensions: ${JSON.stringify(floorPlan.room_dimensions || {})}
Spatial features: ${Array.isArray(floorPlan.notable_spatial_features) ? floorPlan.notable_spatial_features.join(", ") : "unknown"}`
        : "";

    // Floor plan image goes in FIRST so Gemini anchors its spatial reasoning
    // to it before reading room photos.
    if (floorPlanImageUrl) {
      contentBlocks.push({
        type: "image",
        source: { type: "url", url: floorPlanImageUrl },
      });
    }

    contentBlocks.push({
      type: "text",
      text: `--- BUILDING CONTEXT ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout: ${br.layout_style || "unknown"} | Windows: ${br.windows || "unknown"} | Ceiling: ${br.ceiling_height || "unknown"}
Aesthetic: ${br.design_aesthetic || "unknown"}${structuredSection}
---`,
    });
  }

  // Apartment-level analysis for cross-room coherence
  if (project?.apartment_analysis) {
    const aa = project.apartment_analysis as Record<string, unknown>;
    contentBlocks.push({
      type: "text",
      text: `--- APARTMENT-LEVEL ANALYSIS ---
Overall: ${aa.overall || ""}
${JSON.stringify(aa.rooms || {}, null, 2)}
---
Use this apartment-level context to ensure cross-room coherence in your refinement.`,
    });
  }

  // Room preferences and constraints
  const preferencesLines: string[] = [];
  if (room.budget_mode) preferencesLines.push(`Budget mode: ${room.budget_mode}`);
  if (room.priorities?.length) preferencesLines.push(`Priorities: ${room.priorities.join(", ")}`);
  if (room.keep_items?.length) preferencesLines.push(`Items to keep: ${room.keep_items.join(", ")}`);
  if (room.replace_items?.length) preferencesLines.push(`Items to replace/remove: ${room.replace_items.join(", ")}`);

  if (preferencesLines.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `--- ROOM PREFERENCES & CONSTRAINTS ---\n${preferencesLines.join("\n")}\n---`,
    });
  }

  // Other rooms context for cross-room coherence
  if (otherRooms && otherRooms.length > 0) {
    const otherRoomsSummary = otherRooms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join result
      .map((r: any) => {
        const diag = r.room_diagnoses?.[r.room_diagnoses.length - 1];
        const djson = diag?.diagnosis_json as Record<string, unknown> | undefined;
        const dd = diag?.design_direction_json as Record<string, unknown> | undefined;
        const parts = [`- ${r.name} (${r.room_type})`];
        if (djson?.summary) parts.push(`  Summary: ${djson.summary}`);
        if (dd?.style_notes || djson?.design_direction) parts.push(`  Direction: ${dd?.style_notes || djson?.design_direction}`);
        if (dd?.recommended_palette) parts.push(`  Palette: ${(dd.recommended_palette as string[]).join(", ")}`);
        return parts.join("\n");
      })
      .join("\n");

    contentBlocks.push({
      type: "text",
      text: `--- OTHER ROOMS (for cross-room coherence) ---\n${otherRoomsSummary}\n---\nEnsure your refined recommendations stay cohesive with the rest of the apartment.`,
    });
  }

  // Extract keep/replace items for reinforcement
  const keepItems = room.keep_items as string[] | null;

  // Parse user context into structured constraints (exclusions, keep items, requests)
  const parsedContext = room.user_context ? await parseUserContextAsync(room.user_context) : null;
  const parsedContextBlock = parsedContext ? formatParsedContextForPrompt(parsedContext) : "";

  // Merge keep items from explicit list + parsed context
  const allKeepItems = [
    ...(keepItems || []),
    ...(parsedContext?.additionalKeepItems || []),
  ];

  // Room photos
  const userContextNote = room.user_context
    ? `\n\nUSER NOTES ABOUT PHOTOS: "${room.user_context}"`
    : "";

  contentBlocks.push({
    type: "text",
    text: `Focus area: ${room.name} (${room.room_type})${userContextNote}${parsedContextBlock ? `\n\n${parsedContextBlock}` : ""}\n\nHere are the photos of this area:`,
  });

  for (const img of room.room_images || []) {
    contentBlocks.push({
      type: "image",
      source: { type: "url", url: img.image_url },
    });
  }
  const keepItemsWarning = allKeepItems.length > 0
    ? `\n\n⚠️ ITEMS THE CLIENT WANTS TO KEEP — NON-NEGOTIABLE:\n${allKeepItems.map((item: string) => `- ${item}`).join("\n")}\nThese MUST appear in "what_works". NEVER put them in "what_should_go". Do NOT recommend buying a NEW version of these items — the client already has them and wants to keep them.`
    : "";

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, refinement: true, feedback: user_feedback },
  });

  try {
    const profile = buildDesignProfile(project);
    const model = selectModel("area_analysis");
    const system = getSystemPrompt(profile);

    /**
     * Pass A — INTERPRET FEEDBACK.
     * Text-only, no images. Focus: understand what the client is asking for,
     * which items/categories are affected, and what trade-offs the change
     * implies. Keeping this tight prevents misinterpretation from compounding
     * into the full regenerated analysis.
     */
    const interpretPrompt = `You are an interior designer reviewing a client's feedback on your previous analysis. This is PASS 1 of 2: interpret the feedback and identify what needs to change. Do NOT regenerate the full analysis yet — that's a separate pass.

--- PREVIOUS ANALYSIS (summary) ---
${JSON.stringify({
  summary: previous_analysis?.summary,
  what_it_needs: previous_analysis?.what_it_needs?.map((n: { category: string; search_title?: string }) => ({ category: n.category, search_title: n.search_title })),
  what_works: previous_analysis?.what_works,
  what_should_go: previous_analysis?.what_should_go,
  design_direction: previous_analysis?.design_direction,
  recommended_palette: previous_analysis?.recommended_palette,
  recommended_materials: previous_analysis?.recommended_materials,
}, null, 2)}
---

--- CLIENT FEEDBACK ---
"${user_feedback}"
---${keepItemsWarning}

## YOUR TASK
1. Restate the client's intent in your own words (1-2 sentences)
2. List each SPECIFIC change they're asking for (keep X, replace Y, change palette, etc.)
3. For each change, identify which categories in what_it_needs are affected
4. Call out any trade-offs or downstream implications (e.g., "keeping the brass lamp means the side table should be wood to avoid brass dominance")
5. Rate confidence in your interpretation (0-10) — if the feedback is ambiguous, say so

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "client_intent": "1-2 sentences restating what they want",
  "changes_requested": [
    { "type": "keep | replace | add | adjust_palette | adjust_style | other", "description": "specific change", "affected_categories": ["category slugs affected in what_it_needs"] }
  ],
  "tradeoffs": ["implications of the changes — e.g. 'keeping brass lamp means no brass side table'"],
  "confidence": 0-10
}`;

    // ─── Semantic cache lookup for Pass A (interpretation) ───────
    // Users iterate on the same room with tiny phrasing changes (e.g.,
    // "make it cozier" → "add more cozy") — we can skip the interpretation
    // call when a near-match already exists for this room. Off by default;
    // enable with ENABLE_SEMANTIC_CACHE=1. The cache is scoped per-room so
    // nothing leaks across users.
    const cacheNamespace = `refine-interpret:${room_id}`;
    const cached = await semanticLookup<{
      interpretation: Record<string, unknown>;
      tokens: number;
    }>(cacheNamespace, user_feedback);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    let interpretation: Record<string, any>;
    let interpretTokens: number;

    if (cached) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cached shape matches LLM shape
      interpretation = cached.value.interpretation as Record<string, any>;
      interpretTokens = 0;
    } else {
      const interpretResponse = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: [{ type: "text", text: interpretPrompt }] }],
        max_tokens: 64000,
        // No temperature override — Gemini 3 is optimized for its default (1.0).
        seed: DETERMINISTIC_SEED,
        responseMimeType: "application/json",
        // Feedback-interpretation pass — deliberately pinned below
        // area_analysis's registered "high" default; this reads a short
        // client note, not room understanding.
        thinkingConfig: thinkingFor("area_analysis", "low"),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
      interpretation = extractJsonObject<Record<string, any>>(interpretResponse.content);
      interpretTokens = (interpretResponse.usage?.input_tokens || 0) + (interpretResponse.usage?.output_tokens || 0);
      // Fire-and-forget store so we don't block the hot path on an embed call.
      void semanticStore(cacheNamespace, user_feedback, { interpretation, tokens: interpretTokens });
    }

    console.log(`[area-analysis/refine] Interpretation pass complete. Confidence: ${interpretation.confidence}/10, changes: ${interpretation.changes_requested?.length || 0}`);

    /**
     * Pass B — REGENERATE analysis.
     * Consumes Pass A's interpretation as an explicit constraint + the full
     * room context + images. The model's job here is narrower: apply the
     * interpretation, don't re-derive it.
     */
    contentBlocks.push({
      type: "text",
      text: `--- PREVIOUS ANALYSIS ---
${JSON.stringify(previous_analysis, null, 2)}
---

--- CLIENT FEEDBACK (raw) ---
"${user_feedback}"
---

--- PASS 1 INTERPRETATION (follow this, don't re-derive) ---
${JSON.stringify(interpretation, null, 2)}
---${keepItemsWarning}

This is PASS 2 of 2. Pass 1 already interpreted the client's intent — above. Your job now is to APPLY that interpretation to the previous analysis, regenerating the full structure with the requested changes.

## YOUR TASK
1. Walk through each \`changes_requested\` item from the interpretation and apply it to the analysis
2. Honor the \`tradeoffs\` — if Pass 1 flagged "no brass side table," make sure no brass side table appears
3. Write an impact_summary explaining what changed in human-friendly language
4. List changes_made — the specific edits made from the previous analysis

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "impact_summary": "2-4 sentences explaining what the client's feedback means for the design. Be specific about trade-offs.",
  "changes_made": ["List of specific changes from the previous analysis"],
  "summary": "2-3 sentence assessment of the current state of this area (updated)",
  "what_it_needs": [
    {
      "category": "snake_case category slug",
      "search_title": "Detailed product search query with material, color, size, style",
      "description": "Why this item is needed — updated to reflect client feedback",
      "priority": "high | medium | low",
      "specs": "Ideal dimensions, material, color range, price range",
      "placement": "WHERE in the room this item goes"
    }
  ],
  "what_works": ["Updated list — include items the client wants to keep"],
  "what_should_go": ["Updated list — remove items the client wants to keep"],
  "design_direction": "Updated paragraph reflecting the client's feedback",
  "recommended_palette": ["Updated list of 4-8 specific colors"],
  "recommended_materials": ["Updated list of 4-6 materials"],
  "recommended_textures": ["Updated list of 3-5 textures"],
  "spatial_layout": "Updated furniture arrangement strategy",
  "lighting_conditions": "Updated lighting assessment",
  "window_door_positions": "Carry forward or update",
  "outlet_positions": "Carry forward or update"
}

CRITICAL RULES:
1. If the client says to KEEP something, it goes in "what_works" and NEVER in "what_should_go".
2. Only push back on a client preference if it creates a specific measurable problem.
3. Carry forward ALL spatial context (spatial_layout, lighting_conditions, window_door_positions, outlet_positions). Update only if feedback requires.
4. Every item in what_it_needs MUST include a "placement" field.`,
    });

    const response = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 64000,
      // No temperature override — Gemini 3 is optimized for its default (1.0).
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      // Regeneration pass applies Pass A's interpretation rather than
      // re-deriving room understanding — deliberately pinned below
      // area_analysis's registered "high" default, same as Pass A above.
      thinkingConfig: thinkingFor("area_analysis", "low"),
    });

    if (response.truncated) {
      throw new Error("AI response was truncated (MAX_TOKENS). The refinement response was too long.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response is unstructured JSON
    const analysis = extractJsonObject<Record<string, any>>(response.content);

    // Validate response structure
    if (Array.isArray(analysis)) {
      throw new Error(`AI returned an array instead of an object. This is a model output format error — retrying should fix it.`);
    }
    if (!analysis.what_it_needs || !Array.isArray(analysis.what_it_needs)) {
      throw new Error(`AI response missing required field "what_it_needs". Got keys: ${Object.keys(analysis).join(", ")}`);
    }

    // Post-refinement validation: enforce user constraints
    // Catch cases where the LLM ignored exclusions, keep items, or explicit requests
    if (parsedContext || allKeepItems.length > 0) {
      const postValidation = await validateAreaAnalysisAsync(analysis, allKeepItems, room.user_context || undefined);
      if (postValidation.wasModified) {
        Object.assign(analysis, postValidation.patched);
        console.log(`[area-analysis/refine] Post-validation patched ${postValidation.issues.length} constraint violation(s):`,
          postValidation.issues.map(i => `${i.type}: ${i.description}`).join("; "));
      }
    }

    // Extract refinement-specific fields
    const impactSummary = analysis.impact_summary;
    const changesMade = analysis.changes_made || [];

    // Save as new diagnosis (replaces the previous one in the timeline)
    const { error: saveError } = await supabase.from("room_diagnoses").insert({
      room_id,
      diagnosis_json: analysis,
      design_direction_json: {
        style_notes: analysis.design_direction || "",
        recommended_palette: analysis.recommended_palette || [],
        recommended_materials: analysis.recommended_materials || [],
        recommended_textures: analysis.recommended_textures || [],
        recommended_furniture_types: analysis.what_it_needs.map((n: { category: string }) => n.category),
      },
      missing_categories: analysis.what_it_needs.map((n: { category: string }) => n.category),
      action_list: analysis.what_it_needs,
      model_used: selectModel("area_analysis"),
    });

    // supabase-js returns the error in-band, so an unchecked insert would return
    // a 200 while the refinement is lost — the user thinks their feedback saved
    // but it vanishes on reload. Surface the failure instead of faking success.
    if (saveError) {
      console.error("[area-analysis/refine] Failed to save refinement:", saveError.message);
      await completeAgentRun(supabase, agentRun.id, {
        status: "failed",
        error_message: `Failed to save refinement: ${saveError.message}`,
      });
      return NextResponse.json({ error: "Unable to save the refinement. Please try again." }, { status: 500 });
    }

    // Update room timestamp only — do NOT overwrite keep_items/replace_items
    // with AI output. The user's original selections are the source of truth;
    // overwriting them would cause cascading contradictions in future operations.
    const { error: roomError } = await supabase.from("rooms").update({ updated_at: new Date().toISOString() }).eq("id", room_id);
    if (roomError) console.error("[area-analysis/refine] Failed to update room timestamp:", roomError.message);

    const regenTokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { analysis, interpretation, impact_summary: impactSummary, changes_made: changesMade },
      tokens_used: interpretTokens + regenTokens,
    });

    return NextResponse.json({
      analysis,
      impact_summary: impactSummary,
      changes_made: changesMade,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[area-analysis/refine] Error:", errorMessage);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: "Refinement failed. Please try again." }, { status: 500 });
  }
}
