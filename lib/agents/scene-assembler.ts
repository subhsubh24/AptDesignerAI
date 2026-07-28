/**
 * Scene assembler — multi-view holistic room understanding.
 *
 * Feeds EVERY photo of a room into one Gemini call and asks for a single
 * canonical object inventory + spatial layout + coverage, merging the same
 * object across angles. The raw VLM output is then deterministically deduped and
 * floor-plan-grounded by scene-reconciliation.ts (because VLM cross-view
 * correspondence is unreliable on its own — see that file's header).
 *
 * Cost contract: this is "room understanding", where HIGH thinking is explicitly
 * allowed (no cheap deterministic verifier can read a photo). It reuses the
 * "diagnosis" task tier. Every .chat() passes an explicit thinkingConfig via
 * thinkingFor(); all calls are seeded; images are cached across self-consistency
 * samples + judge via cacheScope to amortize tokenization.
 */

import crypto from "crypto";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { resolveImageBlocks } from "@/lib/ai/resolve-image";
import { getSystemPrompt } from "@/lib/prompts/system";
import { getSceneAssemblyPrompt } from "@/lib/prompts/scene-graph";
import { RoomSceneGraphResponseSchema } from "@/lib/types/schemas";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC, DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { selfConsistent } from "./self-consistency";
import { reconcileSceneGraph, sceneGraphQualityOk } from "./scene-reconciliation";
import type { AIContentBlock } from "@/lib/ai/provider";
import type { AgentContext, AgentResult } from "./types";
import type { RoomSceneGraph } from "@/lib/types/database";

const log = createLogger("scene-assembler");

/**
 * Assemble a deduped, floor-plan-grounded scene graph from all of a room's
 * photos. Best-effort: returns success:false (never throws) so the caller can
 * skip it without blocking diagnosis. Requires at least one room photo.
 */
