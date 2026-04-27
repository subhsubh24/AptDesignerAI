import crypto from "crypto";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { resolveImageBlock } from "@/lib/ai/resolve-image";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getDiagnosisAnalysisPrompt, getDiagnosisPlanPrompt } from "@/lib/prompts/diagnosis";
import { fetchDiagnosisExamples, formatExamplesForPrompt } from "@/lib/db/diagnosis-examples";
import {
  DiagnosisAnalysisResponseSchema,
  DiagnosisPlanResponseSchema,
} from "@/lib/types/schemas";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { selfConsistent } from "./self-consistency";
import { classifyStyleLabelLLM } from "@/lib/ai/semantic-extract";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentContext, AgentResult } from "./types";
import type { DiagnosisData, DesignDirection, ActionItem } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("room-diagnostician");

/**
 * Extract a rough style-direction label from the free-text style_notes +
 * materials so the few-shot fetcher can pull examples from the matching
 * direction bucket (see DIRECTION_BUCKETS in lib/db/diagnosis-examples.ts).
 *
 * Priority order:
 *   1. Explicit named styles in style_notes (e.g. "mid-century modern", "japandi")
 *   2. Material-driven heuristics (rattan + linen → coastal; walnut + brass → modern)
 *
 * Returns null when no confident label matches — the fetcher will fall back
 * to same-room_type-any-direction examples.
 */
async function inferStyleLabel(direction: DesignDirection): Promise<string | null> {
  const notes = direction.style_notes ?? "";
  const materials = direction.recommended_materials ?? [];

  // LLM classification — catches paraphrases ("warm minimalist with mid-century
  // influence") and material-driven inferences the regex can't make.
  const llm = await classifyStyleLabelLLM(notes, materials).catch(() => null);
  if (llm) return llm;

  // Regex fallback for the deterministic path.
  const haystack = `${notes} ${materials.join(" ")}`.toLowerCase();
  const namedStyles: Array<[string, RegExp]> = [
    ["Japandi", /\bjapandi\b/],
    ["Scandinavian", /\bscandi(navian)?\b/],
    ["Minimalist", /\bminimalis[tm]\b/],
    ["Mid-Century Modern", /\bmid[-\s]?century\b/],
    ["Contemporary", /\bcontemporary\b/],
    ["Modern", /\bmodern\b/],
    ["Transitional", /\btransitional\b/],
    ["Coastal", /\bcoastal\b/],
    ["Farmhouse", /\bfarmhouse\b/],
    ["Bohemian Coastal", /\bboho coastal\b|\bbohemian coastal\b/],
    ["Bohemian", /\bboho\b|\bbohemian\b/],
    ["Maximalist", /\bmaximalis[tm]\b/],
    ["Eclectic", /\beclectic\b/],
    ["Traditional", /\btraditional\b/],
    ["Classic", /\bclassic\b/],
    ["Art Deco", /\bart[-\s]?deco\b/],
  ];
  for (const [label, rx] of namedStyles) {
    if (rx.test(haystack)) return label;
  }
  const hasRattan = /\brattan\b|\bwicker\b/.test(haystack);
  const hasLinen = /\blinen\b/.test(haystack);
  const hasWhiteWashed = /\bwhite[-\s]?washed\b/.test(haystack);
  if (hasRattan && (hasLinen || hasWhiteWashed)) return "Coastal";
  return null;
}

export interface DiagnosisResult {
  diagnosis: DiagnosisData;
  design_direction: DesignDirection;
  missing_categories: string[];
  action_list: ActionItem[];
}

/**
 * Two-pass room diagnosis:
 *   1. Analysis — vision-heavy observation + problem ID + design direction
 *   2. Plan — text-reasoning synthesis of missing_categories + action_list
 *
 * Splitting prevents the plan from being truncated when the analysis takes
 * most of the token budget, and gives each job the model's full attention.
 */
