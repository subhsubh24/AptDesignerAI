/**
 * CorrectionPlanner — agentic self-correction loop.
 *
 * After the requirement audit scores the final product set, this agent reads
 * the audit result + pipeline state + diagnosis and decides WHAT to do to fix
 * the gaps. It outputs structured actions the orchestrator executes:
 *
 *   - re_search_category: generate fresh queries for a category that's
 *     missing or whose top pick doesn't match the assessment specs
 *   - drop_category: the category is unreachable within constraints, mark it
 *     "not found" and move on
 *   - accept: no meaningful improvement is likely, stop iterating
 *
 * The agent uses the full agentic system prompt (thinking + reasoning) and
 * is grounded in the audit's specific issues — not hardcoded rules. When it
 * decides to re-search, it generates queries that DIRECTLY address the gap
 * (e.g., audit says "rug is 6x9 but spec calls for 8x10" → new queries lead
 * with "8x10 rug ...").
 *
 * Fails open: if the planner errors, the orchestrator accepts the current
 * state. Adds ~40-80K tokens per correction iteration.
 */

import { getProvider } from "@/lib/ai/provider-factory";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { zodToGeminiSchema } from "@/lib/ai/schema";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { createLogger } from "@/lib/logging/logger";
import { z } from "zod";
import type { AgentResult } from "./types";
import type { RequirementValidationResult } from "./requirement-validator";
import type { DiagnosisData } from "@/lib/types/database";
import type { DynamicDesignProfile } from "@/lib/design-context/user-profile";

const log = createLogger("correction-planner");

const CorrectionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("re_search_category"),
    category: z.string(),
    reason: z.string().describe("Why this category needs re-searching — cite the exact audit issue"),
    /** Fresh queries directly targeting the gap. 2-4 queries per tier. */
    queries_by_tier: z.object({
      budget: z.array(z.string()).default([]),
      balanced: z.array(z.string()).default([]),
      high_end: z.array(z.string()).default([]),
    }),
    priority: z.enum(["high", "medium", "low"]).default("medium"),
  }),
  z.object({
    type: z.literal("drop_category"),
    category: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("accept"),
    reason: z.string().describe("Why no further iteration will help"),
  }),
]);

export type CorrectionAction = z.infer<typeof CorrectionActionSchema>;

const CorrectionPlanSchema = z.object({
  diagnosis: z.string().describe("Root-cause analysis — what's broken about the current set"),
  actions: z.array(CorrectionActionSchema).max(8),
  /** If true, run the correction loop again after executing these actions. */
  iterate_again: z.boolean().default(false),
  /** Expected alignment gain if actions succeed (0-10 delta). */
  expected_gain: z.coerce.number().min(0).max(10).default(1),
});

export type CorrectionPlan = z.infer<typeof CorrectionPlanSchema>;

const CORRECTION_PLAN_GEMINI_SCHEMA = zodToGeminiSchema(CorrectionPlanSchema);

export interface CorrectionPlannerInput {
  roomType: string;
  budgetMode: string;
  audit: RequirementValidationResult;
  /** Summary of current state per category so the agent knows what's already been tried. */
  categoryState: Record<string, {
    topPickTitle?: string;
    topPickPrice?: number;
    topPickScore?: number;
    productCount: number;
    tiersCovered: string[];
  }>;
  diagnosis?: DiagnosisData;
  whatItNeeds?: Array<{ category: string; search_title?: string; specs?: string; placement?: string; priority?: string }>;
  designDirection?: { style_notes?: string; recommended_palette?: string[]; recommended_materials?: string[] };
  designProfile?: DynamicDesignProfile;
  /** Queries already tried so the agent doesn't repeat them. */
  triedQueries?: Record<string, string[]>;
  /** Current iteration count so the agent knows when to stop. */
  iteration: number;
  maxIterations: number;
  /**
   * Enable Google Search + URL Context tools so the planner can
   * (a) check what retailers are actually selling for the categories it
   *     wants to re-search, and
   * (b) read specific retailer pages to ground its query suggestions in
   *     real product listings.
   * Default true — this agent benefits a lot from real-world grounding.
   */
  enableTools?: boolean;
}