export async function assembleRoomSceneGraph(ctx: AgentContext): Promise<AgentResult<RoomSceneGraph>> {
  if (!ctx.imageUrls || ctx.imageUrls.length === 0) {
    return { success: false, error: "scene-assembler: no room photos" };
  }

  const model = selectModel("diagnosis");
  const system = getSystemPrompt();
  const hasFloorPlan = !!ctx.floorPlanImageUrl;

  // Image order MUST match the indices the model references in observed_in:
  // [floor plan?, ...photos]. Reconciliation maps non-floor-plan indices back
  // to URLs, so we track the photo offset.
  const photoOffset = hasFloorPlan ? 1 : 0;

  const cacheableBlocks: AIContentBlock[] = [];

  // Resolve every image in ONE parallel batch, THEN interleave the captions.
  // The captions are positional ("IMAGE 0", "IMAGE 3"), so index-preserving
  // resolution is not an optimisation detail here — a block in the wrong slot
  // would mislabel which photo the model is looking at.
  const floorPlanUrls = ctx.floorPlanImageUrl ? [ctx.floorPlanImageUrl] : [];
  const resolved = await resolveImageBlocks(
    [...floorPlanUrls, ...ctx.imageUrls],
    { preferFilesApi: true },
  );

  if (ctx.floorPlanImageUrl) {
    cacheableBlocks.push({
      type: "text",
      text: "IMAGE 0 is the AUTHORITATIVE FLOOR PLAN — ground truth for room shape, wall directions, and dimensions.",
    });
    cacheableBlocks.push(resolved[0]);
  }
  for (let i = 0; i < ctx.imageUrls.length; i++) {
    cacheableBlocks.push({ type: "text", text: `IMAGE ${i + photoOffset}:` });
    cacheableBlocks.push(resolved[floorPlanUrls.length + i]);
  }

  const sessionKey = crypto
    .createHash("sha256")
    .update(`scene|${ctx.roomType}|${ctx.imageUrls.join("|")}`)
    .digest("hex")
    .slice(0, 16);

  const prompt = getSceneAssemblyPrompt(
    ctx.roomType,
    ctx.imageUrls.length,
    hasFloorPlan,
    ctx.keepItems ?? [],
    ctx.replaceItems ?? [],
    ctx.userContext,
  );

  // image_index in the model's output is 0-based over the FULL block array
  // (floor plan included). Reconciliation expects indices over the PHOTO array,
  // so we hand it a source list aligned to that: a leading placeholder for the
  // floor-plan slot keeps indices aligned, then it's filtered out by URL.
  const indexedSourceUrls = hasFloorPlan
    ? [ctx.floorPlanImageUrl as string, ...ctx.imageUrls]
    : ctx.imageUrls;

  type Sample = { graph: RoomSceneGraph; tokens: number; model: string };

  const generateSample = async (seed: number, sampleIndex: number): Promise<Sample | null> => {
    let lastError: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content: AIContentBlock[] = [
          {
            type: "text",
            text:
              attempt > 0 && lastError
                ? `${prompt}\n\n**IMPORTANT**: Your previous response was invalid: "${lastError}". Return ONLY valid JSON with the exact structure specified.`
                : prompt,
          },
        ];

        const response = await geminiProvider.chat({
          model,
          system,
          messages: [{ role: "user", content }],
          max_tokens: 64000,
          seed,
          responseMimeType: "application/json",
          mediaResolution: "ultra_high",
          thinkingConfig: thinkingFor("diagnosis"),
          cacheScope: { sessionKey, content: cacheableBlocks },
        });

        const raw = extractJsonObject(response.content);
        const parsed = RoomSceneGraphResponseSchema.parse(raw);
        const graph = reconcileSceneGraph(parsed, {
          // Pass the floor-plan-aligned list so model indices resolve; the
          // floor-plan URL is then naturally excluded from object observations
          // because the model only references photos for furniture.
          sourceImageUrls: indexedSourceUrls,
          roomType: ctx.roomType,
          keepItems: ctx.keepItems,
          replaceItems: ctx.replaceItems,
          floorPlan: ctx.extractedFloorPlan,
          modelUsed: response.model,
        });
        // Drop the floor-plan slot from the persisted source list so it reads
        // as "N photos", not "N+1".
        graph.source_image_urls = ctx.imageUrls.slice();
        return {
          graph,
          tokens: response.usage.input_tokens + response.usage.output_tokens + response.usage.thinking_tokens,
          model: response.model,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "scene assembly failed";
        if (attempt === 0) {
          log.warn("Scene assembly attempt 1 failed", { sampleIndex, error: lastError });
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
    }
    return null;
  };

  // Judge: pick the candidate with the most complete, photo-accurate inventory.
  // Grounded on the actual photos (via cacheScope) so it rewards accuracy over
  // fluent over-listing of objects that aren't there.
  const judge = async (candidates: Sample[]): Promise<number> => {
    const summaries = candidates
      .map((c, i) => {
        const g = c.graph;
        const objs = g.objects
          .slice(0, 12)
          .map((o) => `${o.label || o.category} (${o.observed_in.length} views)`)
          .join("; ");
        return `=== CANDIDATE ${i} ===\nObjects (${g.objects.length}): ${objs}\nDuplicates merged: ${g.reconciled_duplicate_count}\nCoverage: ${(g.coverage.estimated_coverage * 100).toFixed(0)}% — gaps: ${g.coverage.gaps.join(", ") || "none"}\nSummary: ${g.summary.slice(0, 240)}`;
      })
      .join("\n\n");

    const judgePrompt = `You are comparing ${candidates.length} reconstructions of the SAME room from the same photos. Pick the ONE that best matches what is actually visible.

Criteria (in order):
1. **Accuracy** — every listed object must be visibly present in the photos. Inventing objects is disqualifying.
2. **Correct merging** — the same physical object must appear once, not duplicated per angle. A candidate that correctly merged duplicates beats one that double-counted.
3. **Completeness** — within accuracy, more of the room's real objects captured is better.
4. **Spatial + coverage honesty** — relations and unseen-area gaps should reflect the photos.

${summaries}

Return ONLY: {"best_index": <0..${candidates.length - 1}>, "reason": "<one sentence>"}`;

    try {
      const resp = await geminiProvider.chat({
        model: selectModel("diagnosis"),
        system: getSystemPrompt(),
        messages: [{ role: "user", content: [{ type: "text", text: judgePrompt }] }],
        max_tokens: 8000,
        seed: DETERMINISTIC_SEED,
        thinkingConfig: { thinkingLevel: "low" },
        cacheScope: { sessionKey, content: cacheableBlocks },
      });
      const parsed = extractJsonObject(resp.content) as { best_index?: number; reason?: string };
      const idx = typeof parsed?.best_index === "number" ? parsed.best_index : 0;
      log.info("Scene assembly judge chose candidate", { chosen: idx, reason: parsed?.reason, candidates: candidates.length });
      return idx;
    } catch (err) {
      log.warn("Scene assembly judge failed — defaulting to sample 0", { error: String(err) });
      return 0;
    }
  };

  try {
    const selection = await selfConsistent<Sample>({
      generate: generateSample,
      judge,
      label: "scene-assembly",
      // Deterministic escalation: if the single sample comes back degenerate
      // (no objects / empty summary), escalate to N=3 + judge.
      qualityCheck: (s) => sceneGraphQualityOk(s.graph),
    });

    const graph = selection.chosen.graph;
    // Metadata timestamp — mirrors floor-plan-extractor's extracted_at. Not part
    // of the deterministic reconciliation core (kept out of scene-reconciliation).
    graph.assembled_at = DETERMINISTIC ? undefined : new Date().toISOString();
    const tokensUsed = selection.candidates.reduce((sum, c) => sum + c.tokens, 0);

    log.info("Scene assembly complete", {
      roomType: ctx.roomType,
      photos: ctx.imageUrls.length,
      objects: graph.objects.length,
      duplicatesMerged: graph.reconciled_duplicate_count,
      coverage: graph.coverage.estimated_coverage,
      gaps: graph.coverage.gaps.length,
    });

    return { success: true, data: graph, tokensUsed, model: selection.chosen.model };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "scene assembly failed after retries";
    log.warn("Scene assembly failed — continuing without scene graph", { error: msg });
    return { success: false, error: msg };
  }
}