export async function runRoomDiagnosis(ctx: AgentContext, profile?: DynamicDesignProfile): Promise<AgentResult<DiagnosisResult>> {
  const model = selectModel("diagnosis");
  const system = getSystemPrompt(profile);

  // ─── Pass 1: Analysis (vision + design direction) ───────────
  const analysisPrompt = getDiagnosisAnalysisPrompt(
    ctx.roomType,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities,
    ctx.userContext,
    ctx.otherRoomsContext,
    profile,
  );

  // Cacheable visual blocks (floor plan + room photos) — stable across all N
  // self-consistency samples. Hoisted into `cacheScope` so Gemini re-tokenizes
  // them at the cheaper cached rate instead of paying full input cost N times.
  const cacheableBlocks: AIContentBlock[] = [];

  if (ctx.floorPlanImageUrl) {
    cacheableBlocks.push({
      type: "text",
      text: "AUTHORITATIVE FLOOR PLAN — exact dimensions, wall features (windows/doors/built-ins), and building orientation. Use this as the ground truth for all spatial facts. Do not infer or contradict any dimension readable from this plan.",
    });
    cacheableBlocks.push(await resolveImageBlock(ctx.floorPlanImageUrl, { preferFilesApi: true }));
  }

  for (const url of ctx.imageUrls) {
    cacheableBlocks.push(await resolveImageBlock(url, { preferFilesApi: true }));
  }

  const roomSessionKey = crypto
    .createHash("sha256")
    .update(`diag|${ctx.roomType}|${ctx.imageUrls.join("|")}`)
    .digest("hex")
    .slice(0, 16);

  const analysisContent: AIContentBlock[] = [
    { type: "text", text: analysisPrompt },
  ];

  let analysisTokens = 0;
  let analysisModel = model;
  let analysis: { diagnosis: DiagnosisData; design_direction: DesignDirection };

  // ─── Self-consistency: sample N candidate analyses in parallel, then pick
  // the most coherent one via a separate judge call. This is the single
  // highest-variance commitment point in the pipeline — palette / materials /
  // style_notes chosen here are consumed unchanged by Pass B (plan) and every
  // downstream product search. Reduces Pass A variance at the cost of N×
  // the Pass A call count (default N=3, configurable via SELF_CONSISTENCY_N).
  {
    type Sample = {
      parsed: { diagnosis: DiagnosisData; design_direction: DesignDirection };
      tokens: number;
      model: string;
    };

    const generateSample = async (seed: number, sampleIndex: number): Promise<Sample | null> => {
      let lastError: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const retryContent = attempt > 0 && lastError
            ? [...analysisContent, { type: "text" as const, text: `\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified.` }]
            : analysisContent;

          const response = await geminiProvider.chat({
            model,
            system,
            messages: [{ role: "user", content: retryContent }],
            max_tokens: 16000,
            seed,
            responseMimeType: "application/json",
            mediaResolution: "ultra_high",
            cacheScope: cacheableBlocks.length > 0
              ? { sessionKey: roomSessionKey, content: cacheableBlocks }
              : undefined,
            tools: [
              { googleSearch: {} as Record<string, never> },
              { codeExecution: {} as Record<string, never> },
            ],
          });

          const raw = extractJsonObject(response.content);
          const validated = DiagnosisAnalysisResponseSchema.parse(raw);
          return {
            parsed: {
              diagnosis: validated.diagnosis as DiagnosisData,
              design_direction: validated.design_direction as DesignDirection,
            },
            tokens: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
            model: response.model,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Diagnosis analysis failed";
          if (attempt === 0) {
            log.warn("Diagnosis analysis attempt 1 failed", { sampleIndex, error: lastError });
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
        }
      }
      return null;
    };

    // Judge: pick the most coherent candidate. Uses a different prompt framing
    // than the generator to mitigate self-confirmation bias — it never re-
    // evaluates the room; it only compares the candidate analyses against each
    // other on coherence / concreteness / actionability.
    const judgeAnalyses = async (candidates: Sample[]): Promise<number> => {
      const judgeModel = selectModel("diagnosis");
      const summaries = candidates.map((c, i) => {
        const d = c.parsed.diagnosis;
        const dd = c.parsed.design_direction;
        return [
          `=== CANDIDATE ${i} ===`,
          `Vibe summary: ${d.current_vibe_summary ?? ""}`,
          `What works (${d.what_is_working?.length ?? 0}): ${(d.what_is_working ?? []).slice(0, 4).join("; ")}`,
          `What doesn't work (${d.what_is_not_working?.length ?? 0}): ${(d.what_is_not_working ?? []).slice(0, 4).join("; ")}`,
          `Missing categories (${d.missing_furniture_categories?.length ?? 0}): ${(d.missing_furniture_categories ?? []).slice(0, 8).join(", ")}`,
          `Style notes: ${dd.style_notes ?? ""}`,
          `Palette (${dd.recommended_palette?.length ?? 0}): ${(dd.recommended_palette ?? []).join(", ")}`,
          `Materials (${dd.recommended_materials?.length ?? 0}): ${(dd.recommended_materials ?? []).join(", ")}`,
          `Textures: ${(dd.recommended_textures ?? []).join(", ")}`,
        ].join("\n");
      }).join("\n\n");

      const judgePrompt = `You are a senior design critic comparing ${candidates.length} candidate analyses of the same room. Pick the ONE most useful candidate for driving a shopping list.

Evaluation criteria (in order):
1. **Photographic accuracy** — the winning candidate's observations (floor color, wall color, existing furniture, lighting direction) must match what is visibly in the room photos. Hallucinated specificity (e.g., "warm walnut floors" when the room has grey LVP) is DISQUALIFYING, even if the prose reads well. A plain-but-correct candidate beats a fluent-but-wrong one.
2. **Palette–material–style coherence** — do the recommended colors, materials, textures, and style_notes describe a single consistent direction? A candidate that says "mid-century modern" with brass + walnut beats one that says "mid-century" with chrome + lacquer.
3. **Concreteness** — specific colors ("warm walnut brown", "sage green") beat vague colors ("neutral tones"). Specific materials ("boucle", "solid oak") beat categories ("fabric", "wood").
4. **Diagnostic honesty** — the "what doesn't work" list should name specific items, not platitudes. A candidate that says "sofa scale is off — it's swallowing the 12ft wall" beats "room feels crowded".
5. **Missing-category completeness** — does it name enough categories (8+) across essential/standard/finishing tiers to support a full shopping list?

${summaries}

Return ONLY a JSON object: {"best_index": <integer 0 to ${candidates.length - 1}>, "reason": "<one sentence>"}`;

      try {
        // Feed the judge the actual room images (via cacheScope so token cost
        // is amortized). Without images the judge rewards fluent specificity
        // over ACCURATE observation — hallucinated "warm walnut floors" in a
        // room with grey LVP can beat a correct candidate because it reads
        // better. Grounding on photos forces the judge to prefer accuracy.
        const resp = await geminiProvider.chat({
          model: judgeModel,
          system: getSystemPrompt(),
          messages: [{ role: "user", content: [{ type: "text", text: judgePrompt }] }],
          max_tokens: 8000,
          seed: DETERMINISTIC_SEED,
          cacheScope: cacheableBlocks.length > 0
            ? { sessionKey: roomSessionKey, content: cacheableBlocks }
            : undefined,
          tools: [
            { codeExecution: {} as Record<string, never> },
          ],
        });
        const parsed = extractJsonObject(resp.content) as { best_index?: number; reason?: string };
        const idx = typeof parsed?.best_index === "number" ? parsed.best_index : 0;
        log.info("Diagnosis Pass A judge chose candidate", {
          chosen: idx,
          reason: parsed?.reason,
          candidates: candidates.length,
        });
        return idx;
      } catch (err) {
        log.warn("Diagnosis Pass A judge call failed — defaulting to sample 0", { error: String(err) });
        return 0;
      }
    };

    try {
      const selection = await selfConsistent<Sample>({
        generate: generateSample,
        judge: judgeAnalyses,
        label: "diagnosis.passA",
      });
      analysis = selection.chosen.parsed;
      // Sum tokens across every surviving sample (generation cost is N×, not 1×)
      analysisTokens = selection.candidates.reduce((sum, c) => sum + c.tokens, 0);
      analysisModel = selection.chosen.model;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Diagnosis analysis failed after retries";
      return { success: false, error: msg };
    }

  }

  log.info("Diagnosis analysis pass complete", {
    roomType: ctx.roomType,
    tokens: { total: analysisTokens },
    whatIsWorking: analysis.diagnosis.what_is_working?.length ?? 0,
    whatIsNotWorking: analysis.diagnosis.what_is_not_working?.length ?? 0,
    missingInDiagnosis: analysis.diagnosis.missing_furniture_categories?.length ?? 0,
  });

  // ─── Room type verification ────────────────────────────────
  // The model's inferred room_type_confirmation is authoritative here — we
  // surface mismatches so the caller (and the user) notice before downstream
  // passes spend tokens designing the wrong room.
  const rtc = analysis.diagnosis.room_type_confirmation;
  if (rtc && (!rtc.matches_declared || rtc.confidence === "low")) {
    log.warn("Room type mismatch or low-confidence room detection", {
      roomId: ctx.roomId,
      declared: ctx.roomType,
      inferred: rtc.inferred_room_type,
      confidence: rtc.confidence,
      note: rtc.note,
    });
  }
  // Hard gate: if the model is HIGH-confidence that the declared room type is
  // wrong (e.g. declared=kitchen but photos clearly show a bedroom), bail
  // before Pass 2. Continuing would produce a specific-but-wrong action list
  // for the user-declared room type, costing tokens and confusing the user.
  // We keep the generated Pass-A analysis on the result so the caller can
  // surface the mismatch (inferred type, reason) without re-running.
  if (
    rtc
    && rtc.matches_declared === false
    && rtc.confidence === "high"
    && rtc.inferred_room_type
    && rtc.inferred_room_type !== ctx.roomType
  ) {
    return {
      success: false,
      error: `Room type mismatch: photos look like "${rtc.inferred_room_type}" but this room is labeled "${ctx.roomType}".${rtc.note ? ` ${rtc.note}` : ""} Confirm the room type before running diagnosis.`,
    };
  }

  // ─── Pass 2: Plan (consumes Pass 1's analysis as text) ──────
  const analysisJson = JSON.stringify(analysis, null, 2);

  // Fetch DB-backed few-shot examples: top-N past action_lists from
  // diagnoses of the same room_type. Real accepted outputs calibrate
  // specificity and category coverage better than synthetic examples.
  // D11: Extract a rough style label from Pass A's style_notes + materials so
  //      we can pull examples from the same direction bucket (minimalist,
  //      coastal, modern, traditional, eclectic). When nothing matches, the
  //      fetcher falls back to any direction for the same room_type.
  const inferredStyleLabel = await inferStyleLabel(analysis.design_direction);
  const fewShotExamples = await fetchDiagnosisExamples(
    ctx.roomType,
    inferredStyleLabel,
  );
  const fewShotBlock = formatExamplesForPrompt(fewShotExamples);
  if (fewShotExamples.length > 0) {
    log.info("Injecting few-shot examples into Pass 2 prompt", {
      count: fewShotExamples.length,
      roomType: ctx.roomType,
    });
  }

  const planPrompt = getDiagnosisPlanPrompt(
    ctx.roomType,
    analysisJson,
    ctx.keepItems,
    ctx.replaceItems,
    ctx.priorities,
    ctx.userContext,
    fewShotBlock,
  );

  let planTokens = 0;
  let plan: { missing_categories: string[]; action_list: ActionItem[] };

  {
    let lastError: string | undefined;
    let parsed: { missing_categories: string[]; action_list: ActionItem[] } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const retryText = attempt > 0 && lastError
          ? `${planPrompt}\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified.`
          : planPrompt;

        // Re-attach the cached room images so Pass B can still ground its
        // action_list placement strings ("against the north wall", "behind
        // the sofa") in visible reality. Without images, Pass B writes
        // confidently-wrong placements that the user catches later.
        // cacheScope means we pay only cached-tier input cost.
        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: retryText }] }],
          max_tokens: 8000,
          seed: DETERMINISTIC_SEED,
          responseMimeType: "application/json",
          cacheScope: cacheableBlocks.length > 0
            ? { sessionKey: roomSessionKey, content: cacheableBlocks }
            : undefined,
          tools: [
            { googleSearch: {} as Record<string, never> },
            { codeExecution: {} as Record<string, never> },
          ],
        });

        const raw = extractJsonObject(response.content);
        const validated = DiagnosisPlanResponseSchema.parse(raw);
        parsed = {
          missing_categories: validated.missing_categories,
          action_list: validated.action_list as ActionItem[],
        };
        planTokens = response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Diagnosis plan failed";
        if (attempt === 0) {
          log.warn("Diagnosis plan attempt 1 failed", { error: lastError });
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return { success: false, error: lastError };
      }
    }
    if (!parsed) return { success: false, error: "Diagnosis plan failed after retries" };
    plan = parsed;
  }

  log.info("Diagnosis plan pass complete", {
    roomType: ctx.roomType,
    tokens: { total: planTokens },
    missingCategories: plan.missing_categories.length,
    actionItems: plan.action_list.length,
  });

  return {
    success: true,
    data: {
      diagnosis: analysis.diagnosis,
      design_direction: analysis.design_direction,
      missing_categories: plan.missing_categories,
      action_list: plan.action_list,
    },
    tokensUsed: analysisTokens + planTokens,
    model: analysisModel,
  };
}
