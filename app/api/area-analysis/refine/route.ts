import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { createAgentRun, completeAgentRun } from "@/lib/db/agent-runs";
import type { AIContentBlock } from "@/lib/ai/provider";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { extractJsonObject } from "@/lib/ai/extract-json";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { room_id, project_id, user_feedback, previous_analysis } = await request.json();
  if (!room_id || !user_feedback) {
    return NextResponse.json({ error: "room_id and user_feedback required" }, { status: 400 });
  }

  // Load room with images
  const { data: room } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("id", room_id)
    .single();

  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Load project
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id || room.project_id)
    .single();

  // Load other rooms for cross-room awareness
  const { data: otherRooms } = await supabase
    .from("rooms")
    .select("name, room_type, room_diagnoses(diagnosis_json, design_direction_json)")
    .eq("project_id", project?.id || room.project_id)
    .neq("id", room_id);

  // Build content blocks
  const contentBlocks: AIContentBlock[] = [];

  // Building context
  if (project?.building_research) {
    const br = project.building_research as Record<string, unknown>;
    const floorPlan = br.floor_plan as Record<string, unknown> | undefined;
    const floorPlanSection = floorPlan
      ? `\nFloor Plan: ${floorPlan.total_sqft || "unknown"} sqft | Living/dining combined: ${floorPlan.living_dining_combined ?? "unknown"} | Kitchen: ${floorPlan.kitchen_style || "unknown"}
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

  // Room photos
  const userContextNote = room.user_context
    ? `\n\nUSER NOTES ABOUT PHOTOS: "${room.user_context}"`
    : "";

  contentBlocks.push({
    type: "text",
    text: `Focus area: ${room.name} (${room.room_type})${userContextNote}\n\nHere are the photos of this area:`,
  });

  for (const img of room.room_images || []) {
    contentBlocks.push({
      type: "image",
      source: { type: "url", url: img.image_url },
    });
  }

  // Extract keep/replace items for reinforcement
  const keepItems = room.keep_items as string[] | null;
  const keepItemsWarning = keepItems?.length
    ? `\n\n⚠️ ITEMS THE CLIENT WANTS TO KEEP — NON-NEGOTIABLE:\n${keepItems.map((item: string) => `- ${item}`).join("\n")}\nThese MUST appear in "what_works". NEVER put them in "what_should_go".`
    : "";

  // The refinement prompt — this is where the magic happens
  contentBlocks.push({
    type: "text",
    text: `--- PREVIOUS ANALYSIS ---
${JSON.stringify(previous_analysis, null, 2)}
---

--- CLIENT FEEDBACK ---
"${user_feedback}"
---${keepItemsWarning}

The client has reviewed your previous analysis and provided feedback above. As their personal interior designer, you need to:

1. **Understand their intent** — figure out what they're really asking for. If they say "keep the floor lamp," they want it to stay and the rest of the design should work around it.

2. **Assess the impact** — explain honestly how this feedback changes the design. Does keeping a particular item affect the palette? Does it limit options? Is it actually fine and works with the direction? Be specific and honest.

3. **Regenerate the full analysis** incorporating their feedback. Adjust what_it_needs, what_works, what_should_go, and design_direction accordingly.

4. **Write an impact summary** explaining what changed and why, so the client understands the design trade-offs.

Return JSON:
{
  "impact_summary": "2-4 sentences explaining what the client's feedback means for the design. Be specific about trade-offs. Example: 'Keeping the floor lamp works well — its warm brass finish complements the walnut direction. However, it means we should avoid another brass piece nearby to prevent the metallic feeling from dominating. I adjusted the side table recommendation from brass to wood.'",
  "changes_made": ["List of specific changes from the previous analysis, e.g. 'Moved floor lamp from should_go to what_works', 'Adjusted coffee table specs to complement existing lamp height'"],
  "summary": "2-3 sentence assessment of the current state of this area (updated)",
  "what_it_needs": [
    {
      "category": "snake_case category slug",
      "search_title": "Detailed product search query with material, color, size, style",
      "description": "Why this item is needed — updated to reflect client feedback",
      "priority": "high | medium | low",
      "specs": "Ideal dimensions, material, color range, price range",
      "placement": "WHERE in the room this item goes — be spatial and specific"
    }
  ],
  "what_works": ["Updated list — include items the client wants to keep"],
  "what_should_go": ["Updated list — remove items the client wants to keep"],
  "design_direction": "Updated paragraph reflecting the client's feedback",
  "recommended_palette": ["Updated list of 4-8 specific colors for this room"],
  "recommended_materials": ["Updated list of 4-6 materials to use"],
  "recommended_textures": ["Updated list of 3-5 textures to layer"],
  "spatial_layout": "Updated furniture arrangement strategy — traffic flow, zones, sightlines",
  "lighting_conditions": "Updated lighting assessment for the room",
  "window_door_positions": "Carry forward or update window/door positions",
  "outlet_positions": "Carry forward or update outlet positions"
}

CRITICAL RULES:
1. If the client says to KEEP something, it goes in "what_works" and NEVER in "what_should_go". Design around it. Make it shine. This is non-negotiable.
2. If the client says they like something or want something, honor that preference completely.
3. Only push back on a client preference if it creates a genuine, specific, measurable problem (e.g., "the 8-foot sofa physically won't fit in the 7-foot alcove") — and even then, offer alternatives, don't just reject.
4. Think like a designer who LISTENS to the client and adapts. Your ego about the "best" design direction is less important than the client's happiness.
5. Carry forward ALL spatial context (spatial_layout, lighting_conditions, window_door_positions, outlet_positions) from the previous analysis — update them only if the feedback requires changes. Do not drop these fields.
6. Every item in what_it_needs MUST include a "placement" field describing exactly where it goes in the room.`,
  });

  const agentRun = await createAgentRun(supabase, {
    room_id,
    agent_type: "area_analyzer",
    input_json: { room_type: room.room_type, refinement: true, feedback: user_feedback },
  });

  try {
    const profile = buildDesignProfile(project);
    const response = await geminiProvider.chat({
      model: selectModel("area_analysis"),
      system: getSystemPrompt(profile),
      messages: [{ role: "user", content: contentBlocks }],
      max_tokens: 12000,
      temperature: 0.3,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "medium" },
    });

    if (response.truncated) {
      throw new Error("AI response was truncated (MAX_TOKENS). The refinement response was too long.");
    }

    const analysis = extractJsonObject<Record<string, any>>(response.content);

    // Validate response structure
    if (Array.isArray(analysis)) {
      throw new Error(`AI returned an array instead of an object. This is a model output format error — retrying should fix it.`);
    }
    if (!analysis.what_it_needs || !Array.isArray(analysis.what_it_needs)) {
      throw new Error(`AI response missing required field "what_it_needs". Got keys: ${Object.keys(analysis).join(", ")}`);
    }

    // Extract refinement-specific fields
    const impactSummary = analysis.impact_summary;
    const changesMade = analysis.changes_made || [];

    // Save as new diagnosis (replaces the previous one in the timeline)
    await supabase.from("room_diagnoses").insert({
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

    // Update room keep_items and replace_items to reflect refined analysis
    const updatedKeepItems = analysis.what_works || [];
    const updatedReplaceItems = analysis.what_should_go || [];
    const roomUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updatedKeepItems.length > 0) roomUpdate.keep_items = updatedKeepItems;
    if (updatedReplaceItems.length > 0) roomUpdate.replace_items = updatedReplaceItems;

    if (Object.keys(roomUpdate).length > 1) {
      await supabase.from("rooms").update(roomUpdate).eq("id", room_id);
    }

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: { analysis, impact_summary: impactSummary, changes_made: changesMade },
      tokens_used: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
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
    return NextResponse.json({ error: `Refinement failed: ${errorMessage}` }, { status: 500 });
  }
}
