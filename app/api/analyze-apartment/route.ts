import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
import { formatExtractedFloorPlanForPrompt } from "@/lib/agents/format-floor-plan";
import { apiError, logServerError } from "@/lib/utils/api-error";
import { userOwnsProject } from "@/lib/auth/ownership";

// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

// There is no cap elsewhere on how many rooms a project can have, and this
// route both fans out one Gemini call per room and then persists results in a
// SERIAL loop (each write awaited before the next, by design — see the
// persistence loop below). With enough rooms the combined latency can exceed
// maxDuration, which fails the whole apartment analysis (wasting the LLM
// spend already incurred) rather than degrading gracefully. 20 comfortably
// covers a real apartment's rooms (bed/bath/living/dining/kitchen/office/
// etc.) while bounding worst-case latency and per-request spend.
const MAX_ROOMS_PER_ANALYSIS = 20;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Ownership guard: the project_id is client-supplied — without this check any
  // authenticated caller could read another user's rooms + diagnoses (IDOR).
  if (!(await userOwnsProject(supabase, projectId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load existing diagnoses and build summary. This is a plain array select
  // (no .single()), so Supabase returns `[]` for a genuine zero-room project
  // and `null` only on a real query error — `!rooms` therefore means "the
  // fetch failed," never "no rooms," and must not be reported as a 404.
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("*, room_diagnoses(*), room_images(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (!rooms) return apiError("analyze-apartment.rooms", roomsError ?? "Query returned no data");

  const summary = buildSummaryFromDiagnoses(rooms);
  return NextResponse.json({ summary });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`analyze-apartment:${user.id}`, RATE_LIMITS.analyzeApartment);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many analysis requests. Please wait before retrying." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 3600000) / 1000)) } },
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: { project_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { project_id } = body;
  if (!project_id) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  // Ownership guard BEFORE any expensive LLM work: the project_id is
  // client-supplied — without this check any authenticated caller could drive a
  // full apartment analysis on (and write diagnoses into) another user's project
  // (IDOR + LLM-cost abuse + cross-tenant data pollution).
  if (!(await userOwnsProject(supabase, project_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load project with building research. userOwnsProject already confirmed the
  // project exists moments ago, so a genuine PGRST116 miss here means it was
  // deleted in the race between that check and this fetch — same distinction
  // search.room draws below and every sibling GET route already makes. The
  // whole analysis depends on this row (buildDesignProfile, building-research
  // context below), so either way it can't be silently treated as absent.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .single();
  if (!project) {
    if (projectError && projectError.code !== "PGRST116") {
      return apiError("analyze-apartment.project", projectError);
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load all rooms with their images. Plain array select (no .single()), so a
  // real query error surfaces as `data: null`, distinct from a legitimately
  // empty (but existing) project — don't conflate the two into one 400.
  const { data: allRooms, error: allRoomsError } = await supabase
    .from("rooms")
    .select("*, room_images(*)")
    .eq("project_id", project_id)
    .order("created_at", { ascending: true });

  if (!allRooms) return apiError("analyze-apartment.allRooms", allRoomsError ?? "Query returned no data");
  if (allRooms.length === 0) {
    return NextResponse.json({ error: "No rooms found" }, { status: 400 });
  }

  if (allRooms.length > MAX_ROOMS_PER_ANALYSIS) {
    console.warn(
      `[analyze-apartment] project ${project_id} has ${allRooms.length} rooms, ` +
        `capping analysis to the oldest ${MAX_ROOMS_PER_ANALYSIS}`,
    );
  }
  const rooms = allRooms.length > MAX_ROOMS_PER_ANALYSIS
    ? allRooms.slice(0, MAX_ROOMS_PER_ANALYSIS)
    : allRooms;

  // Building research context (reused by every per-room call)
  const buildingResearchObj = project?.building_research as Record<string, unknown> | undefined;
  const extractedFloorPlan = buildingResearchObj?.extracted_floor_plan as
    | import("@/lib/types/database").ExtractedFloorPlan
    | undefined;
  const floorPlanImageUrl = buildingResearchObj?.floor_plan_image_url as string | undefined;

  const buildingContextText = buildingResearchObj
    ? (() => {
        const br = buildingResearchObj;
        return `\n--- BUILDING RESEARCH (from the building's website) ---
Building style: ${br.building_style || "unknown"}
Finishes: ${JSON.stringify(br.finishes || {})}
Layout style: ${br.layout_style || "unknown"}
Windows: ${br.windows || "unknown"}
Ceiling height: ${br.ceiling_height || "unknown"}
Design aesthetic: ${br.design_aesthetic || "unknown"}
Summary: ${br.summary || ""}
---`;
      })()
    : "";

  const firstRoom = rooms[0];
  const agentRun = await createAgentRun(supabase, {
    room_id: firstRoom.id,
    agent_type: "apartment_analyzer",
    input_json: { project_id, room_count: rooms.length },
  });

  try {
    const profile = buildDesignProfile(project);
    const model = selectModel("apartment_analysis");
    const system = getSystemPrompt(profile);

    /**
     * Per-room analysis — one focused call per room with just that room's
     * photos. Previously all N rooms shared one 8K call, which only gave
     * ~1-1.5K tokens per room of attention. Running in parallel with
     * Promise.all so total latency ≈ max(per-room) + synthesis.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rooms is from Supabase untyped
    const analyzeRoom = async (room: any): Promise<{
      room_type: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
      analysis: Record<string, any> | null;
      tokensUsed: number;
    }> => {
      const images = room.room_images || [];
      if (images.length === 0) return { room_type: room.room_type, analysis: null, tokensUsed: 0 };

      const userNote = room.user_context
        ? `\nUSER NOTES: "${room.user_context}" — Respect these notes (e.g. if they say to ignore something, don't include it).`
        : "";

      const roomContent: AIContentBlock[] = [];

      // Floor plan image first — authoritative spatial ground truth.
      if (floorPlanImageUrl) {
        roomContent.push({
          type: "text",
          text: "--- FLOOR PLAN (authoritative layout reference for the entire apartment) ---",
        });
        roomContent.push({
          type: "image",
          source: { type: "url", url: floorPlanImageUrl },
        });
      }

      roomContent.push({
        type: "text",
        text: `Here are photos of the ${room.name} (${room.room_type}):${userNote}`,
      });
      for (const img of images as { image_url: string }[]) {
        roomContent.push({
          type: "image",
          source: { type: "url", url: img.image_url },
        });
      }

      if (buildingContextText) {
        roomContent.push({ type: "text", text: buildingContextText });
      }

      if (extractedFloorPlan) {
        roomContent.push({
          type: "text",
          text: formatExtractedFloorPlanForPrompt(extractedFloorPlan, room.room_type),
        });
      }

      roomContent.push({
        type: "text",
        text: `Analyze this ${room.room_type} in detail. ${buildingContextText ? "Use the building research context to understand the apartment's finishes and architectural style." : ""}

PROCESS:
Step 1: Examine EVERY photo carefully. For each photo, catalog everything you see:
  - Built-in: floor material+color, wall color+finish, ceiling fixtures, windows, countertops, cabinetry
  - Furniture: sofas, chairs, tables, shelves, desks, beds, dressers — name each with material + color
  - Lighting: floor lamps, table lamps, pendant lights, sconces — every light source
  - Decor/misc: rugs, plants, art, books, yoga mats, electronics, storage items
  Even a single bookshelf or floor lamp counts. List EVERYTHING visible, no matter how minor.
Step 2: For each item from Step 1, decide keep or replace. Every visible item must appear in either keep OR replace.
Step 3: Identify what's missing and build the "add" list.

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "summary": "1-2 sentence assessment of this room — reference specific items you see",
  "score": 1-10 current design score,
  "keep": ["Every visible item that should STAY — named with material+color+why it works"],
  "replace": ["Every visible item to REPLACE — what you see, why, what would be better"],
  "add": ["Items to ADD: [Material] [item type] in [color/finish], [size], [purpose]"],
  "priority": 1-10 how urgently this room needs attention
}

CRITICAL RULES:
- EVERY visible item from Step 1 MUST appear in either "keep" or "replace" — none can be omitted.
- Built-in elements count: flooring, walls, windows, countertops, cabinetry, ceiling lights.
- Even in a sparsely furnished room, there are ALWAYS built-ins to list (at minimum: flooring, wall color, windows, ceiling light fixtures).
- NEVER say "None" for keep — every room has flooring, walls, and windows at minimum.
- Do NOT invent furniture that isn't visible. But DO list every item you CAN see, even small ones (a single lamp, a bookshelf, a yoga mat).
- If a room area isn't visible in photos, say so — don't guess what's there.

FORMAT RULES:
- keep: "Warm-toned LVP flooring — good neutral base for layering" ✓
- keep: "Black arc floor lamp — adds height and sculptural interest" ✓
- replace: "Builder-grade boob light on ceiling — swap for a modern flush-mount" ✓
- add: "Large 8x10 textured wool area rug in warm ivory, to ground the seating area" ✓ | "Area rug" ✗

Include at LEAST 6-10 items in "add". A well-designed room needs soft furnishings (pillows, blankets), lighting (multiple sources), and decorative elements (art, plants, vases).`,
      });

      const response = await geminiProvider.chat({
        model,
        system,
        messages: [{ role: "user", content: roomContent }],
        // High thinking needs a generous output budget — the model consumes
        // thinking tokens before emitting the JSON, and "high" can burn a lot.
        max_tokens: 64000,
        // No temperature override — Gemini 3 is optimized for its default (1.0).
        seed: DETERMINISTIC_SEED,
        responseMimeType: "application/json",
        thinkingConfig: thinkingFor("apartment_analysis"),
      });

      // Defensive parse: if the model returned empty/whitespace content
      // (truncation, safety filter, or thinking exhaustion), return null
      // for this room so the rest of the apartment still gets analyzed.
      const trimmed = (response.content || "").trim();
      if (!trimmed) {
        console.warn(
          `[analyze-apartment] Empty response for room "${room.room_type}" — skipping. ` +
            `truncated=${response.truncated}, tokens=${JSON.stringify(response.usage)}`,
        );
        return {
          room_type: room.room_type,
          analysis: null,
          tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        };
      }

      let parsed: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        parsed = extractJsonObject<Record<string, any>>(trimmed);
      } catch (err) {
        console.warn(
          `[analyze-apartment] JSON parse failed for room "${room.room_type}": ${err instanceof Error ? err.message : String(err)}. ` +
            `Content preview: ${trimmed.slice(0, 200)}`,
        );
        return {
          room_type: room.room_type,
          analysis: null,
          tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        };
      }
      return {
        room_type: room.room_type,
        analysis: parsed,
        tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are untyped
    const roomResults = await Promise.all(rooms.map((r: any) => analyzeRoom(r)));

    console.log(
      `[analyze-apartment] Per-room pass complete: ${roomResults.filter((r) => r.analysis).length}/${rooms.length} rooms analyzed`,
    );

    // Build rooms map (normalized + original keys for downstream lookup)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    const analysisRooms: Record<string, any> = {};
    for (const res of roomResults) {
      if (res.analysis) analysisRooms[res.room_type] = res.analysis;
    }

    /**
     * Apartment synthesis — one small call that consumes the per-room
     * summaries (as text, not images) and produces the holistic "overall"
     * narrative identifying the apartment's aesthetic thread and coherence
     * checks across rooms.
     */
    const synthInput = rooms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase rows are untyped
      .map((r: any, i: number) => {
        // Index-align with roomResults (Promise.all preserves input order), NOT
        // the room_type-keyed analysisRooms map — that map collapses duplicate
        // room types (e.g. two bedrooms), so all but the LAST same-type room
        // would feed the wrong room's summary into the apartment narrative,
        // corrupting the cross-room coherence synthesis. Mirrors the persistence
        // loop below, which is already index-aligned for the same reason.
        const a = roomResults[i]?.analysis;
        if (!a) return `## ${r.name} (${r.room_type})\n(no analysis)`;
        return `## ${r.name} (${r.room_type})\nSummary: ${a.summary || ""}\nScore: ${a.score || "?"}/10\nKeep: ${firstArray(a.keep).join("; ")}\nReplace: ${firstArray(a.replace).join("; ")}\nAdd: ${firstArray(a.add).join("; ")}`;
      })
      .join("\n\n");

    const synthPrompt = `You have detailed per-room analyses of an apartment (below). Your only job is to synthesize a short overall narrative capturing:
1. The apartment's current state and overall vibe
2. The aesthetic thread (or lack thereof) across rooms — shared materials, palette, style
3. Any coherence issues (conflicting palettes, material jumps, zones that don't talk to each other)

${buildingContextText}

## PER-ROOM ANALYSES
${synthInput}

## OUTPUT FORMAT (JSON only — no prose, no markdown fences)
{
  "overall": "2-3 sentence personalized summary of the apartment — current state, what's working, aesthetic thread. Only reference things mentioned in the per-room analyses; do NOT invent."
}`;

    const synthResponse = await geminiProvider.chat({
      model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: synthPrompt }] }],
      max_tokens: 64000,
      // No temperature override — Gemini 3 is optimized for its default (1.0).
      seed: DETERMINISTIC_SEED,
      responseMimeType: "application/json",
      thinkingConfig: thinkingFor("apartment_analysis"),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
    let synthParsed: Record<string, any> = { overall: "" };
    const synthTrimmed = (synthResponse.content || "").trim();
    if (synthTrimmed) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM response shape
        synthParsed = extractJsonObject<Record<string, any>>(synthTrimmed);
      } catch (err) {
        console.warn(
          `[analyze-apartment] Synthesis JSON parse failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Content preview: ${synthTrimmed.slice(0, 200)}`,
        );
      }
    } else {
      console.warn(
        `[analyze-apartment] Empty synthesis response — using empty overall. ` +
          `truncated=${synthResponse.truncated}, tokens=${JSON.stringify(synthResponse.usage)}`,
      );
    }
    const synthTokens = (synthResponse.usage?.input_tokens || 0) + (synthResponse.usage?.output_tokens || 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merged LLM response shape
    const analysis: Record<string, any> = {
      overall: synthParsed.overall || "",
      rooms: analysisRooms,
    };

    console.log(
      `[analyze-apartment] Synthesis pass complete. Total tokens: ${roomResults.reduce((s, r) => s + r.tokensUsed, 0) + synthTokens}`,
    );

    // Persist each room's OWN diagnosis. roomResults is index-aligned with rooms
    // (Promise.all preserves input order), so roomResults[i] holds the analysis
    // produced for rooms[i]. This MUST NOT be looked up via a room_type-keyed
    // map: an apartment with two rooms of the same type (e.g. two bedrooms)
    // collapses in that map, so both rooms would be saved the LAST same-type
    // room's analysis — persisting the wrong keep/replace/add recommendations
    // for the other. (analysisRooms stays room_type-keyed for the coarse
    // apartment-level overview only.)
    let roomsToPersist = 0;
    let roomsPersisted = 0;

    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const roomAnalysis = roomResults[i]?.analysis;
      if (!roomAnalysis) continue;
      roomsToPersist++;

      // Persist the diagnosis first, then only flip the room to "diagnosed"
      // once it actually landed. The old Promise.all ran both writes
      // concurrently and ignored their errors, so a failed insert still left
      // the room marked "diagnosed" with no diagnosis behind it — orphaning the
      // status and silently dropping that room's analysis from the apartment run.
      const { error: diagInsertError } = await supabase.from("room_diagnoses").insert({
        room_id: room.id,
        diagnosis_json: roomAnalysis,
        design_direction_json: { overall: analysis.overall },
        missing_categories: firstArray(roomAnalysis.add, roomAnalysis.needs),
        action_list: firstArray(roomAnalysis.replace, roomAnalysis.weaknesses),
        model_used: model,
      });
      if (diagInsertError) {
        logServerError("analyze-apartment room_diagnoses insert", diagInsertError);
        continue;
      }
      roomsPersisted++;
      const { error: roomStatusError } = await supabase
        .from("rooms")
        .update({ status: "diagnosed" })
        .eq("id", room.id);
      if (roomStatusError) {
        logServerError("analyze-apartment room status update", roomStatusError);
      }
    }

    const { error: projectUpdateError } = await supabase
      .from("projects")
      .update({ apartment_analysis: analysis })
      .eq("id", project_id);
    if (projectUpdateError) {
      logServerError("analyze-apartment projects update", projectUpdateError);
    }

    const totalTokens = roomResults.reduce((s, r) => s + r.tokensUsed, 0) + synthTokens;

    // SIDE-EFFECT INTEGRITY: a 200 here is not cosmetic. The dashboard treats it
    // as success — it fires `analysis_complete` and advances the user to room
    // selection (app/dashboard/page.tsx:374-379), a step that depends on the
    // per-room diagnosis rows this loop writes. With zero rows written we would
    // be walking the user into a flow whose data does not exist, having told
    // them it worked.
    //
    // The trigger is `roomsPersisted === 0`, NOT "an insert was attempted and
    // failed". Both roads lead to the same empty result: the inserts can all
    // fail, or every per-room analysis can come back null (an empty model
    // response, a parse failure, a safety block) so nothing is ever attempted —
    // and that second road is not hypothetical, the `firstArray` note below
    // records a shape bug that took out every room in an apartment at once.
    // Gating on the attempt count would have caught only the first.
    //
    // Individual room failures stay non-fatal on purpose: persisting 4 of 5
    // rooms is a better outcome than discarding all five, the partial result is
    // real, and an unpersisted room self-heals when opened. Note the
    // project-level `apartment_analysis` write above is independent and may well
    // have succeeded — what is missing is the room-level rows the next screen
    // actually reads.
    if (rooms.length > 0 && roomsPersisted === 0) {
      const message =
        roomsToPersist === 0
          ? `apartment analysis produced no per-room result to save (0 of ${rooms.length} rooms analyzed)`
          : `apartment analysis completed but no room diagnosis could be saved (0 of ${roomsToPersist})`;
      logServerError("analyze-apartment persistence", new Error(message));
      await completeAgentRun(supabase, agentRun.id, {
        status: "failed",
        error_message: message,
        tokens_used: totalTokens,
      });
      return NextResponse.json(
        { error: "We analyzed your apartment but couldn't save the results. Please try again." },
        { status: 500 },
      );
    }

    await completeAgentRun(supabase, agentRun.id, {
      status: "completed",
      output_json: analysis,
      tokens_used: totalTokens,
    });

    return NextResponse.json({
      summary: analysis,
      // Surfaces the MAX_ROOMS_PER_ANALYSIS cap to the caller — without this a
      // project with more rooms than the cap would get a silent, indistinguishable-
      // from-full-success partial analysis every time it's re-run (the cap always
      // re-selects the same oldest rooms, so no client-visible signal here means no
      // way for the user to ever learn some rooms were skipped).
      rooms_analyzed: rooms.length,
      rooms_total: allRooms.length,
      rooms_truncated: allRooms.length > rooms.length,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze-apartment] Error:", errorMessage, err);
    await completeAgentRun(supabase, agentRun.id, {
      status: "failed",
      error_message: errorMessage,
    });
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}

/**
 * First argument that is genuinely an array, else `[]`.
 *
 * The per-room analysis is raw `extractJsonObject` output — parsed JSON with NO
 * schema validation — so `keep`/`replace`/`add`/`needs`/`weaknesses` are entirely
 * model-controlled and can come back as an object or a string. `x || []` does not
 * guard a TRUTHY non-array, which broke two things on the paid apartment path:
 *
 *  - the synthesis prompt called `.join()` on it → uncaught TypeError → 500,
 *    orphaning the whole agent run for every room in the apartment;
 *  - the `room_diagnoses` insert stored the non-array verbatim into the
 *    `action_list` / `missing_categories` JSONB columns, so the diagnosis page
 *    and the mockups placement map later iterated a non-iterable.
 *
 * Behaviour is identical to `a || b || []` for well-formed arrays; a non-array
 * degrades to empty (that room contributes no keep/replace/add) instead of
 * failing the request.
 */
function firstArray(...candidates: unknown[]): unknown[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function buildSummaryFromDiagnoses(rooms: Array<{
  room_type: string;
  room_diagnoses: Array<{ diagnosis_json: Record<string, unknown>; design_direction_json: Record<string, unknown> | null }>;
}>) {
  const result: {
    overall: string;
    rooms: Record<string, unknown>;
  } = {
    overall: "",
    rooms: {},
  };

  for (const room of rooms) {
    const latestDiagnosis = room.room_diagnoses?.[room.room_diagnoses.length - 1];
    if (!latestDiagnosis) continue;

    if (!result.overall && latestDiagnosis.design_direction_json) {
      result.overall = (latestDiagnosis.design_direction_json as { overall?: string }).overall || "";
    }

    result.rooms[room.room_type] = latestDiagnosis.diagnosis_json;
  }

  return result;
}