export async function planCorrections(
  input: CorrectionPlannerInput
): Promise<AgentResult<CorrectionPlan>> {
  const model = selectModel("validation");
  const system = getSystemPrompt(input.designProfile);

  const auditBlock = [
    `Overall alignment: ${input.audit.overall_alignment}/10`,
    `Coverage score: ${input.audit.coverage.score}/10`,
    input.audit.coverage.missing_categories.length > 0
      ? `Missing categories: ${input.audit.coverage.missing_categories.join(", ")}`
      : "",
    input.audit.coverage.uncovered_requirements.length > 0
      ? `Uncovered requirements: ${input.audit.coverage.uncovered_requirements.join("; ")}`
      : "",
    `Diagnosis-solving score: ${input.audit.diagnosis_solving.score}/10`,
    input.audit.diagnosis_solving.problems_unaddressed.length > 0
      ? `Unaddressed problems: ${input.audit.diagnosis_solving.problems_unaddressed.join("; ")}`
      : "",
    input.audit.spec_matches.length > 0
      ? `\nSpec matches per category:\n${input.audit.spec_matches.map((s) =>
          `  [${s.category}] match=${s.matches} score=${s.match_score}/10${s.gaps.length ? ` gaps: ${s.gaps.join(", ")}` : ""} — ${s.reasoning}`
        ).join("\n")}`
      : "",
    input.audit.issues.length > 0 ? `\nIssues:\n${input.audit.issues.map((i) => `  - ${i}`).join("\n")}` : "",
    input.audit.suggestions.length > 0 ? `\nSuggestions:\n${input.audit.suggestions.map((s) => `  - ${s}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const categoryStateBlock = Object.entries(input.categoryState).length > 0
    ? Object.entries(input.categoryState).map(([cat, s]) => {
        const parts = [`[${cat}]`];
        parts.push(`products=${s.productCount}`);
        if (s.tiersCovered.length > 0) parts.push(`tiers=${s.tiersCovered.join("/")}`);
        if (s.topPickTitle) parts.push(`top="${s.topPickTitle}"`);
        if (s.topPickPrice) parts.push(`$${s.topPickPrice}`);
        if (s.topPickScore !== undefined) parts.push(`score=${s.topPickScore.toFixed(1)}`);
        return parts.join(" ");
      }).join("\n")
    : "(no state)";

  const whatItNeedsBlock = input.whatItNeeds && input.whatItNeeds.length > 0
    ? input.whatItNeeds.map((n) => {
        const bits = [`[${n.category}]`];
        if (n.search_title) bits.push(n.search_title);
        if (n.specs) bits.push(`SPECS: ${n.specs}`);
        if (n.placement) bits.push(`PLACEMENT: ${n.placement}`);
        return bits.join(" | ");
      }).join("\n")
    : "(none)";

  const triedQueriesBlock = input.triedQueries && Object.keys(input.triedQueries).length > 0
    ? Object.entries(input.triedQueries).map(([cat, qs]) =>
        `  [${cat}]:\n    ${qs.slice(0, 6).map((q) => `- ${q}`).join("\n    ")}`
      ).join("\n")
    : "(none tried yet this session)";

  const diagnosisBlock = input.diagnosis ? [
    input.diagnosis.what_is_not_working?.length
      ? `Not working: ${input.diagnosis.what_is_not_working.join("; ")}`
      : "",
    input.diagnosis.spatial_gaps?.length
      ? `Dead zones: ${input.diagnosis.spatial_gaps.join("; ")}`
      : "",
    input.diagnosis.lighting_issues?.length
      ? `Lighting issues: ${input.diagnosis.lighting_issues.join("; ")}`
      : "",
  ].filter(Boolean).join("\n") : "(no diagnosis)";

  const designBlock = input.designDirection ? [
    input.designDirection.style_notes ? `Style: ${input.designDirection.style_notes}` : "",
    input.designDirection.recommended_palette?.length
      ? `Palette: ${input.designDirection.recommended_palette.join(", ")}`
      : "",
    input.designDirection.recommended_materials?.length
      ? `Materials: ${input.designDirection.recommended_materials.join(", ")}`
      : "",
  ].filter(Boolean).join("\n") : "(no design direction)";

  const prompt = `You are the correction planner for a product search pipeline. The pipeline just ran and an audit agent graded the result set. Your job: diagnose the root cause of the gaps and plan specific corrective actions.

## AUDIT RESULT (what the auditor found)
${auditBlock}

## CURRENT PIPELINE STATE (what we have now)
${categoryStateBlock}

## ORIGINAL DESIGN ASSESSMENT REQUIREMENTS
${whatItNeedsBlock}

## ROOM DIAGNOSIS
${diagnosisBlock}

## DESIGN DIRECTION
${designBlock}

## QUERIES ALREADY TRIED
${triedQueriesBlock}

## CONSTRAINTS
- Room type: ${input.roomType}
- Budget mode: ${input.budgetMode}
- This is iteration ${input.iteration + 1}. The loop has NO hard cap — it terminates when YOU set \`iterate_again: false\` or when the alignment target (8.0/10) is reached. Use \`iterate_again: true\` only when a follow-up correction pass would meaningfully improve outcomes; \`false\` when this round's actions are sufficient or further iterations have diminishing returns.
- Re-searching costs 50-100K tokens per category per iteration. Only re-search when the audit shows a CONCRETE gap that new queries could plausibly close.

## YOUR DECISION

Think step-by-step. For each issue in the audit:
1. What's the ROOT CAUSE — are we missing a product, did we find a wrong-spec product, is the query too generic, is the category genuinely unreachable in this budget?
2. Would new queries with more specific spec language (exact dimensions, exact materials, exact color) plausibly find a better product?
3. Have we already tried similar queries (check the tried list)?

For each category you want to re-search, generate 2-4 NEW queries per tier that:
- Lead with the exact specs from the assessment (e.g., "8x10 wool rug" not "modern rug")
- Include concrete materials and colors from the design direction
- Differ meaningfully from what's already been tried
- Vary retailer and style angle (don't stack 4 near-identical queries)

If a category cannot be fixed (e.g., audit flagged "no outdoor furniture available in budget" and no retailer sells it at that price), drop it with a clear reason.

If alignment is already ≥ 8.5 and no concrete gaps remain, output a single "accept" action and do not re-iterate.

Set \`iterate_again: true\` only if you believe a SECOND correction pass after this one would meaningfully improve the set. Default false.

Return JSON matching the schema. Keep \`diagnosis\` concrete (reference specific categories and gap types).

## EXAMPLES OF GOOD CORRECTION ACTIONS

Example 1 — audit said "[area_rug] match=false, gaps: ['size 6x9 vs spec 8x10']":
  → action: re_search_category
  → category: "area_rug"
  → reason: "Top pick is 6x9; assessment requires 8x10 to extend ~24in beyond seating per spec"
  → queries_balanced: ["8x10 wool area rug ivory cream", "8x10 jute natural area rug", "8x10 vintage style area rug warm tones"]
  → priority: high

Example 2 — audit said "Missing categories: pendant_light":
  → action: re_search_category
  → category: "pendant_light"
  → reason: "Coverage gap: pendant_light not in result set; diagnosis flagged dining area as 'underlit at night'"
  → queries_balanced: ["modern brass pendant light dining table", "linen drum pendant light large", "globe pendant light brushed brass 24 inch"]

Example 3 — audit said "Diagnosis-solving: lighting unaddressed; floor_lamp top pick is 'tiny accent lamp'":
  → action: re_search_category (NOT drop — the issue is wrong size, not unavailability)
  → category: "floor_lamp"
  → reason: "Top pick is 24in accent lamp; diagnosis needs floor-spanning ambient light (60in+)"
  → queries_balanced: ["arc floor lamp 65 inch brass", "tripod floor lamp linen shade tall", "task floor lamp 60 inch reading height"]

Example 4 — audit said "[outdoor_table] match_score=2; no high-end outdoor furniture below \$400":
  → action: drop_category
  → category: "outdoor_table"
  → reason: "Two re-searches at this tier returned no products; high-end outdoor furniture starts at \$600 — unreachable in current budget"

Example 5 — audit alignment 8.7, no concrete gaps:
  → action: accept
  → reason: "Alignment 8.7 exceeds 8.0 target; remaining issues are minor stylistic preferences not actionable via re-search"

Notice the pattern: every re-search has 3-4 SPECIFIC queries that address the GAP, not generic queries.${input.enableTools !== false ? `

## GROUNDING — YOU HAVE GOOGLE SEARCH + URL CONTEXT
Use Google Search to verify what retailers are actually selling before generating queries. If the audit says "rug is 6x9 but spec calls for 8x10 at $400", search for "8x10 area rug $400" to see what the market offers — then write queries that reference what's actually available (e.g., "rugs.com 8x10 wool area rug ivory" rather than a generic "8x10 rug"). If the audit flags a retailer page as mismatched, use URL Context to read that page and understand the actual product — then generate queries that avoid the same type of product.

Search before writing queries. Queries grounded in real product listings perform ~2x better than queries invented from the design assessment alone.` : ""}`;

  try {
    const response = await withRetry(
      async () => {
        return await getProvider("validation").chat({
          model,
          system,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
          max_tokens: 64000,
          seed: DETERMINISTIC_SEED,
          responseSchema: CORRECTION_PLAN_GEMINI_SCHEMA,
          responseMimeType: "application/json",
        });
      },
      { isRetryable: isRetryableError, maxAttempts: 2 }
    );

    const parsed = extractJsonObject(response.content);
    const validated = CorrectionPlanSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn("CorrectionPlan response failed schema — skipping correction", {
        issues: validated.error.issues.slice(0, 3),
      });
      return { success: false, error: "Schema validation failed" };
    }

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0) +
      (response.usage?.thinking_tokens ?? 0);

    log.info("Correction plan generated", {
      iteration: input.iteration,
      actionCount: validated.data.actions.length,
      actionTypes: validated.data.actions.map((a) => a.type),
      iterateAgain: validated.data.iterate_again,
      expectedGain: validated.data.expected_gain,
      tokensUsed,
    });

    return {
      success: true,
      data: validated.data,
      tokensUsed,
      model,
    };
  } catch (err) {
    log.warn("Correction planner failed — failing open", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Correction planning failed",
    };
  }
}

export { CorrectionPlanSchema };
