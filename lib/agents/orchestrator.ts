import {
  generateSearchBrief,
  searchProducts,
  deduplicateCandidates,
  quickScreenCandidates,
  type SearchCandidate,
  type SearchBrief,
} from "./shopping-researcher";
import { extractFromUrl } from "./product-extractor";
import { runProductVerifier } from "./computer-use/product-verifier";
import { scoreProducts, quickScoreProducts } from "./fit-scorer";
import { evaluateBundle, generateBundleVibe, prefilterBundleCombos } from "./bundle-optimizer";
import { validateProductSet } from "./validation-agent";
import { validateRequirements, type RequirementValidationResult } from "./requirement-validator";
import { planCorrections, type CorrectionAction } from "./correction-planner";
import { planCategories, type CategoryPlan } from "./category-planner";
import {
  runPostSearchCoordinator,
  type CoordinatorState,
  type CoordinatorTool,
} from "./post-search-coordinator";
import {
  getStrongProductThreshold,
  getBackfillThreshold,
  getDeepScoreKeepFloor,
} from "@/lib/scoring/dynamic-thresholds";
import { rerankCandidates } from "./reranker";
import { PipelineTracer } from "./pipeline-trace";
import { checkForDrift, getScoreDistributionSummary } from "@/lib/scoring/drift-monitor";
import { pairwiseRerank } from "@/lib/scoring/pairwise-reranker";
import { selectByMMR } from "@/lib/scoring/mmr-reranker";
import { generateExplorationQueries } from "@/lib/scoring/query-exploration";
import { productMatchesCategoryAsync } from "@/lib/validation/category-match";
import { computeBundleMathScores } from "@/lib/validation/bundle-math";
import { ORCHESTRATOR } from "@/lib/config/pipeline";
import { createLogger } from "@/lib/logging/logger";
import { pLimit } from "@/lib/utils/p-limit";
import type { AgentContext, AgentResult } from "./types";
import type { CandidateProduct, DiagnosisData } from "@/lib/types/database";
import type { ProductEvaluationResult } from "@/lib/types/scoring";
import type { PriceTier } from "@/lib/prompts/search-brief";

const log = createLogger("orchestrator");

// ─── Deterministic tiebreakers ─────────────────────────────────
// When two items have equal scores, JavaScript's .sort is unstable: ties
// fall out in insertion order, which depends on which async extraction
// finished first. We add URL-based tiebreakers so the same candidate set
// always produces the same ranking.
function tiebreakProduct(a: CandidateProduct, b: CandidateProduct): number {
  const au = a.product_url || "";
  const bu = b.product_url || "";
  return au.localeCompare(bu);
}
function tiebreakBundle(a: CandidateProduct[], b: CandidateProduct[]): number {
  const au = [...a.map((p) => p.product_url || "")].sort().join("|");
  const bu = [...b.map((p) => p.product_url || "")].sort().join("|");
  return au.localeCompare(bu);
}

// ─── Types ─────────────────────────────────────────────────────

export interface OrchestrationStep {
  step: string;
  status: "pending" | "running" | "completed" | "failed";
  data?: unknown;
}

export interface OrchestrationResult {
  searchBrief: unknown;
  candidatesByCategory: Record<string, CandidateProduct[]>;
  // (s) Additional alternatives the user can browse
  alsoConsidered?: Record<string, CandidateProduct[]>;
  evaluations: Map<string, ProductEvaluationResult>;
  bundles: unknown[];
  steps: OrchestrationStep[];
  validation?: { isValid: boolean; confidence: number; issues: string[] };
  /** Requirement audit — LLM-graded coverage / spec / diagnosis alignment. */
  requirementAudit?: RequirementValidationResult;
  /** Agentic category plan — what the planner decided to search for. */
  categoryPlan?: CategoryPlan;
  stats: {
    totalSearchQueries: number;
    totalRawUrls: number;
    totalAfterDedup: number;
    totalAfterScreen: number;
    totalExtracted: number;
    totalQuickScored: number;
    totalDeepScored: number;
    totalFinal: number;
    tokensUsed: number;
    conversionRates?: Record<string, number>;
    bottlenecks?: string[];
    driftWarnings?: string[];
  };
  trace?: ReturnType<PipelineTracer["getTrace"]>;
}

const PRICE_TIERS: PriceTier[] = ["budget", "balanced", "high_end"];
const TIER_LABELS: Record<PriceTier, string> = {
  budget: "Budget",
  balanced: "Balanced",
  high_end: "High End",
};

// ─── Cartesian Product ────────────────────────────────────────

/** Generate all combinations by picking one element from each array. */
function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const [first, ...rest] = arrays;
  const restCombos = cartesian(rest);
  const result: T[][] = [];
  for (const item of first) {
    for (const combo of restCombos) {
      result.push([item, ...combo]);
    }
  }
  return result;
}

// ─── Token Budget ─────────────────────────────────────────────

/** Track cumulative token usage and enforce a hard cap. */
class TokenBudget {
  used = 0;
  readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  add(tokens: number) {
    this.used += tokens;
  }

  get remaining() {
    return Math.max(0, this.cap - this.used);
  }

  get exceeded() {
    return this.used >= this.cap;
  }
}

/** Token cap reads from centralized config; env var override available. */
const DEFAULT_TOKEN_CAP = ORCHESTRATOR.defaultTokenCap;

// ─── Sentinel Domain Tracker ──────────────────────────────────
// Tracks extraction failure rates per domain to skip domains that
// consistently return sentinel titles (category pages, 403s, etc.)

const domainSentinelStats = new Map<string, { total: number; sentinels: number }>();

function trackExtraction(url: string, isSentinel: boolean) {
  try {
    const domain = new URL(url).hostname;
    const entry = domainSentinelStats.get(domain) ?? { total: 0, sentinels: 0 };
    entry.total++;
    if (isSentinel) entry.sentinels++;
    domainSentinelStats.set(domain, entry);
  } catch { /* invalid URL */ }
}

// Known non-retailer domains that historically return blogs, listicles,
// news articles, or forum discussions. Blocked proactively so we don't
// burn extraction tokens on them. The reactive blocklist below still
// catches retailers whose PDPs fail for other reasons.
const PROACTIVE_DOMAIN_BLOCKLIST = new Set([
  // News / magazines
  "nytimes.com", "wsj.com", "washingtonpost.com", "theguardian.com",
  "theverge.com", "techcrunch.com", "arstechnica.com", "cnn.com",
  // Lifestyle / review sites (no direct PDP)
  "wirecutter.com", "thewirecutter.com", "nymag.com", "strategist.com",
  "nymag.com", "thespruce.com", "goodhousekeeping.com", "bhg.com",
  "housebeautiful.com", "elledecor.com", "architecturaldigest.com",
  "apartmenttherapy.com", "dwell.com", "dezeen.com",
  "realsimple.com", "hgtv.com", "countryliving.com", "mydomaine.com",
  "thekitchn.com", "domino.com", "onekingslane.com",
  // Social / forum / UGC
  "reddit.com", "quora.com", "pinterest.com", "pinterest.ca", "pinterest.co.uk",
  "youtube.com", "youtu.be", "facebook.com", "instagram.com", "tiktok.com",
  "medium.com", "substack.com", "wikipedia.org",
  // Deal aggregators (thin content, redirects)
  "slickdeals.net", "dealnews.com", "brad's deals.com",
]);

function isProactivelyBlockedDomain(url: string): boolean {
  try {
    const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (PROACTIVE_DOMAIN_BLOCKLIST.has(domain)) return true;
    // Also block subdomains of blocked hosts (e.g., blog.nytimes.com)
    for (const blocked of PROACTIVE_DOMAIN_BLOCKLIST) {
      if (domain.endsWith("." + blocked)) return true;
    }
    return false;
  } catch { return false; }
}

function isDomainBlocked(url: string): boolean {
  if (isProactivelyBlockedDomain(url)) return true;
  try {
    const domain = new URL(url).hostname;
    const entry = domainSentinelStats.get(domain);
    if (!entry || entry.total < 5) return false;
    return entry.sentinels / entry.total > 0.8;
  } catch { return false; }
}

// ─── URL Filtering ─────────────────────────────────────────────

// Non-PDP path patterns. Expanded beyond the original collections/blog
// set to catch listicle / review / gift-guide / round-up URLs that
// commonly appear in shopping search results but are never product pages.
const NON_PRODUCT_PATTERNS = /\/(collections|category|categories|all-|shop-all|browse|blog|magazine|inspiration|ideas|guides|reviews?|listicle|round-?ups?|best-of|top-\d+|gift-guide|buying-guide|editorial|articles?|news|stories|posts?)\b/i;

// Article-style URLs that start with a year (e.g., /2024/03/15/best-sofas)
// or contain numeric review slugs.
const ARTICLE_DATE_PATTERN = /\/(19|20)\d{2}\/\d{1,2}\//;

// Common listicle title fragments in the URL slug.
const LISTICLE_SLUG_PATTERN = /\b(?:best-|top-\d+|\d+-best|ultimate-guide|complete-guide|review-of|our-favorite|editor-?s-picks?|we-tested|we-tried)/i;

function isLikelyProductUrl(url: string): boolean {
  try {
    const lower = url.toLowerCase();
    if (lower.endsWith(".pdf")) return false;
    if (lower.endsWith(".html") && LISTICLE_SLUG_PATTERN.test(lower)) return false;
    if (NON_PRODUCT_PATTERNS.test(lower)) return false;
    if (ARTICLE_DATE_PATTERN.test(lower)) return false;
    if (LISTICLE_SLUG_PATTERN.test(lower)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Correction Re-Search Helper ───────────────────────────────
// Runs a targeted mini-pipeline (search → extract → quick-score →
// deep-score) for ONE category with a specific set of queries.
// Used by the agentic self-correction loop.

interface ReSearchCategoryInput {
  category: string;
  queriesByTier: { budget: string[]; balanced: string[]; high_end: string[] };
  ctx: AgentContext;
  brief: SearchBrief;
  tokenBudget: TokenBudget;
  stats: {
    tokensUsed: number;
    totalDeepScored: number;
    totalFinal: number;
    tokensPerPhase: Record<string, number>;
    [k: string]: unknown;
  };
  tracer: PipelineTracer;
  anchorSpecs: Record<string, string>;
  harmonyNeighbors: Array<{ category: string; spec: string }>;
  evaluations: Map<string, ProductEvaluationResult>;
}

const DEPENDENT_CATEGORIES_SET = new Set([
  "side_table", "coffee_table", "accent_chair", "floor_lamp", "table_lamp",
  "area_rug", "ottoman", "nightstand", "dresser", "throw_pillow", "throw_blanket",
  "wall_art", "mirror", "plant", "vase",
]);

async function reSearchCategoryForCorrection(
  input: ReSearchCategoryInput
): Promise<{ added: number; products: CandidateProduct[] }> {
  const { category, queriesByTier, ctx, brief, tokenBudget, stats, tracer, anchorSpecs, harmonyNeighbors, evaluations } = input;

  if (tokenBudget.exceeded) return { added: 0, products: [] };

  const correctionCategory = category;
  const catBrief = brief.categories.find((c) => c.category === correctionCategory);

  let addedCount = 0;
  const newCandidates: CandidateProduct[] = [];

  // Phase 1: search every new query, per tier
  for (const tier of PRICE_TIERS) {
    const queries = queriesByTier[tier] || [];
    if (queries.length === 0) continue;
    if (tokenBudget.exceeded) break;

    const allRawCandidates: Array<{ url: string; title: string; snippet: string; tier: PriceTier }> = [];

    for (const query of queries) {
      if (tokenBudget.exceeded) break;
      const searchRes = await searchProducts(query, 8, tier, correctionCategory, ctx.imageUrls);
      if (searchRes.tokensUsed) {
        tokenBudget.add(searchRes.tokensUsed);
        stats.tokensUsed += searchRes.tokensUsed;
        stats.tokensPerPhase.search = (stats.tokensPerPhase.search || 0) + searchRes.tokensUsed;
      }
      if (searchRes.success && searchRes.data) {
        for (const c of searchRes.data) {
          if (!isLikelyProductUrl(c.url)) continue;
          if (isDomainBlocked(c.url)) continue;
          allRawCandidates.push({ url: c.url, title: c.title, snippet: c.snippet, tier });
        }
      }
    }

    // Dedupe URLs
    const seen = new Set<string>();
    const uniqueCandidates = allRawCandidates.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

    // Cap per tier to prevent runaway cost
    const topCandidates = uniqueCandidates.slice(0, 8);

    // Phase 2: extract
    for (const cand of topCandidates) {
      if (tokenBudget.exceeded) break;
      if (tokenBudget.used / tokenBudget.cap > 0.85) {
        tracer.traceFilter("correction_extract", "", cand.url, "budget > 85%");
        break;
      }

      const extractRes = await extractFromUrl(cand.url, ctx.designProfile, ctx.imageUrls);
      if (extractRes.tokensUsed) {
        tokenBudget.add(extractRes.tokensUsed);
        stats.tokensUsed += extractRes.tokensUsed;
        stats.tokensPerPhase.extract = (stats.tokensPerPhase.extract || 0) + extractRes.tokensUsed;
      }
      if (!extractRes.success || !extractRes.data) continue;
      const title = extractRes.data.title || "";
      if (!title || title === "PAGE_NOT_ACCESSIBLE" || title === "NOT_A_PRODUCT_PAGE") continue;

      const catCheck = await productMatchesCategoryAsync(correctionCategory, extractRes.data.category, title);
      if (!catCheck.ok) continue;

      const priceRange = catBrief?.tiers[tier]?.price_range;
      if (priceRange && extractRes.data.price) {
        if (extractRes.data.price > priceRange.max * 1.75) continue;
        if (extractRes.data.price < priceRange.min * 0.4) continue;
      }

      const id = crypto.randomUUID();
      const product: CandidateProduct = {
        id,
        room_id: ctx.roomId,
        search_session_id: null,
        title,
        product_url: cand.url,
        image_url: extractRes.data.image_url || null,
        local_image_path: null,
        price: extractRes.data.price || null,
        retailer: extractRes.data.retailer || null,
        category: extractRes.data.category || correctionCategory,
        description: extractRes.data.description || null,
        colors: extractRes.data.colors || null,
        materials: extractRes.data.materials || null,
        dimensions: extractRes.data.dimensions || null,
        source_type: "agentic_search",
        metadata: {
          price_tier: tier,
          correction_search: true,
          source_query: queries.join(" | "),
        },
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      newCandidates.push(product);
    }
  }

  if (newCandidates.length === 0) return { added: 0, products: [] };

  // Phase 3: quick-score (batch)
  const quickRes = await quickScoreProducts(
    newCandidates,
    correctionCategory,
    ctx.roomType,
    ctx.budgetMode,
    ctx.designDirection,
    ctx.placementMap?.[correctionCategory],
    ctx.floorPlan,
    ctx.diagnosis as Record<string, unknown> | undefined,
    ctx.priorities,
    ctx.keepItems,
  );
  if (quickRes.tokensUsed) {
    tokenBudget.add(quickRes.tokensUsed);
    stats.tokensUsed += quickRes.tokensUsed;
    stats.tokensPerPhase.quick_score = (stats.tokensPerPhase.quick_score || 0) + quickRes.tokensUsed;
  }
  const quickScoreByProductId = new Map<string, number>();
  if (quickRes.success && quickRes.data) {
    for (const entry of quickRes.data) {
      quickScoreByProductId.set(entry.productId, entry.quickScore);
    }
  }
  const survivors = newCandidates.filter((p) => {
    const qs = quickScoreByProductId.get(p.id);
    return qs === undefined || qs >= 4.0;
  });

  // Phase 4: deep-score and collect products that pass threshold.
  // Batch-score by actual product category (most re-search survivors
  // share the correction category, but a few may be reclassified).
  const keptProducts: CandidateProduct[] = [];
  const survivorsByCat = new Map<string, CandidateProduct[]>();
  for (const p of survivors) {
    const cat = p.category || correctionCategory;
    if (!survivorsByCat.has(cat)) survivorsByCat.set(cat, []);
    survivorsByCat.get(cat)!.push(p);
  }

  for (const [cat, catSurvivors] of survivorsByCat) {
    if (tokenBudget.exceeded) break;
    const { results: batchScores, tokensUsed } = await scoreProducts(catSurvivors, {
      roomType: ctx.roomType,
      budgetMode: ctx.budgetMode,
      existingItems: ctx.keepItems,
      roomImageUrls: ctx.imageUrls,
      priorities: ctx.priorities,
      otherRoomsContext: ctx.otherRoomsContext,
      designProfile: ctx.designProfile,
      diagnosis: ctx.diagnosis,
      designDirection: ctx.designDirection,
      userFeedbackContext: ctx.userFeedbackContext,
      placement: ctx.placementMap?.[cat],
      spatialLayout: ctx.spatialLayout,
      floorPlan: ctx.floorPlan,
      extractedFloorPlan: ctx.extractedFloorPlan,
      lightingConditions: ctx.lightingConditions,
      windowDoorPositions: ctx.windowDoorPositions,
      outletPositions: ctx.outletPositions,
      userContext: ctx.userContext,
      replaceItems: ctx.replaceItems,
      identifiedContext: ctx.identifiedContext,
      anchorSpecs: DEPENDENT_CATEGORIES_SET.has(cat) && Object.keys(anchorSpecs).length > 0 ? anchorSpecs : undefined,
      harmonyNeighbors: harmonyNeighbors.filter((n) => n.category !== cat),
      includeFitNotes: false,
    }, 3);
    if (tokensUsed) {
      tokenBudget.add(tokensUsed);
      stats.tokensUsed += tokensUsed;
      stats.tokensPerPhase.deep_score = (stats.tokensPerPhase.deep_score || 0) + tokensUsed;
    }
    for (const product of catSurvivors) {
      const scoreRes = batchScores.get(product.id);
      if (scoreRes?.success && scoreRes.data) {
        evaluations.set(product.id, scoreRes.data);
        stats.totalDeepScored++;
        const allScores: number[] = [];
        for (const ev of evaluations.values()) {
          if (ev.final_item_score !== undefined) allScores.push(ev.final_item_score);
        }
        const keepFloor = getDeepScoreKeepFloor(allScores);
        if (scoreRes.data.final_item_score >= keepFloor) {
          addedCount++;
          keptProducts.push(product);
        }
      }
    }
  }

  return { added: addedCount, products: keptProducts };
}

// ─── Main Orchestrator ─────────────────────────────────────────

/**
 * Run the full intensive agentic search loop.
 *
 * 6-Phase Funnel:
 * 1. Generate 5 diverse search queries per tier per category
 * 2. Run ALL queries → ~450 raw URLs → deduplicate to ~150
 * 3. Quick screen with Flash → ~90 likely product pages
 * 4. Extract all screened URLs with URL Context → ~60 valid products
 * 5a. Quick score with Flash (batch, no images) → top 8 per tier
 * 5b. Deep score with Pro (images, 8 dimensions) → top 5 per tier
 * 6. Validate holistically + generate bundles
 */
export async function runAgenticSearch(
  ctx: AgentContext,
  missingCategories: string[],
  onStep?: (step: OrchestrationStep) => void,
  categoryHints?: Record<string, string>
): Promise<AgentResult<OrchestrationResult>> {
  domainSentinelStats.clear();
  const steps: OrchestrationStep[] = [];
  const candidatesByCategory: Record<string, CandidateProduct[]> = {};
  const evaluations = new Map<string, ProductEvaluationResult>();
  const tracer = new PipelineTracer(crypto.randomUUID(), ctx.roomId);
  const tokenBudget = new TokenBudget(DEFAULT_TOKEN_CAP);
  const stats = {
    totalSearchQueries: 0,
    totalRawUrls: 0,
    totalAfterDedup: 0,
    totalAfterScreen: 0,
    totalExtracted: 0,
    totalQuickScored: 0,
    totalDeepScored: 0,
    totalFinal: 0,
    tokensUsed: 0,
    /** Per-phase token breakdown for cost/efficiency analysis */
    tokensPerPhase: {
      search_brief: 0,
      search: 0,
      screen: 0,
      rerank: 0,
      extract: 0,
      quick_score: 0,
      deep_score: 0,
      validation: 0,
      bundle: 0,
      backfill: 0,
    } as Record<string, number>,
  };

  function reportStep(step: OrchestrationStep) {
    // Attach running stats to every step event for real-time progress
    const enriched = { ...step, data: { ...(step.data as Record<string, unknown> || {}), stats: { ...stats } } };
    steps.push(step);
    onStep?.(enriched);
    log.info(`${step.status}: ${step.step}`, { phase: step.step, roomId: ctx.roomId });
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 0: Agentic category planning.
    // Replaces the hardcoded `missing_furniture_categories` list with an
    // agent that reasons over diagnosis + design direction + what_it_needs
    // + constraints to decide the REAL shopping list. Adds categories the
    // diagnosis missed (e.g., lighting for a dark room not flagged as
    // missing_categories), drops categories that conflict with keep items.
    // Falls back to baseline missingCategories if the planner fails.
    // ═══════════════════════════════════════════════════════════
    let agenticCategoryPlan: CategoryPlan | undefined;
    let plannedCategories = missingCategories;
    if (missingCategories.length > 0) {
      reportStep({ step: "Planning categories agentically", status: "running" });
      const planRes = await planCategories({
        roomType: ctx.roomType,
        budgetMode: ctx.budgetMode,
        missingCategories,
        whatItNeeds: ctx.whatItNeeds,
        diagnosis: ctx.diagnosis as DiagnosisData | undefined,
        designDirection: ctx.designDirection,
        designProfile: ctx.designProfile,
        keepItems: ctx.keepItems,
        replaceItems: ctx.replaceItems,
        priorities: ctx.priorities,
        userContext: ctx.userContext,
        floorPlan: ctx.floorPlan,
        identifiedContext: ctx.identifiedContext,
      });
      if (planRes.tokensUsed) {
        tokenBudget.add(planRes.tokensUsed);
        stats.tokensUsed += planRes.tokensUsed;
        stats.tokensPerPhase.search_brief += planRes.tokensUsed;
      }
      if (planRes.success && planRes.data) {
        agenticCategoryPlan = planRes.data;
        plannedCategories = planRes.data.categories.map((c) => c.category);
        const added = planRes.data.categories.filter((c) => c.agent_added).map((c) => c.category);
        const dropped = planRes.data.dropped_from_missing.map((d) => d.category);
        reportStep({
          step: "Planning categories agentically",
          status: "completed",
          data: {
            total: plannedCategories.length,
            added,
            dropped,
            reasoning: planRes.data.reasoning,
          },
        });
        log.info("Agentic category plan", {
          phase: "category_planning",
          baseline: missingCategories,
          planned: plannedCategories,
          added,
          dropped,
        });
      } else {
        reportStep({
          step: "Planning categories agentically",
          status: "failed",
          data: { fallback: "using baseline missing_categories" },
        });
      }
    }

    // From here on, treat plannedCategories as the canonical category list.
    missingCategories = plannedCategories;

    // Inject agent-added category priorities into categoryHints so the
    // search brief generator emphasizes them per priority level.
    if (agenticCategoryPlan) {
      categoryHints = categoryHints || {};
      for (const c of agenticCategoryPlan.categories) {
        const existing = categoryHints[c.category] || "";
        categoryHints[c.category] = [
          existing,
          c.search_title_hint || "",
          `(priority: ${c.priority}) — ${c.reason}`,
        ].filter(Boolean).join(" | ");
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Generate search brief (5 queries × 3 tiers × N categories)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Generating intensive search brief", status: "running" });
    const briefResult = await generateSearchBrief(
      ctx.roomType, missingCategories, ctx.budgetMode, categoryHints,
      ctx.designProfile, ctx.designDirection, ctx.priorities,
      ctx.keepItems, ctx.replaceItems, ctx.spatialLayout, ctx.roomSummary,
      ctx.userContext, ctx.diagnosis as Record<string, unknown> | undefined,
      ctx.lightingConditions, ctx.windowDoorPositions, ctx.outletPositions,
      ctx.identifiedContext, ctx.imageUrls, ctx.otherRoomsContext
    );
    if (!briefResult.success || !briefResult.data) {
      reportStep({ step: "Generating intensive search brief", status: "failed", data: { error: briefResult.error } });
      log.error("Search brief failed", { error: briefResult.error, roomId: ctx.roomId });
      return { success: false, error: briefResult.error || "Failed to generate search brief" };
    }
    const brief: SearchBrief = briefResult.data;
    if (briefResult.tokensUsed) {
      tokenBudget.add(briefResult.tokensUsed);
      stats.tokensUsed += briefResult.tokensUsed;
      stats.tokensPerPhase.search_brief += briefResult.tokensUsed;
    }
    reportStep({ step: "Generating intensive search brief", status: "completed", data: brief });

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Run ALL search queries in parallel, deduplicate
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Searching across all retailers", status: "running" });

    // Build list of all search tasks
    const searchTasks: Array<{
      category: string;
      tier: PriceTier;
      query: string;
      angle: string;
    }> = [];

    for (const categoryBrief of brief.categories) {
      for (const tier of PRICE_TIERS) {
        const tierBrief = categoryBrief.tiers[tier];
        if (!tierBrief) continue;
        for (const queryObj of tierBrief.search_queries) {
          searchTasks.push({
            category: categoryBrief.category,
            tier,
            query: queryObj.query,
            angle: queryObj.angle,
          });
        }
      }
    }

    // Inject exploration queries: alternative style synonyms and boutique
    // modifiers to escape the deterministic LLM query generation rut.
    // Seeded per room so results are reproducible but vary across rooms.
    const explorationQueries = generateExplorationQueries(
      searchTasks,
      ctx.roomId,
      ctx.designDirection?.style_notes
    );
    for (const eq of explorationQueries) {
      searchTasks.push(eq);
    }

    stats.totalSearchQueries = searchTasks.length;

    // Run all searches with concurrency limit (Flash Lite is fast, 10K RPM)
    const searchLimit = pLimit(50);
    const searchResultsByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    let searchesCompleted = 0;

    const searchPromises = searchTasks.map((task) =>
      searchLimit(async () => {
        tracer.trace({ phase: "search", action: "query", category: task.category, tier: task.tier, metadata: { query: task.query, angle: task.angle } });
        const result = await searchProducts(task.query, 10, task.tier, task.category, ctx.imageUrls);
        const candidates = result.success ? (result.data || []) : [];
        if (result.tokensUsed) {
          tokenBudget.add(result.tokensUsed);
          stats.tokensUsed += result.tokensUsed;
          stats.tokensPerPhase.search += result.tokensUsed;
        }
        for (const c of candidates) {
          tracer.trace({ phase: "search", action: "found", url: c.url, category: task.category, tier: task.tier });
        }
        searchesCompleted++;
        if (searchesCompleted % 5 === 0 || searchesCompleted === searchTasks.length) {
          reportStep({
            step: "Searching across all retailers",
            status: "running",
            data: { completed: searchesCompleted, total: searchTasks.length },
          });
        }
        return {
          category: task.category,
          tier: task.tier,
          candidates,
        };
      })
    );

    const searchResults = await Promise.all(searchPromises);

    // Organize by category and tier
    for (const result of searchResults) {
      if (!searchResultsByCategory[result.category]) {
        searchResultsByCategory[result.category] = { budget: [], balanced: [], high_end: [] };
      }
      searchResultsByCategory[result.category][result.tier].push(...result.candidates);
    }

    // Count raw URLs and deduplicate per category+tier, then also across
    // tiers of the same category — the same product URL frequently surfaces
    // in budget/balanced/high_end since price bands overlap. Keeping only
    // the first occurrence halves extraction work on noisy runs. The
    // post-extraction price-tier reclassification step moves products into
    // the correct tier based on actual price anyway.
    const dedupedByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};

    for (const [category, tierResults] of Object.entries(searchResultsByCategory)) {
      dedupedByCategory[category] = { budget: [], balanced: [], high_end: [] };
      const seenAcrossTiers = new Set<string>();
      for (const tier of PRICE_TIERS) {
        const raw = tierResults[tier].filter((c) => c.url && isLikelyProductUrl(c.url));
        stats.totalRawUrls += raw.length;
        const dedupedInTier = deduplicateCandidates(raw);
        const kept: SearchCandidate[] = [];
        for (const c of dedupedInTier) {
          let urlKey = c.url;
          try {
            const u = new URL(c.url);
            urlKey = `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
          } catch { /* keep raw url as key */ }
          if (seenAcrossTiers.has(urlKey)) continue;
          seenAcrossTiers.add(urlKey);
          kept.push(c);
        }
        stats.totalAfterDedup += kept.length;
        dedupedByCategory[category][tier] = kept;
      }
    }

    reportStep({
      step: "Searching across all retailers",
      status: "completed",
      data: { queries: stats.totalSearchQueries, rawUrls: stats.totalRawUrls, afterDedup: stats.totalAfterDedup },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: Quick screen with Flash (batch, text-only)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Quick-screening candidates", status: "running" });

    const screenedByCategory: Record<string, Record<PriceTier, SearchCandidate[]>> = {};
    const screenPromises: Promise<void>[] = [];

    for (const [category, tierResults] of Object.entries(dedupedByCategory)) {
      screenedByCategory[category] = { budget: [], balanced: [], high_end: [] };

      for (const tier of PRICE_TIERS) {
        const candidates = tierResults[tier];
        if (candidates.length === 0) continue;

        // Find requirements from brief
        const catBrief = brief.categories.find((c) => c.category === category);
        const requirements = catBrief?.key_requirements || [];

        screenPromises.push(
          (async () => {
            const screenResult = await quickScreenCandidates(candidates, category, tier, requirements, ctx.designDirection, ctx.imageUrls);
            if (screenResult.tokensUsed) {
              tokenBudget.add(screenResult.tokensUsed);
              stats.tokensUsed += screenResult.tokensUsed;
              stats.tokensPerPhase.screen += screenResult.tokensUsed;
            }
            if (screenResult.success && screenResult.data) {
              screenedByCategory[category][tier] = screenResult.data;
              stats.totalAfterScreen += screenResult.data.length;
              for (const c of screenResult.data) {
                tracer.trace({ phase: "screen", action: "passed", url: c.url, category, tier });
              }
              // Trace filtered-out candidates
              const passedUrls = new Set(screenResult.data.map((c) => c.url));
              for (const c of candidates) {
                if (!passedUrls.has(c.url)) {
                  tracer.traceFilter("screen", "", c.url, "failed quick screen");
                }
              }
            } else {
              // Fail open: keep all candidates, but log structured event
              screenedByCategory[category][tier] = candidates;
              stats.totalAfterScreen += candidates.length;
              log.warn("Quick-screen failed — keeping all candidates", {
                phase: "screen", category, tier, candidateCount: candidates.length,
                error: screenResult.error || "unknown", failOpen: true,
              });
            }
          })()
        );
      }
    }

    await Promise.all(screenPromises);

    // Hard cap on screened candidates per (category, tier) before extraction.
    // Extraction is parallelized with 20 concurrent workers — we can afford to
    // attempt many more URLs per tier since most of the wall-clock time is
    // HTTP wait, not CPU. More candidates → more survive the 8 post-extraction
    // filters (HTTP failures, sentinel titles, category mismatch, price range).
    // Override via env.
    const maxExtractPerCatTier = Number(process.env.MAX_EXTRACT_PER_CAT_TIER || "35");
    let totalCapped = 0;
    for (const [category, tierResults] of Object.entries(screenedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const cands = tierResults[tier];
        if (cands.length > maxExtractPerCatTier) {
          const dropped = cands.slice(maxExtractPerCatTier);
          screenedByCategory[category][tier] = cands.slice(0, maxExtractPerCatTier);
          totalCapped += dropped.length;
          for (const d of dropped) {
            tracer.traceFilter("screen", "", d.url, `capped at ${maxExtractPerCatTier}/tier`);
          }
        }
      }
    }
    if (totalCapped > 0) {
      log.info("Capped screened candidates before extraction", {
        phase: "screen", cap: maxExtractPerCatTier, dropped: totalCapped,
      });
    }

    reportStep({
      step: "Quick-screening candidates",
      status: "completed",
      data: { screened: stats.totalAfterScreen, capped: totalCapped },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 3b: Rerank screened candidates (cheap, title+snippet only)
    //
    // Opt-in via ENABLE_RERANK=1. When on, trims each (category, tier)
    // bucket to the top-K most relevant URLs before the expensive extract
    // phase, saving ~50–70% of extract tokens on large runs.
    // Fails open — any error falls back to unreranked candidates.
    // ═══════════════════════════════════════════════════════════
    if (process.env.ENABLE_RERANK === "1") {
      reportStep({ step: "Reranking candidates", status: "running" });
      const rerankTopK = Number(process.env.RERANK_TOP_K || "10");
      const rerankPromises: Promise<void>[] = [];

      for (const [category, tierResults] of Object.entries(screenedByCategory)) {
        const catBrief = brief.categories.find((c) => c.category === category);
        const requirements = catBrief?.key_requirements || [];

        for (const tier of PRICE_TIERS) {
          const candidates = tierResults[tier];
          if (candidates.length <= rerankTopK) continue;

          rerankPromises.push(
            (async () => {
              const result = await rerankCandidates({
                category,
                tier,
                requirements,
                candidates,
                topK: rerankTopK,
                roomImageUrls: ctx.imageUrls,
                designDirection: ctx.designDirection,
                diagnosis: ctx.diagnosis,
                priorities: ctx.priorities,
                budgetMode: ctx.budgetMode,
              });
              if (result.tokensUsed) {
                tokenBudget.add(result.tokensUsed);
                stats.tokensUsed += result.tokensUsed;
                stats.tokensPerPhase.rerank += result.tokensUsed;
              }
              screenedByCategory[category][tier] = result.kept;
              for (const dropped of result.dropped) {
                tracer.traceFilter("rerank", "", dropped.url, "below rerank top-K");
              }
            })()
          );
        }
      }

      await Promise.all(rerankPromises);

      // Recompute downstream stats so progress UI reflects the trim.
      const afterRerank = Object.values(screenedByCategory).reduce(
        (sum, tiers) => sum + Object.values(tiers).reduce((s, c) => s + c.length, 0),
        0
      );
      reportStep({
        step: "Reranking candidates",
        status: "completed",
        data: { afterRerank },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Extract all screened URLs with URL Context
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Extracting product details from websites", status: "running" });

    const extractLimit = pLimit(25);
    // Browser sessions are expensive — cap at 3 concurrent runs regardless of extraction concurrency.
    // Gated on Browserbase credentials + package availability; becomes a no-op when absent.
    const cuFallbackLimit = pLimit(3);
    let cuEnabled = Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
    if (cuEnabled) {
      // @ts-expect-error — optional dependency, not installed in all envs
      try { await import(/* webpackIgnore: true */ "@browserbasehq/sdk"); } catch { cuEnabled = false; }
    }

    // CU fallback promises collected separately from extraction so extraction
    // slots don't block on browser sessions. Awaited collectively after Phase 4
    // before Phase 5 (deep-score) reads the product data.
    const cuPromises: Promise<void>[] = [];

    const extractedByCategory: Record<string, Record<PriceTier, CandidateProduct[]>> = {};

    const totalToExtract = Object.values(screenedByCategory).reduce(
      (sum, tiers) => sum + Object.values(tiers).reduce((s, c) => s + c.length, 0), 0
    );
    let extractedSoFar = 0;

    const extractPromises: Promise<void>[] = [];

    for (const [category, tierResults] of Object.entries(screenedByCategory)) {
      extractedByCategory[category] = { budget: [], balanced: [], high_end: [] };

      for (const tier of PRICE_TIERS) {
        const candidates = tierResults[tier];

        for (const candidate of candidates) {
          extractPromises.push(
            extractLimit(async () => {
              try {
                // Extraction budget gate: stop extracting once we've consumed
                // 55% of the total budget. This reserves headroom for deep-
                // scoring, bundling, and validation downstream.
                if (tokenBudget.used / tokenBudget.cap > 0.55) {
                  tracer.traceFilter("extract", "", candidate.url, "extraction budget gate (>55% used)");
                  extractedSoFar++;
                  return;
                }
                if (isDomainBlocked(candidate.url)) {
                  tracer.traceFilter("extract", "", candidate.url, "domain blocked (>80% sentinel rate)");
                  extractedSoFar++;
                  return;
                }
                const extractResult = await extractFromUrl(candidate.url, ctx.designProfile, ctx.imageUrls);
                if (extractResult.tokensUsed) { tokenBudget.add(extractResult.tokensUsed); stats.tokensUsed += extractResult.tokensUsed; stats.tokensPerPhase.extract += extractResult.tokensUsed; }
                if (!extractResult.success || !extractResult.data) {
                  trackExtraction(candidate.url, true);
                  tracer.traceError("extract", candidate.url, extractResult.error || "extraction failed");
                  extractedSoFar++;
                  return;
                }
                const title = extractResult.data.title || "";
                if (!title || title === "PAGE_NOT_ACCESSIBLE" || title === "NOT_A_PRODUCT_PAGE") {
                  trackExtraction(candidate.url, true);
                  tracer.traceFilter("extract", "", candidate.url, `sentinel title: ${title || "empty"}`);
                  extractedSoFar++;
                  return;
                }
                trackExtraction(candidate.url, false);
                // Confidence gate: skip products with no meaningful data
                const hasSubstance = extractResult.data.title
                  && (extractResult.data.price || extractResult.data.materials?.length || extractResult.data.description);
                if (!hasSubstance) {
                  tracer.traceFilter("extract", "", candidate.url, "insufficient substance");
                  extractedSoFar++;
                  return;
                }

                // Category guard: reject products that don't match the
                // requested category (e.g. a lint roller returned for a
                // "vase" search). Quick-screen is URL-heuristic only; this
                // is the first semantic check on actual product content.
                const catCheck = await productMatchesCategoryAsync(
                  category,
                  extractResult.data.category,
                  extractResult.data.title,
                );
                if (!catCheck.ok) {
                  tracer.traceFilter("extract", "", candidate.url, `category mismatch: ${catCheck.reason}`);
                  extractedSoFar++;
                  return;
                }

                // Price range filter: skip if price is way outside tier range
                const catBriefForPrice = brief.categories.find((c) => c.category === category);
                const priceRange = catBriefForPrice?.tiers[tier]?.price_range;
                if (priceRange && extractResult.data.price) {
                  if (extractResult.data.price > priceRange.max * 1.75) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} above 1.75x max $${priceRange.max}`);
                    extractedSoFar++;
                    return;
                  }
                  if (extractResult.data.price < priceRange.min * 0.4) {
                    tracer.traceFilter("extract", "", candidate.url, `price $${extractResult.data.price} below 0.4x min $${priceRange.min}`);
                    extractedSoFar++;
                    return;
                  }
                }

                const product: CandidateProduct = {
                  id: crypto.randomUUID(),
                  room_id: ctx.roomId,
                  search_session_id: null,
                  title: extractResult.data.title || candidate.title,
                  category: extractResult.data.category || category,
                  retailer: extractResult.data.retailer || candidate.source,
                  product_url: candidate.url,
                  image_url: extractResult.data.image_url,
                  local_image_path: null,
                  price: extractResult.data.price,
                  dimensions: extractResult.data.dimensions,
                  materials: extractResult.data.materials,
                  colors: extractResult.data.colors,
                  description: extractResult.data.description,
                  source_type: "agentic_search",
                  metadata: {
                    price_tier: tier,
                    lifestyle_image_url: extractResult.data.lifestyle_image_url || null,
                    visual_style_tags: extractResult.data.visual_style_tags || [],
                    available_variants: extractResult.data.available_variants || [],
                    // (r) Stock/availability info
                    in_stock: extractResult.data.in_stock ?? null,
                    stock_notes: extractResult.data.stock_notes || null,
                  },
                  status: "pending",
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };

                // ── Computer Use fallback (detached) ──
                // JS-heavy retailer pages (West Elm, CB2, RH, etc.) often don't render
                // price/dimension tables for text-only scrapers. Queue CU as an
                // independent promise — don't block the extract slot waiting for
                // a browser session. The CU promise mutates `product` in place
                // and is awaited before Phase 5 reads product data.
                if (cuEnabled && (!product.price || !product.dimensions)) {
                  cuPromises.push(
                    cuFallbackLimit(async () => {
                      try {
                        const verifyResult = await Promise.race([
                          runProductVerifier({
                            productUrl: candidate.url,
                            expectedTitle: product.title ?? undefined,
                            expectedColor: product.colors?.[0],
                            maxTurns: 10,
                          }),
                          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 60_000)),
                        ]);
                        if (verifyResult === "timeout" || !verifyResult.product) return;
                        const v = verifyResult.product;
                        if (typeof v.price === "number") product.price = v.price;
                        if (v.dimensions?.width_in || v.dimensions?.depth_in || v.dimensions?.height_in) {
                          product.dimensions = {
                            ...(v.dimensions.width_in != null ? { width: v.dimensions.width_in } : {}),
                            ...(v.dimensions.depth_in != null ? { depth: v.dimensions.depth_in } : {}),
                            ...(v.dimensions.height_in != null ? { height: v.dimensions.height_in } : {}),
                            unit: "inches" as const,
                          };
                        }
                        if (v.materials.length && !product.materials?.length) product.materials = v.materials;
                        if (v.available_colors.length && !product.colors?.length) product.colors = v.available_colors;
                        product.metadata = {
                          ...(product.metadata ?? {}),
                          cu_fallback: true,
                          cu_turns: verifyResult.turns,
                          in_stock: v.in_stock ?? null,
                        };
                        log.info("Computer use fallback enriched product", {
                          phase: "extract",
                          url: candidate.url,
                          category,
                          filledPrice: typeof v.price === "number",
                          filledDimensions: Boolean(product.dimensions),
                        });
                      } catch (cuErr) {
                        log.warn("Computer use fallback failed", {
                          phase: "extract",
                          url: candidate.url,
                          error: cuErr instanceof Error ? cuErr.message : String(cuErr),
                        });
                      }
                    })
                  );
                }

                extractedByCategory[category][tier].push(product);
                stats.totalExtracted++;
                tracer.trace({ phase: "extract", action: "success", productId: product.id, url: candidate.url, category, tier });
              } catch (err) {
                tracer.traceError("extract", candidate.url, err);
              }
              extractedSoFar++;
              // Report incremental progress every 5 extractions
              if (extractedSoFar % 5 === 0 || extractedSoFar === totalToExtract) {
                reportStep({
                  step: "Extracting product details from websites",
                  status: "running",
                  data: { extracted: stats.totalExtracted, progress: extractedSoFar, total: totalToExtract },
                });
              }
            })
          );
        }
      }
    }

    await Promise.all(extractPromises);

    // CU fallback enriches price/dimensions on JS-heavy retailer pages.
    // Quick-score doesn't consult price/dimensions (title + description + materials
    // + colors only), so we kick it off in parallel with CU instead of
    // serializing. Tier reclassification waits for CU because it DOES need
    // final price. Deep-score waits for both via awaits further down.
    const cuDonePromise = cuPromises.length > 0
      ? (async () => {
          log.info("Awaiting detached CU fallbacks", { count: cuPromises.length });
          await Promise.all(cuPromises);
        })()
      : Promise.resolve();

    // Kick off quick-score in parallel with CU. Group by category (not by
    // cat/tier) — quick-score's output is keyed by product id and doesn't
    // use tier, so combining tiers into one call amortizes shared context
    // AND saves LLM calls when a category has < 8 products across tiers.
    const quickScoresByProduct = new Map<string, number>();
    const earlyQuickScorePromises: Promise<void>[] = [];
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      const allProducts = [
        ...tierResults.budget,
        ...tierResults.balanced,
        ...tierResults.high_end,
      ];
      if (allProducts.length === 0) continue;
      earlyQuickScorePromises.push(
        (async () => {
          const result = await quickScoreProducts(
            allProducts, category, ctx.roomType, ctx.budgetMode, ctx.designDirection,
            ctx.placementMap?.[category], ctx.floorPlan,
            ctx.diagnosis as Record<string, unknown> | undefined,
            ctx.priorities, ctx.keepItems,
          );
          if (result.tokensUsed) {
            tokenBudget.add(result.tokensUsed);
            stats.tokensUsed += result.tokensUsed;
            stats.tokensPerPhase.quick_score += result.tokensUsed;
          }
          if (result.success && result.data) {
            for (const entry of result.data) {
              quickScoresByProduct.set(entry.productId, entry.quickScore);
              stats.totalQuickScored++;
            }
          }
        })(),
      );
    }

    // Wait for CU before tier reclassification — reclassification uses the
    // final price which CU may have filled.
    await cuDonePromise;

    // ── Price-tier reclassification ─────────────────────────────
    // Products often land in the wrong tier because search queries
    // are approximate (budget search surfaces a $700 item; luxury search
    // surfaces a $200 item). After extraction we know the ACTUAL price —
    // reclassify each product into the tier whose price range best
    // matches it. Previous logic required the price to be both inside
    // the candidate tier's range AND outside 0.5-1.5x of the origin
    // tier's range, which let many misclassified products slip through
    // and produced inverted totals (budget > luxury).
    //
    // New logic: for each product, score every tier by how well its
    // range contains the price. Best-fit tier wins. A product stays
    // in its origin tier only if no other tier is a strictly better fit.
    const tierFitScore = (price: number, range?: { min: number; max: number }): number => {
      if (!range) return -Infinity;
      // Perfect: inside the range → 1.0
      if (price >= range.min && price <= range.max) return 1.0;
      // Partial: within ±40% of the range → inverse distance (0..1)
      if (price >= range.min * 0.6 && price <= range.max * 1.4) {
        if (price < range.min) return 1.0 - (range.min - price) / (range.min * 0.4);
        return 1.0 - (price - range.max) / (range.max * 0.4);
      }
      return -Infinity;
    };

    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      const catBriefForTier = brief.categories.find((c) => c.category === category);
      if (!catBriefForTier) continue;

      const toMove: Array<{ product: CandidateProduct; fromTier: PriceTier; toTier: PriceTier }> = [];

      for (const fromTier of PRICE_TIERS) {
        const products = tierResults[fromTier];
        for (const product of products) {
          if (!product.price) continue;

          // Score every tier's fit, pick the best.
          let bestTier: PriceTier = fromTier;
          let bestScore = tierFitScore(product.price, catBriefForTier.tiers[fromTier]?.price_range);
          for (const candidateTier of PRICE_TIERS) {
            const score = tierFitScore(product.price, catBriefForTier.tiers[candidateTier]?.price_range);
            if (score > bestScore) { bestScore = score; bestTier = candidateTier; }
          }

          if (bestTier !== fromTier) {
            toMove.push({ product, fromTier, toTier: bestTier });
          }
        }
      }

      for (const { product, fromTier, toTier } of toMove) {
        extractedByCategory[category][fromTier] = extractedByCategory[category][fromTier].filter((p) => p.id !== product.id);
        product.metadata = { ...(product.metadata ?? {}), price_tier: toTier, reclassified_from: fromTier };
        extractedByCategory[category][toTier].push(product);
        tracer.trace({ phase: "extract", action: "tier_reclassify", productId: product.id, url: product.product_url ?? undefined, category, metadata: { from: fromTier, to: toTier } });
        log.info("Reclassified product tier", { category, url: product.product_url, from: fromTier, to: toTier, price: product.price });
      }
    }

    // Deduplicate extracted products by title+retailer within each tier.
    // Two-phase: (1) cheap exact-key + URL dedup; (2) LLM-driven semantic
    // dedup that catches IKEA-style naming variants ("KALLAX 2x4" vs
    // "Kallax Bookshelf 2×4 White") the regex normalization can't handle.
    const { dedupProductTitlesLLM } = await import("@/lib/ai/semantic-extract");
    const semanticDedupTasks: Array<Promise<void>> = [];
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        const seenTitles = new Set<string>();
        const seenUrlKeys = new Set<string>();
        const phase1: typeof tierResults[typeof tier] = tierResults[tier].filter((p) => {
          // Exact title+retailer dedup
          const titleKey = `${(p.title || "").toLowerCase().trim()}|${(p.retailer || "").toLowerCase().trim()}`;
          if (seenTitles.has(titleKey)) return false;
          seenTitles.add(titleKey);
          // URL-based dedup: normalize URL to hostname+pathname (ignore query params)
          if (p.product_url) {
            try {
              const u = new URL(p.product_url);
              const urlKey = `${u.hostname}${u.pathname.replace(/\/+$/, "")}`;
              if (seenUrlKeys.has(urlKey)) return false;
              seenUrlKeys.add(urlKey);
            } catch { /* invalid URL, skip URL dedup */ }
          }
          return true;
        });
        extractedByCategory[category][tier] = phase1;

        // Phase 2: semantic dedup via LLM on what survived Phase 1.
        // Only worth calling when there are enough survivors to risk variants.
        if (phase1.length >= 4) {
          const items = phase1
            .filter((p) => (p.title || "").length > 4)
            .map((p) => ({ id: p.id, title: p.title || "", retailer: p.retailer ?? null }));
          if (items.length >= 4) {
            semanticDedupTasks.push(
              dedupProductTitlesLLM(items)
                .then((drop) => {
                  if (!drop || drop.size === 0) return;
                  extractedByCategory[category][tier] = phase1.filter((p) => !drop.has(p.id));
                  log.info("Semantic dedup removed duplicates", {
                    category, tier, removed: drop.size, before: phase1.length,
                  });
                })
                .catch(() => { /* fail-open: keep Phase 1 result */ })
            );
          }
        }
      }
    }
    if (semanticDedupTasks.length > 0) {
      await Promise.all(semanticDedupTasks);
    }

    reportStep({
      step: "Extracting product details from websites",
      status: "completed",
      data: { extracted: stats.totalExtracted },
    });

    // ═══════════════════════════════════════════════════════════
    // PHASE 5a: Quick score with Flash (batch, no images)
    //
    // Quick-score promises were kicked off after extraction in parallel
    // with CU fallback — dedup may have removed some products we scored,
    // but the resulting `quickScoresByProduct` map is keyed by id so
    // surviving entries are still valid. Products that survived dedup
    // but weren't scored yet (extracted post-kickoff? impossible by
    // construction) would be re-scored here — in practice the set is
    // empty and this await is instant.
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Quick-scoring all candidates", status: "running" });

    await Promise.all(earlyQuickScorePromises);

    // Safety net: score any products that somehow weren't included
    // (e.g., empty-at-kickoff categories that got backfilled). Normally
    // a no-op.
    const missingQuickScore: Record<string, CandidateProduct[]> = {};
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        for (const p of tierResults[tier]) {
          if (!quickScoresByProduct.has(p.id)) {
            (missingQuickScore[category] = missingQuickScore[category] || []).push(p);
          }
        }
      }
    }
    if (Object.keys(missingQuickScore).length > 0) {
      await Promise.all(
        Object.entries(missingQuickScore).map(async ([category, products]) => {
          const result = await quickScoreProducts(
            products, category, ctx.roomType, ctx.budgetMode, ctx.designDirection,
            ctx.placementMap?.[category], ctx.floorPlan,
            ctx.diagnosis as Record<string, unknown> | undefined,
            ctx.priorities, ctx.keepItems,
          );
          if (result.tokensUsed) {
            tokenBudget.add(result.tokensUsed);
            stats.tokensUsed += result.tokensUsed;
            stats.tokensPerPhase.quick_score += result.tokensUsed;
          }
          if (result.success && result.data) {
            for (const entry of result.data) {
              quickScoresByProduct.set(entry.productId, entry.quickScore);
              stats.totalQuickScored++;
            }
          }
        }),
      );
    }

    reportStep({
      step: "Quick-scoring all candidates",
      status: "completed",
      data: { quickScored: stats.totalQuickScored },
    });

    // Build anchorSpecs: top quick-scored product per anchor category.
    // Dependent categories (coffee_table, side_table, nightstand, area_rug,
    // etc.) will receive these specs so deep-scoring is grounded in the real
    // found anchor, not abstract requirements.
    const ANCHOR_CATEGORIES = new Set([
      "sofa", "sectional", "area_rug", "bed", "dining_table",
      "media_console", "accent_chair",
    ]);
    const DEPENDENT_CATEGORIES = new Set([
      "coffee_table", "side_table", "end_table", "nightstand",
      "floor_lamp", "table_lamp", "throw_pillows", "throw_blanket",
      "dining_chairs", "pendant_light",
    ]);

    const anchorSpecs: Record<string, string> = {};
    // Room-wide harmony neighbors: top pick per category (all categories,
    // not just anchors) so deep-score can factor cross-category clashes.
    const harmonyNeighbors: Array<{ category: string; spec: string }> = [];
    for (const [category, tierResults] of Object.entries(extractedByCategory)) {
      // Find the highest quick-scored product across all tiers for this category
      let bestProduct: CandidateProduct | null = null;
      let bestScore = -1;
      for (const tier of PRICE_TIERS) {
        for (const p of tierResults[tier]) {
          const qs = quickScoresByProduct.get(p.id) ?? 0;
          if (qs > bestScore) { bestScore = qs; bestProduct = p; }
        }
      }
      if (!bestProduct) continue;
      const dim = bestProduct.dimensions;
      const dimStr = dim
        ? [
            dim.width && `W:${dim.width}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.depth && `D:${dim.depth}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.height && `H:${dim.height}${dim.unit === "cm" ? "cm" : '"'}`,
            dim.diameter && `Ø:${dim.diameter}${dim.unit === "cm" ? "cm" : '"'}`,
          ].filter(Boolean).join("×")
        : "dimensions unknown";
      const matStr = bestProduct.materials?.join(", ") || "material unknown";
      const colStr = bestProduct.colors?.join(", ") || "colors unknown";
      const spec = `${bestProduct.title || category} | dimensions: ${dimStr} | material: ${matStr} | colors: ${colStr}`;
      // Compact neighbor summary (no title) to keep prompt tokens low
      const neighborSpec = `material: ${matStr} | colors: ${colStr}`;
      harmonyNeighbors.push({ category, spec: neighborSpec });
      if (ANCHOR_CATEGORIES.has(category)) {
        anchorSpecs[category] = spec;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 5b: Deep score top candidates with Pro (images, 8 dims)
    // ═══════════════════════════════════════════════════════════
    reportStep({ step: "Deep-scoring top candidates", status: "running" });

    const deepScoreLimit = pLimit(30);
    const deepScorePromises: Promise<void>[] = [];
    let totalToDeepScore = 0;

    for (const tierResults of Object.values(extractedByCategory)) {
      for (const tier of PRICE_TIERS) {
        let products = tierResults[tier];

        // Sort by quick score, keep top 8 per tier (or all if ≤8)
        products.sort((a, b) => {
          const scoreA = quickScoresByProduct.get(a.id) || 0;
          const scoreB = quickScoresByProduct.get(b.id) || 0;
          return (scoreB - scoreA) || tiebreakProduct(a, b);
        });

        // Filter out low-confidence products (quick score confidence < 4)
        // and products with no image — deep-score is vision-based, so a
        // null image_url means the LLM is scoring a blank prompt and
        // wasting tokens on a product it can't evaluate.
        products = products.filter((p) => {
          const qs = quickScoresByProduct.get(p.id);
          if (qs !== undefined && qs < 4) {
            tracer.traceFilter("quick_score", p.id, p.product_url || "", `quickScore ${qs} < 4`);
            return false;
          }
          if (!p.image_url) {
            tracer.traceFilter("quick_score", p.id, p.product_url || "", "no image_url");
            return false;
          }
          return true;
        });

        // Tier early-exit: if 3+ products already pass the 6.0 bar, deep-
        // score only those (max 5). Otherwise fall back to top-8 to give
        // sparse tiers a chance. Saves 40–60% of deep-score tokens on
        // healthy tiers where we've already found enough winners.
        const passThreshold = products.filter((p) => (quickScoresByProduct.get(p.id) || 0) >= 6);
        const topN = products.slice(0, 8);
        const toScore = passThreshold.length >= 3 ? passThreshold.slice(0, 5) : topN;
        totalToDeepScore += toScore.length;

        // Batch all products in this (cat, tier) into a single LLM call
        // (up to 3 per call). Products in the same (cat, tier) share
        // identical context, room images, anchor specs, and harmony
        // neighbors — so batching is safe and amortizes ~2500 tokens of
        // shared context per additional product.
        if (toScore.length === 0) continue;
        const productCategory = toScore[0].category || "";
        const batchCtx = {
          roomType: ctx.roomType,
          budgetMode: ctx.budgetMode,
          existingItems: ctx.keepItems,
          roomImageUrls: ctx.imageUrls,
          priorities: ctx.priorities,
          otherRoomsContext: ctx.otherRoomsContext,
          designProfile: ctx.designProfile,
          diagnosis: ctx.diagnosis,
          designDirection: ctx.designDirection,
          userFeedbackContext: ctx.userFeedbackContext,
          placement: ctx.placementMap?.[productCategory],
          spatialLayout: ctx.spatialLayout,
          floorPlan: ctx.floorPlan,
          extractedFloorPlan: ctx.extractedFloorPlan,
          lightingConditions: ctx.lightingConditions,
          windowDoorPositions: ctx.windowDoorPositions,
          outletPositions: ctx.outletPositions,
          userContext: ctx.userContext,
          replaceItems: ctx.replaceItems,
          identifiedContext: ctx.identifiedContext,
          anchorSpecs: DEPENDENT_CATEGORIES.has(productCategory) && Object.keys(anchorSpecs).length > 0
            ? anchorSpecs
            : undefined,
          harmonyNeighbors: harmonyNeighbors.filter((n) => n.category !== productCategory),
          includeFitNotes: false,
        };

        deepScorePromises.push(
          deepScoreLimit(async () => {
            if (tokenBudget.exceeded) {
              for (const p of toScore) {
                tracer.traceFilter("deep_score", p.id, p.product_url || "", "token budget exceeded");
              }
              return;
            }

            const { results: batchScores, tokensUsed } = await scoreProducts(toScore, batchCtx, 3);
            if (tokensUsed) {
              tokenBudget.add(tokensUsed);
              stats.tokensUsed += tokensUsed;
              stats.tokensPerPhase.deep_score += tokensUsed;
            }
            for (const product of toScore) {
              const scoreResult = batchScores.get(product.id);
              if (scoreResult?.success && scoreResult.data) {
                evaluations.set(product.id, scoreResult.data);
                stats.totalDeepScored++;
                tracer.traceScore("deep_score", product.id, scoreResult.data.final_item_score, { verdict: scoreResult.data.verdict });
              }
            }
            reportStep({
              step: "Deep-scoring top candidates",
              status: "running",
              data: { deepScored: stats.totalDeepScored, total: totalToDeepScore },
            });
          })
        );
      }
    }

    await Promise.all(deepScorePromises);

    // Progressive degradation: if budget is tight, shed expensive phases
    // instead of aborting entirely.
    const budgetPct = tokenBudget.used / tokenBudget.cap;
    const skipPairwise = budgetPct > 0.85;
    const skipBackfill = budgetPct > 0.75;
    if (skipPairwise) {
      log.info("Budget >85% — skipping pairwise re-rank to preserve budget for validation/bundling", {
        tokensUsed: stats.tokensUsed, budgetPct: Math.round(budgetPct * 100),
      });
      (stats as Record<string, unknown>).bottlenecks = [...((stats as Record<string, unknown>).bottlenecks as string[] || []), "Pairwise re-rank skipped (budget conservation)"];
    }
    if (skipBackfill) {
      log.info("Budget >75% — skipping backfill to preserve budget for validation/bundling", {
        tokensUsed: stats.tokensUsed, budgetPct: Math.round(budgetPct * 100),
      });
    }

    if (tokenBudget.exceeded) {
      log.warn("Token budget fully exceeded — returning scored results", { tokensUsed: stats.tokensUsed, tokenCap: DEFAULT_TOKEN_CAP, deepScored: stats.totalDeepScored });
      reportStep({ step: "Token budget exceeded — returning scored results", status: "completed" });

      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        const kept: CandidateProduct[] = [];
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => evaluations.has(p.id));
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          kept.push(...products.slice(0, 5));
        }
        if (kept.length > 0) candidatesByCategory[category] = kept;
        stats.totalFinal += kept.length;
      }

      return {
        success: true,
        data: {
          searchBrief: brief,
          candidatesByCategory,
          evaluations,
          bundles: [],
          steps,
          stats: { ...stats, bottlenecks: [...((stats as Record<string, unknown>).bottlenecks as string[] || []), "Token budget exceeded before validation/bundling — partial results returned"] },
          trace: tracer.getTrace(),
        },
      };
    }

    reportStep({
      step: "Deep-scoring top candidates",
      status: "completed",
      data: { deepScored: stats.totalDeepScored },
    });

    // ═══════════════════════════════════════════════════════════
    // Phase 5c: Pairwise re-rank top-scored products per category
    // ═══════════════════════════════════════════════════════════
    if (skipPairwise) {
      reportStep({ step: "Pairwise re-ranking skipped (budget conservation)", status: "completed" });
    }
    if (!skipPairwise) reportStep({ step: "Pairwise re-ranking top candidates", status: "running" });

    const pairwiseRerankedByCategory: Record<string, Record<PriceTier, CandidateProduct[]>> = {};

    if (!skipPairwise) {
      const pairwisePromises: Promise<void>[] = [];

      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        pairwiseRerankedByCategory[category] = {
          budget: [], balanced: [], high_end: [],
        } as Record<PriceTier, CandidateProduct[]>;
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => {
            const ev = evaluations.get(p.id);
            if (!ev) return false;
            if (ev.scores?.confidence_score !== undefined && ev.scores.confidence_score < 4) return false;
            return true;
          });
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          if (products.length === 0) continue;

          // Early termination: if the top-3 deep scores are well-separated
          // (each gap > 1.5 points), pairwise won't change the order — skip
          // the LLM call and use the deep-score ordering directly.
          if (products.length >= 3) {
            const s0 = evaluations.get(products[0].id)?.final_item_score || 0;
            const s1 = evaluations.get(products[1].id)?.final_item_score || 0;
            const s2 = evaluations.get(products[2].id)?.final_item_score || 0;
            if (s0 - s1 > 1.5 && s1 - s2 > 1.5) {
              pairwiseRerankedByCategory[category][tier] = products;
              log.debug("Skipping pairwise (high score separation)", {
                category, tier, topScores: [s0, s1, s2],
              });
              continue;
            }
          }

          pairwisePromises.push(
            (async () => {
              if (tokenBudget.exceeded) {
                pairwiseRerankedByCategory[category][tier] = products;
                return;
              }
              const reranked = await pairwiseRerank(products, evaluations, {
                roomType: ctx.roomType,
                category,
                designDirection: ctx.designDirection?.style_notes,
                palette: ctx.designDirection?.recommended_palette,
                existingItems: ctx.keepItems,
              });
              pairwiseRerankedByCategory[category][tier] = reranked;
            })()
          );
        }
      }
      await Promise.all(pairwisePromises);
      reportStep({ step: "Pairwise re-ranking top candidates", status: "completed" });
    } else {
      // Skipped pairwise — use deep-scored products directly, sorted by score
      for (const [category, tierResults] of Object.entries(extractedByCategory)) {
        pairwiseRerankedByCategory[category] = { budget: [], balanced: [], high_end: [] } as Record<PriceTier, CandidateProduct[]>;
        for (const tier of PRICE_TIERS) {
          const products = tierResults[tier].filter((p) => evaluations.has(p.id));
          products.sort((a, b) => {
            const scoreA = evaluations.get(a.id)?.final_item_score || 0;
            const scoreB = evaluations.get(b.id)?.final_item_score || 0;
            return (scoreB - scoreA) || tiebreakProduct(a, b);
          });
          pairwiseRerankedByCategory[category][tier] = products;
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 5d: MMR diversity selection + final organization
    //
    // After pairwise re-ranking, top-k products can still be redundant (same
    // retailer, material, color). MMR picks 5 that balance relevance and
    // diversity — λ=0.7 favors relevance but penalizes near-duplicates.
    // ═══════════════════════════════════════════════════════════
    const alsoConsidered: Record<string, CandidateProduct[]> = {};

    for (const [category, tierResults] of Object.entries(pairwiseRerankedByCategory)) {
      const kept: CandidateProduct[] = [];
      const alternatives: CandidateProduct[] = [];

      for (const tier of PRICE_TIERS) {
        const products = tierResults[tier];
        if (products.length === 0) continue;

        // MMR diversity selection for top 5
        const diverse = selectByMMR(products, evaluations, 5, 0.7);
        kept.push(...diverse);

        // "Also considered": the rest, ordered by pairwise rank (already sorted)
        const diverseIds = new Set(diverse.map((p) => p.id));
        const remaining = products.filter((p) => !diverseIds.has(p.id));
        alternatives.push(...remaining.slice(0, 15));
      }

      candidatesByCategory[category] = kept;
      if (alternatives.length > 0) {
        alsoConsidered[category] = alternatives;
      }
      stats.totalFinal += kept.length;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 6: Validate + generate bundles (in parallel)
    //
    // Validation returns harmony flags that drop or penalize products;
    // bundle generation scores candidate combos. These are independent
    // LLM calls — run them concurrently. After both settle, apply drops
    // to the candidate set, filter bundle combos that reference dropped
    // products, and pick winners from the surviving scored combos.
    // Vibe narration only runs on the winning combo (sequential, cheap).
    // ═══════════════════════════════════════════════════════════
    const allProducts = Object.values(candidatesByCategory).flat();
    reportStep({
      step: "Validating all recommendations",
      status: "running",
      data: { progress: 0, total: allProducts.length || 1 },
    });
    reportStep({ step: "Generating bundles", status: "running", data: { progress: 0, total: PRICE_TIERS.length } });

    const validationPromise = validateProductSet(
      allProducts.map((p) => {
        const pMeta = p.metadata as Record<string, unknown> | null;
        return {
          title: p.title || "Unknown",
          category: p.category || "unknown",
          tier: ((pMeta?.price_tier as string) || "balanced"),
          materials: p.materials || undefined,
          colors: p.colors || undefined,
          price: p.price || undefined,
          description: p.description || undefined,
          image_url: p.image_url,
          dimensions: p.dimensions || undefined,
          visual_style_tags: (pMeta?.visual_style_tags as string[]) || undefined,
        };
      }),
      {
        roomType: ctx.roomType,
        designDirection: ctx.designDirection?.style_notes || "Based on apartment photos and building context",
        existingItems: ctx.keepItems,
        roomImageUrls: ctx.imageUrls,
        designProfile: ctx.designProfile,
        placementMap: ctx.placementMap,
        spatialLayout: ctx.spatialLayout,
        floorPlan: ctx.floorPlan,
        lightingConditions: ctx.lightingConditions,
        windowDoorPositions: ctx.windowDoorPositions,
        outletPositions: ctx.outletPositions,
        priorities: ctx.priorities,
        userContext: ctx.userContext,
        replaceItems: ctx.replaceItems,
        whatShouldGo: ctx.whatShouldGo,
        identifiedContext: ctx.identifiedContext,
        diagnosis: ctx.diagnosis,
        whatItNeeds: ctx.whatItNeeds,
      }
    );

    const bundles: unknown[] = [];
    let bundleTiersCompleted = 0;

    const bundleCtx = {
      roomType: ctx.roomType,
      roomImageUrls: ctx.imageUrls,
      priorities: ctx.priorities,
      existingItems: ctx.keepItems,
      designProfile: ctx.designProfile,
      diagnosis: ctx.diagnosis,
      designDirection: ctx.designDirection,
      spatialLayout: ctx.spatialLayout,
      placementMap: ctx.placementMap,
      floorPlan: ctx.floorPlan,
      extractedFloorPlan: ctx.extractedFloorPlan,
      lightingConditions: ctx.lightingConditions,
      windowDoorPositions: ctx.windowDoorPositions,
      outletPositions: ctx.outletPositions,
      userContext: ctx.userContext,
      replaceItems: ctx.replaceItems,
      whatShouldGo: ctx.whatShouldGo,
      identifiedContext: ctx.identifiedContext,
    };

    // Bundle combo scoring — returns ALL scored combos per tier (no winner
    // pick yet). Winner selection is deferred until validation finalizes
    // so dropped products can be filtered out of the combo pool before
    // we pick the best surviving combo. This keeps validation & bundle
    // eval fully parallel while preserving correctness.
    type ComboResult = {
      products: CandidateProduct[];
      scores: unknown;
      final_bundle_score: number;
      verdict: string;
      analysis: unknown;
    };

    const bundleComboPromises = PRICE_TIERS.map(async (tier): Promise<{ tier: PriceTier; validResults: ComboResult[] } | null> => {
      const topByCategory: CandidateProduct[][] = [];
      for (const products of Object.values(candidatesByCategory)) {
        const tierFiltered = products.filter(
          (p) => (p.metadata as { price_tier: string })?.price_tier === tier
        );
        tierFiltered.sort((a, b) => {
          const scoreA = evaluations.get(a.id)?.final_item_score || 0;
          const scoreB = evaluations.get(b.id)?.final_item_score || 0;
          return (scoreB - scoreA) || tiebreakProduct(a, b);
        });
        if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
      }

      if (topByCategory.length === 0) return null;

      let combos = cartesian(topByCategory);

      if (combos.length > 27) {
        combos.sort((a, b) => {
          const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
          const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
          return (avgB - avgA) || tiebreakBundle(a, b);
        });
        combos = combos.slice(0, 27);
      }

      const prefiltered = prefilterBundleCombos(combos, bundleCtx);
      if (prefiltered.dropped > 0) {
        log.info("Bundle prefilter dropped combos", {
          tier, before: combos.length, after: prefiltered.kept.length,
          dropped: prefiltered.dropped, reasons: prefiltered.reasons,
        });
      }
      combos = prefiltered.kept;

      const bundleEvalLimit = pLimit(20);
      const comboResults = await Promise.all(
        combos.map((combo) =>
          bundleEvalLimit(async () => {
            if (tokenBudget.exceeded) return null;
            const result = await evaluateBundle(combo, bundleCtx, { skipVibe: true });
            if (result.tokensUsed) { tokenBudget.add(result.tokensUsed); stats.tokensUsed += result.tokensUsed; stats.tokensPerPhase.bundle += result.tokensUsed; }
            if (result.success && result.data) {
              return { products: combo, ...result.data } as ComboResult;
            }
            return null;
          })
        )
      );

      const validResults = comboResults.filter(Boolean) as ComboResult[];

      bundleTiersCompleted++;
      reportStep({
        step: "Generating bundles",
        status: "running",
        data: { progress: bundleTiersCompleted, total: PRICE_TIERS.length },
      });

      return { tier, validResults };
    });

    // Run validation + bundle combo eval concurrently.
    const [validationResult, bundleComboByTier] = await Promise.all([
      validationPromise,
      Promise.all(bundleComboPromises),
    ]);

    if (validationResult.tokensUsed) {
      tokenBudget.add(validationResult.tokensUsed);
      stats.tokensUsed += validationResult.tokensUsed;
      stats.tokensPerPhase.validation += validationResult.tokensUsed;
    }

    // Apply validation drops/penalties to the candidate set BEFORE winner selection
    // so bundle winners don't reference products that will be removed from the UI.
    const droppedProductTitles = new Set<string>();
    let validationData: { isValid: boolean; confidence: number; issues: string[] } | undefined;
    if (validationResult.success && validationResult.data) {
      validationData = {
        isValid: validationResult.data.isValid,
        confidence: validationResult.data.confidence,
        issues: validationResult.data.issues,
      };

      const flags = validationResult.data.product_flags;
      if (flags && flags.length > 0) {
        const clashingProducts = flags.filter((f) => f.harmony_score <= 3);
        const weakProducts = flags.filter((f) => f.harmony_score >= 4 && f.harmony_score <= 5);

        for (const flag of clashingProducts) {
          droppedProductTitles.add(flag.title.toLowerCase());
          for (const [category, products] of Object.entries(candidatesByCategory)) {
            const idx = products.findIndex(
              (p) => p.title?.toLowerCase() === flag.title.toLowerCase()
            );
            if (idx !== -1) {
              log.info(`Removing "${flag.title}" — harmony ${flag.harmony_score}/10`, { phase: "validation", title: flag.title, harmonyScore: flag.harmony_score, reason: flag.reason });
              tracer.traceFilter("validation", products[idx].id, products[idx].product_url || "", `harmony ${flag.harmony_score}/10: ${flag.reason}`);
              candidatesByCategory[category].splice(idx, 1);
              stats.totalFinal--;
            }
          }
        }

        for (const flag of weakProducts) {
          for (const products of Object.values(candidatesByCategory)) {
            const product = products.find(
              (p) => p.title?.toLowerCase() === flag.title.toLowerCase()
            );
            if (product) {
              const existing = evaluations.get(product.id);
              if (existing) {
                const penalty = (5 - flag.harmony_score) * 0.5;
                const penalized = Math.max(0, existing.final_item_score - penalty);
                log.info(`Penalizing "${flag.title}"`, { phase: "validation", title: flag.title, penalty, harmonyScore: flag.harmony_score, before: existing.final_item_score, after: penalized });
                evaluations.set(product.id, { ...existing, final_item_score: penalized });
              }
            }
          }
        }

        if (clashingProducts.length > 0 || weakProducts.length > 0) {
          log.info("Validation enforcement complete", { phase: "validation", dropped: clashingProducts.length, penalized: weakProducts.length });
        }
      }

      reportStep({ step: "Validating all recommendations", status: "completed", data: validationData });
    } else {
      reportStep({ step: "Validating all recommendations", status: "failed" });
    }

    // Finalize bundle winners — filter combos that reference dropped products,
    // pick the top survivor per tier, then generate the vibe narrative for
    // winners only. Vibe is cheap (3 calls) and must be sequential after
    // winner selection.
    for (const tierBundle of bundleComboByTier) {
      if (!tierBundle) continue;
      const { tier, validResults } = tierBundle;
      const surviving = droppedProductTitles.size > 0
        ? validResults.filter((r) =>
            !r.products.some((p) => droppedProductTitles.has((p.title || "").toLowerCase())),
          )
        : validResults;
      if (surviving.length === 0) continue;

      surviving.sort((a, b) => (b.final_bundle_score - a.final_bundle_score) || tiebreakBundle(a.products, b.products));
      const best = surviving[0];
      for (const r of surviving) {
        tracer.trace({ phase: "bundle", action: "evaluated", tier, score: r.final_bundle_score, metadata: { verdict: r.verdict } });
      }
      tracer.trace({ phase: "bundle", action: "selected", tier, score: best.final_bundle_score, metadata: { product_ids: best.products.map((p) => p.id) } });

      let roomVibe: unknown = undefined;
      if (!tokenBudget.exceeded) {
        const vibeRes = await generateBundleVibe(best.products, bundleCtx, best.verdict);
        if (vibeRes.tokensUsed) { tokenBudget.add(vibeRes.tokensUsed); stats.tokensUsed += vibeRes.tokensUsed; stats.tokensPerPhase.bundle += vibeRes.tokensUsed; }
        if (vibeRes.success && vibeRes.data) roomVibe = vibeRes.data.room_vibe;
      }

      bundles.push({
        tier,
        scores: best.scores,
        final_bundle_score: best.final_bundle_score,
        verdict: best.verdict,
        analysis: best.analysis,
        room_vibe: roomVibe,
        product_ids: best.products.map((p) => p.id),
        combos_evaluated: surviving.length,
      });
    }
    reportStep({ step: "Generating bundles", status: "completed", data: { bundles: bundles.length } });

    // ═══════════════════════════════════════════════════════════
    // Backfill weak tiers
    // ═══════════════════════════════════════════════════════════
    const weakTiers: Array<{ category: string; tier: PriceTier }> = [];
    // Dynamic backfill trigger — derived from this run's score distribution.
    // Replaces hardcoded `score >= 7` and `< 2 strong` with values that
    // adapt to the scoring model's actual behavior this run.
    const allDeepScores: number[] = [];
    for (const products of Object.values(candidatesByCategory)) {
      for (const p of products) {
        const s = evaluations.get(p.id)?.final_item_score;
        if (s !== undefined) allDeepScores.push(s);
      }
    }
    const dynamicStrongThreshold = getStrongProductThreshold(allDeepScores);
    log.info("Dynamic strong-product threshold", {
      phase: "backfill",
      threshold: dynamicStrongThreshold,
      sampleSize: allDeepScores.length,
    });

    for (const [category, products] of Object.entries(candidatesByCategory)) {
      for (const tier of PRICE_TIERS) {
        const tierProducts = products.filter(
          (p) => (p.metadata as { price_tier: string })?.price_tier === tier
        );
        const strongProducts = tierProducts.filter(
          (p) => (evaluations.get(p.id)?.final_item_score || 0) >= dynamicStrongThreshold
        );
        // Required count is also distribution-derived: scales with how many
        // products this category has overall (sparse categories need fewer
        // strong picks to call it done).
        const requiredStrong = getBackfillThreshold(products.length);
        if (strongProducts.length < requiredStrong) {
          weakTiers.push({ category, tier });
        }
      }
    }

    if (weakTiers.length > 0 && !tokenBudget.exceeded && !skipBackfill) {
      reportStep({
        step: `Backfilling ${weakTiers.length} weak tier(s)`,
        status: "running",
        data: { weakTiers: weakTiers.map((t) => `${t.category}/${t.tier}`) },
      });

      // Track tiers that actually received new strong products; only THOSE
      // tiers need bundle re-evaluation. Previously every weak tier was
      // re-evaluated even if backfill produced nothing, burning ~20-30K
      // tokens on already-known bundles.
      const tiersWithNewProducts = new Set<PriceTier>();

      // Run targeted backfill searches for weak tiers
      const backfillSearchLimit = pLimit(30);
      const backfillPromises = weakTiers.map((wt) =>
        backfillSearchLimit(async () => {
          const styleHint = ctx.designDirection?.style_notes || "modern apartment";
          const backfillQuery = `best ${wt.category} for ${styleHint} ${TIER_LABELS[wt.tier]} price ${new Date().getFullYear()}`;
          const searchResult = await searchProducts(backfillQuery, 10, wt.tier, wt.category, ctx.imageUrls);
          if (!searchResult.success || !searchResult.data) return;

          const filtered = searchResult.data.filter((c) => c.url && isLikelyProductUrl(c.url));
          const deduped = deduplicateCandidates(filtered);

          // Phase 1 — extract top 5 backfill candidates in parallel.
          const extracted: CandidateProduct[] = [];
          for (const candidate of deduped.slice(0, 5)) {
            try {
              const extractResult = await extractFromUrl(candidate.url, ctx.designProfile, ctx.imageUrls);
              if (!extractResult.success || !extractResult.data) continue;
              if (!extractResult.data.title && !extractResult.data.price) continue;

              const catCheck = await productMatchesCategoryAsync(
                wt.category,
                extractResult.data.category,
                extractResult.data.title,
              );
              if (!catCheck.ok) {
                tracer.traceFilter("extract", "", candidate.url, `backfill category mismatch: ${catCheck.reason}`);
                continue;
              }

              extracted.push({
                id: crypto.randomUUID(),
                room_id: ctx.roomId,
                search_session_id: null,
                title: extractResult.data.title || candidate.title,
                category: extractResult.data.category || wt.category,
                retailer: extractResult.data.retailer || candidate.source,
                product_url: candidate.url,
                image_url: extractResult.data.image_url,
                local_image_path: null,
                price: extractResult.data.price,
                dimensions: extractResult.data.dimensions,
                materials: extractResult.data.materials,
                colors: extractResult.data.colors,
                description: extractResult.data.description,
                source_type: "agentic_search",
                metadata: {
                  price_tier: wt.tier,
                  backfill: true,
                  lifestyle_image_url: extractResult.data.lifestyle_image_url || null,
                  visual_style_tags: extractResult.data.visual_style_tags || [],
                  available_variants: extractResult.data.available_variants || [],
                },
                status: "pending",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            } catch {
              // Skip failed backfill extractions
            }
          }

          if (extracted.length === 0) return;

          // Phase 2 — quick-score to filter out obvious duds BEFORE paying the
          // deep-score cost. Mirrors the main-path screening gate.
          const backfillCategory = extracted[0]?.category || wt.category;
          const quickRes = await quickScoreProducts(
            extracted,
            backfillCategory,
            ctx.roomType,
            ctx.budgetMode,
            ctx.designDirection,
            ctx.placementMap?.[backfillCategory],
            ctx.floorPlan,
            ctx.diagnosis as Record<string, unknown> | undefined,
            ctx.priorities,
            ctx.keepItems,
          );
          if (quickRes.tokensUsed) {
            tokenBudget.add(quickRes.tokensUsed);
            stats.tokensUsed += quickRes.tokensUsed;
            stats.tokensPerPhase.quick_score += quickRes.tokensUsed;
          }
          const quickScoreByProductId = new Map<string, number>();
          if (quickRes.success && quickRes.data) {
            for (const entry of quickRes.data) {
              quickScoreByProductId.set(entry.productId, entry.quickScore);
            }
          }

          const QUICK_SCORE_GATE = 4.0;
          const survivors = extracted.filter((p) => {
            const qs = quickScoreByProductId.get(p.id);
            // If quick-score failed entirely, keep the product (fail-open).
            return qs === undefined || qs >= QUICK_SCORE_GATE;
          });

          // Phase 3 — batch deep-score the survivors. All survivors in
          // this backfill share the weak tier's category, so one scoring
          // context works for the whole batch.
          if (survivors.length > 0) {
            const cat = wt.category;
            const { results: batchScores, tokensUsed } = await scoreProducts(survivors, {
              roomType: ctx.roomType,
              budgetMode: ctx.budgetMode,
              existingItems: ctx.keepItems,
              roomImageUrls: ctx.imageUrls,
              priorities: ctx.priorities,
              otherRoomsContext: ctx.otherRoomsContext,
              designProfile: ctx.designProfile,
              diagnosis: ctx.diagnosis,
              designDirection: ctx.designDirection,
              userFeedbackContext: ctx.userFeedbackContext,
              placement: ctx.placementMap?.[cat],
              spatialLayout: ctx.spatialLayout,
              floorPlan: ctx.floorPlan,
              extractedFloorPlan: ctx.extractedFloorPlan,
              lightingConditions: ctx.lightingConditions,
              windowDoorPositions: ctx.windowDoorPositions,
              outletPositions: ctx.outletPositions,
              userContext: ctx.userContext,
              replaceItems: ctx.replaceItems,
              identifiedContext: ctx.identifiedContext,
              anchorSpecs: DEPENDENT_CATEGORIES.has(cat) && Object.keys(anchorSpecs).length > 0
                ? anchorSpecs
                : undefined,
              harmonyNeighbors: harmonyNeighbors.filter((n) => n.category !== cat),
              includeFitNotes: false,
            }, 3);
            if (tokensUsed) {
              tokenBudget.add(tokensUsed);
              stats.tokensUsed += tokensUsed;
              stats.tokensPerPhase.deep_score += tokensUsed;
            }
            for (const product of survivors) {
              const scoreResult = batchScores.get(product.id);
              if (scoreResult?.success && scoreResult.data) {
                evaluations.set(product.id, scoreResult.data);
                stats.totalDeepScored++;
                const dynamicKeepFloor = getDeepScoreKeepFloor(allDeepScores);
                if (scoreResult.data.final_item_score >= dynamicKeepFloor) {
                  candidatesByCategory[wt.category] = candidatesByCategory[wt.category] || [];
                  candidatesByCategory[wt.category].push(product);
                  stats.totalFinal++;
                  tiersWithNewProducts.add(wt.tier);
                }
              }
            }
          }
        })
      );

      await Promise.all(backfillPromises);
      reportStep({ step: `Backfilling ${weakTiers.length} weak tier(s)`, status: "completed" });

      // Re-run bundle evaluation only for tiers that actually received new
      // strong products (not just every tier we tried to backfill).
      if (!tokenBudget.exceeded && tiersWithNewProducts.size > 0) {
        const backfilledTiers = tiersWithNewProducts;
        reportStep({ step: "Re-evaluating bundles after backfill", status: "running" });

        for (const tier of backfilledTiers) {
          const topByCategory: CandidateProduct[][] = [];
          for (const products of Object.values(candidatesByCategory)) {
            const tierFiltered = products.filter(
              (p) => (p.metadata as { price_tier: string })?.price_tier === tier
            );
            tierFiltered.sort((a, b) => {
              const scoreA = evaluations.get(a.id)?.final_item_score || 0;
              const scoreB = evaluations.get(b.id)?.final_item_score || 0;
              return (scoreB - scoreA) || tiebreakProduct(a, b);
            });
            if (tierFiltered.length > 0) topByCategory.push(tierFiltered.slice(0, 3));
          }

          if (topByCategory.length === 0) continue;

          let combos = cartesian(topByCategory);
          // Incremental re-eval: only evaluate combos containing ≥1 new
          // backfill product — the rest were already scored in the main pass
          // and their bundle scores haven't changed.
          const backfillOnly = combos.filter((combo) =>
            combo.some((p) => (p.metadata as { backfill?: boolean } | null)?.backfill === true)
          );
          if (backfillOnly.length > 0) combos = backfillOnly;
          if (combos.length > 27) {
            combos.sort((a, b) => {
              const avgA = a.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / a.length;
              const avgB = b.reduce((s, p) => s + (evaluations.get(p.id)?.final_item_score || 0), 0) / b.length;
              return (avgB - avgA) || tiebreakBundle(a, b);
            });
            combos = combos.slice(0, 27);
          }

          // Deterministic pre-filter (math + retailer dominance) before LLM eval.
          const prefiltered2 = prefilterBundleCombos(combos, bundleCtx);
          if (prefiltered2.dropped > 0) {
            log.info("Backfill bundle prefilter dropped combos", {
              tier, before: combos.length, after: prefiltered2.kept.length,
              dropped: prefiltered2.dropped, reasons: prefiltered2.reasons,
            });
          }
          combos = prefiltered2.kept;

          const bundleEvalLimit2 = pLimit(20);
          const comboResults = await Promise.all(
            combos.map((combo) =>
              bundleEvalLimit2(async () => {
                if (tokenBudget.exceeded) return null;
                const result = await evaluateBundle(combo, bundleCtx, { skipVibe: true });
                if (result.tokensUsed) { tokenBudget.add(result.tokensUsed); stats.tokensUsed += result.tokensUsed; }
                if (result.success && result.data) {
                  return { products: combo, ...result.data };
                }
                return null;
              })
            )
          );

          const validResults = comboResults.filter(Boolean) as Array<{
            products: CandidateProduct[];
            scores: unknown;
            final_bundle_score: number;
            verdict: string;
            analysis: unknown;
          }>;

          if (validResults.length > 0) {
            validResults.sort((a, b) => (b.final_bundle_score - a.final_bundle_score) || tiebreakBundle(a.products, b.products));
            const best = validResults[0];

            // Incremental guard: keep the prior bundle if no new combo beats it.
            // Avoids wasting vibe tokens when backfill produced no improvement.
            const existingIdx = bundles.findIndex((b) => (b as { tier: string }).tier === tier);
            const prior = existingIdx >= 0 ? (bundles[existingIdx] as { final_bundle_score?: number }) : null;
            const priorScore = prior?.final_bundle_score ?? 0;
            if (best.final_bundle_score <= priorScore) {
              tracer.trace({ phase: "bundle", action: "backfill_reeval_noop", tier, score: best.final_bundle_score });
              continue;
            }

            // Vibe for the winner only
            let roomVibe: unknown = undefined;
            if (!tokenBudget.exceeded) {
              const vibeRes = await generateBundleVibe(best.products, bundleCtx, best.verdict);
              if (vibeRes.tokensUsed) { tokenBudget.add(vibeRes.tokensUsed); stats.tokensUsed += vibeRes.tokensUsed; }
              if (vibeRes.success && vibeRes.data) roomVibe = vibeRes.data.room_vibe;
            }

            const newBundle = {
              tier,
              scores: best.scores,
              final_bundle_score: best.final_bundle_score,
              verdict: best.verdict,
              analysis: best.analysis,
              room_vibe: roomVibe,
              product_ids: best.products.map((p) => p.id),
              combos_evaluated: validResults.length,
              backfill_reeval: true,
            };
            if (existingIdx >= 0) {
              bundles[existingIdx] = newBundle;
            } else {
              bundles.push(newBundle);
            }
            tracer.trace({ phase: "bundle", action: "backfill_reeval", tier, score: best.final_bundle_score });
          }
        }

        reportStep({ step: "Re-evaluating bundles after backfill", status: "completed" });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Phase 7b: Fill empty (category × tier) cells so the UI grid
    // never has a dash. Opt-in via ctx.fillAllTiers (default true
    // from the streaming route). Pulls from alsoConsidered first,
    // then borrows from adjacent tiers. Marks borrowed picks so
    // the UI can flag them as "best available" rather than an
    // in-tier recommendation.
    // ═══════════════════════════════════════════════════════════
    if (ctx.fillAllTiers !== false) {
      const PRICE_TIERS_LOCAL: PriceTier[] = ["budget", "balanced", "high_end"];
      const adjacentTiers: Record<PriceTier, PriceTier[]> = {
        budget: ["balanced", "high_end"],
        balanced: ["budget", "high_end"],
        high_end: ["balanced", "budget"],
      };

      let filledCount = 0;
      for (const category of Object.keys(candidatesByCategory)) {
        const products = candidatesByCategory[category] || [];
        const byTier: Record<PriceTier, CandidateProduct[]> = {
          budget: [], balanced: [], high_end: [],
        };
        for (const p of products) {
          const tier = ((p.metadata as { price_tier?: string } | null)?.price_tier as PriceTier) || "balanced";
          if (byTier[tier]) byTier[tier].push(p);
        }

        for (const tier of PRICE_TIERS_LOCAL) {
          if (byTier[tier].length > 0) continue;

          const pickBest = (pool: CandidateProduct[]): CandidateProduct | null => {
            const scored = pool
              .filter((p) => evaluations.has(p.id))
              .sort((a, b) => {
                const sa = evaluations.get(a.id)?.final_item_score || 0;
                const sb = evaluations.get(b.id)?.final_item_score || 0;
                return (sb - sa) || tiebreakProduct(a, b);
              });
            return scored[0] || null;
          };

          let fill: CandidateProduct | null = null;
          let fillSource: "also_considered" | "adjacent_tier" | null = null;

          const alsoInTier = (alsoConsidered[category] || []).filter(
            (p) => ((p.metadata as { price_tier?: string } | null)?.price_tier || "balanced") === tier,
          );
          fill = pickBest(alsoInTier);
          if (fill) fillSource = "also_considered";

          if (!fill) {
            for (const adj of adjacentTiers[tier]) {
              const adjCandidates = [...byTier[adj], ...((alsoConsidered[category] || []).filter(
                (p) => ((p.metadata as { price_tier?: string } | null)?.price_tier || "balanced") === adj,
              ))];
              const adjBest = pickBest(adjCandidates);
              if (adjBest) {
                fill = { ...adjBest, metadata: { ...(adjBest.metadata as Record<string, unknown> || {}), price_tier: tier, fill_source: "adjacent_tier", fill_origin_tier: adj } } as CandidateProduct;
                fillSource = "adjacent_tier";
                break;
              }
            }
          }

          if (fill) {
            if (fillSource === "also_considered" && fill.metadata) {
              fill = { ...fill, metadata: { ...(fill.metadata as Record<string, unknown>), fill_source: "also_considered" } } as CandidateProduct;
            }
            candidatesByCategory[category].push(fill);
            filledCount++;
          }
        }
      }

      if (filledCount > 0) {
        log.info("Filled empty category×tier cells", { phase: "fill_tiers", count: filledCount });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Post-search audit + agentic self-correction loop.
    // 1. Run LLM audit of coverage, spec adherence, diagnosis-solving.
    // 2. If alignment < 8 or gaps found, call CorrectionPlanner to
    //    decide what to do (re-search specific categories with new
    //    queries, drop unreachable categories, or accept).
    // 3. Execute actions, re-audit. NO artificial iteration cap — the
    //    loop runs until the planner returns iterate_again=false, the
    //    alignment target is met, or the token budget is exhausted.
    //    A high SAFETY_CORRECTION_LIMIT exists only to prevent runaway
    //    in case of a planner bug (effectively never the binding limit).
    // Fails open at every step.
    // ═══════════════════════════════════════════════════════════
    const SAFETY_CORRECTION_LIMIT = 50;
    const ALIGNMENT_TARGET = 8.0;
    const triedQueriesByCategory: Record<string, string[]> = {};

    // Seed tried queries from the initial brief so the correction planner
    // doesn't just regenerate the same queries.
    for (const catBrief of brief.categories) {
      const qs: string[] = [];
      for (const tier of PRICE_TIERS) {
        const tierBrief = catBrief.tiers[tier];
        if (tierBrief?.search_queries) {
          for (const q of tierBrief.search_queries) {
            qs.push(typeof q === "string" ? q : (q as { query?: string }).query || "");
          }
        }
      }
      triedQueriesByCategory[catBrief.category] = qs.filter(Boolean);
    }

    const runAudit = async (withGrounding = false): Promise<RequirementValidationResult | undefined> => {
      if (tokenBudget.exceeded || missingCategories.length === 0) return undefined;

      const topPicksByCategory: Record<string, CandidateProduct> = {};
      for (const [category, products] of Object.entries(candidatesByCategory)) {
        const sorted = [...products].sort((a, b) => {
          const sA = evaluations.get(a.id)?.final_item_score || 0;
          const sB = evaluations.get(b.id)?.final_item_score || 0;
          return (sB - sA) || tiebreakProduct(a, b);
        });
        if (sorted[0]) topPicksByCategory[category] = sorted[0];
      }

      const auditResult = await validateRequirements({
        roomType: ctx.roomType,
        missingCategories,
        whatItNeeds: ctx.whatItNeeds,
        diagnosis: ctx.diagnosis as DiagnosisData | undefined,
        topPicksByCategory,
        candidatesByCategory,
        designDirection: ctx.designDirection,
        designProfile: ctx.designProfile,
        roomImageUrls: ctx.imageUrls,
        enableGoogleSearch: withGrounding,
      });

      if (auditResult.tokensUsed) {
        tokenBudget.add(auditResult.tokensUsed);
        stats.tokensUsed += auditResult.tokensUsed;
        stats.tokensPerPhase.validation += auditResult.tokensUsed;
      }

      return auditResult.success ? auditResult.data : undefined;
    };

    const requirementIssues: string[] = [];
    let requirementAudit: RequirementValidationResult | undefined;
    const droppedCategories = new Set<string>();

    reportStep({ step: "Auditing requirement alignment", status: "running" });
    requirementAudit = await runAudit();

    if (requirementAudit) {
      requirementIssues.push(...requirementAudit.issues);
      log.info("Requirement audit complete", {
        phase: "requirement_validation",
        alignment: requirementAudit.overall_alignment,
        coverage: requirementAudit.coverage.score,
        diagnosisSolving: requirementAudit.diagnosis_solving.score,
        issueCount: requirementAudit.issues.length,
      });
      reportStep({
        step: "Auditing requirement alignment",
        status: "completed",
        data: {
          alignment: requirementAudit.overall_alignment,
          issues: requirementAudit.issues.length,
        },
      });
    } else {
      reportStep({ step: "Auditing requirement alignment", status: "failed" });
    }

    // ───────────────────────────────────────────────────────────
    // Branch: coordinator (function-calling) vs. hardcoded correction loop.
    // The coordinator drives corrections via Gemini function calling.
    // The hardcoded loop uses the older planCorrections + manual loop.
    // Both end up at the same downstream state.
    // ───────────────────────────────────────────────────────────
    if (ORCHESTRATOR.enablePostSearchCoordinator && requirementAudit) {
      reportStep({ step: "Coordinator (agentic post-search)", status: "running" });

      // Track the alignment trend across audit runs so the coordinator
      // can detect stall/regression and stop iterating.
      const auditHistory: Array<{ alignment: number; coverage: number; diagnosisSolving: number }> = [];
      if (requirementAudit) {
        auditHistory.push({
          alignment: requirementAudit.overall_alignment,
          coverage: requirementAudit.coverage.score,
          diagnosisSolving: requirementAudit.diagnosis_solving.score,
        });
      }

      // Build a state-getter closure that re-reads orchestrator state on
      // each turn. The coordinator sees objective signals only.
      const buildState = (): CoordinatorState => {
        const cats: CoordinatorState["categories"] = {};
        for (const [cat, products] of Object.entries(candidatesByCategory)) {
          if (products.length === 0) continue;
          const scores = products
            .map((p) => evaluations.get(p.id)?.final_item_score)
            .filter((s): s is number => s !== undefined)
            .sort((a, b) => a - b);
          const median = scores.length > 0 ? scores[Math.floor(scores.length / 2)] : undefined;
          const sortedByScore = [...products].sort((a, b) => {
            const sA = evaluations.get(a.id)?.final_item_score || 0;
            const sB = evaluations.get(b.id)?.final_item_score || 0;
            return sB - sA;
          });
          cats[cat] = {
            productCount: products.length,
            tiersCovered: Array.from(
              new Set(products.map((p) => ((p.metadata as { price_tier?: string } | null)?.price_tier) || "balanced")),
            ),
            scoreMedian: median,
            scoreMin: scores[0],
            scoreMax: scores[scores.length - 1],
            topPickTitle: sortedByScore[0]?.title || undefined,
            topPickPrice: sortedByScore[0]?.price || undefined,
          };
        }

        return {
          budgetUsed: tokenBudget.used,
          budgetCap: tokenBudget.cap,
          budgetRemainingPct: ((tokenBudget.cap - tokenBudget.used) / tokenBudget.cap) * 100,
          categories: cats,
          requiredCategories: missingCategories,
          missingCategories: missingCategories.filter((c) => !cats[c]),
          reSearchCount: Object.fromEntries(
            Object.entries(triedQueriesByCategory).map(([cat, qs]) => {
              // Each re-search adds ~12 queries (4 per tier × 3 tiers); divide
              // to estimate iteration count from query history length.
              const initialQs = brief.categories.find((b) => b.category === cat);
              const initialCount = initialQs
                ? Object.values(initialQs.tiers).reduce((s, t) => s + (t?.search_queries?.length || 0), 0)
                : 0;
              const reSearches = Math.floor((qs.length - initialCount) / 6);
              return [cat, Math.max(0, reSearches)];
            }),
          ),
          triedQueries: triedQueriesByCategory,
          droppedCategories: Array.from(droppedCategories),
          validationRun: validationResult.success === true,
          bundlesGenerated: bundles.length > 0,
          backfillRun: weakTiers.length > 0,
          tiersFilledRun: ctx.fillAllTiers !== false,
          lastAuditAlignment: requirementAudit?.overall_alignment,
          lastAuditCoverage: requirementAudit?.coverage.score,
          lastAuditDiagnosisSolving: requirementAudit?.diagnosis_solving.score,
          lastAuditIssues: requirementAudit?.issues,
          lastAuditUsedGrounding: coordinatorLastUsedGrounding,
          auditRunCount: coordinatorAuditRunCount,
          auditHistory: [...auditHistory],
        };
      };

      let coordinatorAuditRunCount = requirementAudit ? 1 : 0;
      let coordinatorLastUsedGrounding = false;

      // Tool handler dispatches to existing helpers / inline logic.
      const handle = async (
        toolName: CoordinatorTool,
        args: Record<string, unknown>,
      ): Promise<{ status: "ok" | "skipped" | "error"; message: string; metrics?: Record<string, unknown> }> => {
        if (tokenBudget.exceeded) {
          return { status: "skipped", message: "token budget exceeded" };
        }

        switch (toolName) {
          case "run_audit": {
            const withGrounding = !!args.with_grounding;
            const newAudit = await runAudit(withGrounding);
            if (!newAudit) return { status: "error", message: "Audit failed" };
            const before = requirementAudit?.overall_alignment ?? 0;
            requirementAudit = newAudit;
            requirementIssues.length = 0;
            requirementIssues.push(...newAudit.issues);
            coordinatorAuditRunCount++;
            coordinatorLastUsedGrounding = withGrounding;
            auditHistory.push({
              alignment: newAudit.overall_alignment,
              coverage: newAudit.coverage.score,
              diagnosisSolving: newAudit.diagnosis_solving.score,
            });
            return {
              status: "ok",
              message: `Audit: alignment ${newAudit.overall_alignment.toFixed(1)}/10 (was ${before.toFixed(1)})`,
              metrics: {
                alignment: newAudit.overall_alignment,
                coverage: newAudit.coverage.score,
                diagnosis_solving: newAudit.diagnosis_solving.score,
                issue_count: newAudit.issues.length,
                missing_categories: newAudit.coverage.missing_categories,
                spec_failures: newAudit.spec_matches.filter((s) => !s.matches).map((s) => s.category),
                grounded: withGrounding,
              },
            };
          }

          case "re_search_category": {
            const category = args.category as string;
            if (!category) return { status: "error", message: "Missing category" };
            const rawQueries = {
              budget: (args.queries_budget as string[]) || [],
              balanced: (args.queries_balanced as string[]) || [],
              high_end: (args.queries_high_end as string[]) || [],
            };

            // Server-side dedup: drop any query that's already been tried
            // for this category (case-insensitive, whitespace-normalized).
            // Prevents wasted re-searches even if the agent ignores the
            // "do not repeat" instruction in the state summary.
            const tried = new Set(
              (triedQueriesByCategory[category] || []).map((q) => q.trim().toLowerCase()),
            );
            const filterNew = (qs: string[]) =>
              qs.filter((q) => q && !tried.has(q.trim().toLowerCase()));
            const queries = {
              budget: filterNew(rawQueries.budget),
              balanced: filterNew(rawQueries.balanced),
              high_end: filterNew(rawQueries.high_end),
            };
            const droppedDupes =
              (rawQueries.budget.length - queries.budget.length) +
              (rawQueries.balanced.length - queries.balanced.length) +
              (rawQueries.high_end.length - queries.high_end.length);

            const totalQueries = queries.budget.length + queries.balanced.length + queries.high_end.length;
            if (totalQueries === 0) {
              return {
                status: "skipped",
                message: droppedDupes > 0
                  ? `All ${droppedDupes} queries were already tried — nothing new to run. Pick different queries or finalize.`
                  : "No queries provided",
              };
            }

            const result = await reSearchCategoryForCorrection({
              category,
              queriesByTier: queries,
              ctx,
              brief,
              tokenBudget,
              stats,
              tracer,
              anchorSpecs,
              harmonyNeighbors,
              evaluations,
            });
            candidatesByCategory[category] = candidatesByCategory[category] || [];
            candidatesByCategory[category].push(...result.products);
            stats.totalFinal += result.added;
            const allQueries = [...queries.budget, ...queries.balanced, ...queries.high_end];
            triedQueriesByCategory[category] = [
              ...(triedQueriesByCategory[category] || []),
              ...allQueries,
            ];
            return {
              status: "ok",
              message: droppedDupes > 0
                ? `Re-searched ${category}: added ${result.added} new products (${droppedDupes} duplicate queries skipped)`
                : `Re-searched ${category}: added ${result.added} new products`,
              metrics: {
                added: result.added,
                category_total_now: candidatesByCategory[category].length,
                dropped_duplicate_queries: droppedDupes,
              },
            };
          }

          case "drop_category": {
            const category = args.category as string;
            if (!category || !candidatesByCategory[category]) {
              return { status: "skipped", message: `Category ${category} not present` };
            }
            droppedCategories.add(category);
            delete candidatesByCategory[category];
            return {
              status: "ok",
              message: `Dropped ${category}`,
              metrics: { reason: args.reason },
            };
          }

          case "finalize":
            // Handled in the coordinator loop itself
            return { status: "ok", message: "finalize" };

          default:
            // run_validation, run_bundle_generation, run_backfill, fill_empty_tiers
            // are no-ops in this integration — those phases already ran linearly
            // before the coordinator started. Returning "skipped" lets the agent
            // know not to call them again.
            return {
              status: "skipped",
              message: `${toolName} already ran in the linear pre-coordinator phase — skipping`,
            };
        }
      };

      const coordResult = await runPostSearchCoordinator({
        roomType: ctx.roomType,
        budgetMode: ctx.budgetMode,
        state: buildState,
        handle,
        onTurn: (turn, action, status, thoughtSummary) => {
          reportStep({
            step: `Coordinator turn ${turn}: ${action}`,
            status: status === "ok" ? "completed" : status === "error" ? "failed" : "running",
            data: thoughtSummary ? { reasoning: thoughtSummary } : undefined,
          });
        },
      });

      if (coordResult.tokensUsed) {
        tokenBudget.add(coordResult.tokensUsed);
        stats.tokensUsed += coordResult.tokensUsed;
        stats.tokensPerPhase.validation += coordResult.tokensUsed;
      }

      // Bookkeeping for state used elsewhere
      void coordinatorAuditRunCount;
      void coordinatorLastUsedGrounding;

      reportStep({
        step: "Coordinator (agentic post-search)",
        status: "completed",
        data: coordResult.success ? coordResult.data : { error: coordResult.error },
      });
    } else {
    // Hardcoded correction loop — the original Phase 1 implementation.
    let correctionIteration = 0;
    while (
      requirementAudit &&
      requirementAudit.overall_alignment < ALIGNMENT_TARGET &&
      correctionIteration < SAFETY_CORRECTION_LIMIT &&
      !tokenBudget.exceeded
    ) {
      reportStep({
        step: `Self-correction pass ${correctionIteration + 1}`,
        status: "running",
      });

      const categoryState: Record<string, {
        topPickTitle?: string;
        topPickPrice?: number;
        topPickScore?: number;
        productCount: number;
        tiersCovered: string[];
      }> = {};
      for (const [category, products] of Object.entries(candidatesByCategory)) {
        const sorted = [...products].sort((a, b) => {
          const sA = evaluations.get(a.id)?.final_item_score || 0;
          const sB = evaluations.get(b.id)?.final_item_score || 0;
          return sB - sA;
        });
        const tiersCovered = Array.from(
          new Set(products.map((p) => ((p.metadata as { price_tier?: string } | null)?.price_tier) || "balanced"))
        );
        categoryState[category] = {
          topPickTitle: sorted[0]?.title || undefined,
          topPickPrice: sorted[0]?.price || undefined,
          topPickScore: sorted[0] ? evaluations.get(sorted[0].id)?.final_item_score : undefined,
          productCount: products.length,
          tiersCovered,
        };
      }

      const planResult = await planCorrections({
        roomType: ctx.roomType,
        budgetMode: ctx.budgetMode,
        audit: requirementAudit,
        categoryState,
        diagnosis: ctx.diagnosis as DiagnosisData | undefined,
        whatItNeeds: ctx.whatItNeeds,
        designDirection: ctx.designDirection,
        designProfile: ctx.designProfile,
        triedQueries: triedQueriesByCategory,
        iteration: correctionIteration,
        maxIterations: SAFETY_CORRECTION_LIMIT,
      });

      if (planResult.tokensUsed) {
        tokenBudget.add(planResult.tokensUsed);
        stats.tokensUsed += planResult.tokensUsed;
        stats.tokensPerPhase.validation += planResult.tokensUsed;
      }

      if (!planResult.success || !planResult.data) {
        log.warn("Correction plan failed — accepting current state", { error: planResult.error });
        reportStep({
          step: `Self-correction pass ${correctionIteration + 1}`,
          status: "failed",
        });
        break;
      }

      const plan = planResult.data;
      log.info("Correction plan", {
        iteration: correctionIteration,
        diagnosis: plan.diagnosis,
        actionTypes: plan.actions.map((a) => a.type),
        expectedGain: plan.expected_gain,
      });

      // Accept action = stop iterating
      const acceptAction = plan.actions.find((a) => a.type === "accept");
      if (acceptAction || plan.actions.length === 0) {
        log.info("Planner accepted current state", { reason: (acceptAction as { reason?: string })?.reason });
        reportStep({
          step: `Self-correction pass ${correctionIteration + 1}`,
          status: "completed",
          data: { action: "accept", reason: (acceptAction as { reason?: string })?.reason },
        });
        break;
      }

      // Drop categories
      for (const action of plan.actions) {
        if (action.type === "drop_category") {
          droppedCategories.add(action.category);
          delete candidatesByCategory[action.category];
          log.info("Dropped category per correction plan", {
            category: action.category,
            reason: action.reason,
          });
        }
      }

      // Execute re_search actions
      const reSearchActions = plan.actions.filter(
        (a) => a.type === "re_search_category"
      ) as Array<Extract<CorrectionAction, { type: "re_search_category" }>>;

      if (reSearchActions.length > 0) {
        const correctionResults = await Promise.all(
          reSearchActions.map(async (action) => {
            const result = await reSearchCategoryForCorrection({
              category: action.category,
              queriesByTier: action.queries_by_tier,
              ctx,
              brief,
              tokenBudget,
              stats,
              tracer,
              anchorSpecs,
              harmonyNeighbors,
              evaluations,
            });
            // Merge new products into the main candidate set
            candidatesByCategory[action.category] = candidatesByCategory[action.category] || [];
            candidatesByCategory[action.category].push(...result.products);
            stats.totalFinal += result.added;
            // Track queries so the planner doesn't repeat them next iteration
            const allQueries = [
              ...action.queries_by_tier.budget,
              ...action.queries_by_tier.balanced,
              ...action.queries_by_tier.high_end,
            ];
            triedQueriesByCategory[action.category] =
              [...(triedQueriesByCategory[action.category] || []), ...allQueries];
            return { category: action.category, added: result.added };
          })
        );

        let totalAdded = 0;
        for (const r of correctionResults) {
          totalAdded += r.added;
        }
        log.info("Correction re-search complete", {
          iteration: correctionIteration,
          totalAdded,
          perCategory: correctionResults,
        });
        reportStep({
          step: `Self-correction pass ${correctionIteration + 1}`,
          status: "completed",
          data: { addedProducts: totalAdded },
        });
      } else {
        reportStep({
          step: `Self-correction pass ${correctionIteration + 1}`,
          status: "completed",
        });
      }

      correctionIteration++;

      // Let the planner decide whether to loop again. No artificial cap;
      // the while-loop also checks alignment target and token budget.
      // SAFETY_CORRECTION_LIMIT only kicks in if both the planner and the
      // alignment check fail to terminate (planner-bug scenario).
      if (!plan.iterate_again) break;

      reportStep({ step: "Re-auditing after correction", status: "running" });
      // Enable Google Search grounding on the re-audit so the agent can
      // verify spec matches against live retailer data — more accurate
      // than reading the extracted product JSON alone.
      const newAudit = await runAudit(true);
      if (newAudit) {
        const gained = newAudit.overall_alignment - requirementAudit.overall_alignment;
        log.info("Re-audit after correction", {
          iteration: correctionIteration,
          alignmentBefore: requirementAudit.overall_alignment,
          alignmentAfter: newAudit.overall_alignment,
          gained,
        });
        requirementAudit = newAudit;
        requirementIssues.length = 0;
        requirementIssues.push(...newAudit.issues);
      }
      reportStep({ step: "Re-auditing after correction", status: "completed" });
    }
    } // end of (else / hardcoded correction loop) branch

    // ═══════════════════════════════════════════════════════════
    // Pipeline conversion metrics + score drift check
    // ═══════════════════════════════════════════════════════════
    const conversionRates = {
      searchToDedup: stats.totalRawUrls > 0 ? Math.round((stats.totalAfterDedup / stats.totalRawUrls) * 100) : 0,
      dedupToScreen: stats.totalAfterDedup > 0 ? Math.round((stats.totalAfterScreen / stats.totalAfterDedup) * 100) : 0,
      screenToExtract: stats.totalAfterScreen > 0 ? Math.round((stats.totalExtracted / stats.totalAfterScreen) * 100) : 0,
      extractToQuickScore: stats.totalExtracted > 0 ? Math.round((stats.totalQuickScored / stats.totalExtracted) * 100) : 0,
      quickToDeep: stats.totalQuickScored > 0 ? Math.round((stats.totalDeepScored / stats.totalQuickScored) * 100) : 0,
      deepToFinal: stats.totalDeepScored > 0 ? Math.round((stats.totalFinal / stats.totalDeepScored) * 100) : 0,
      overallYield: stats.totalRawUrls > 0 ? Math.round((stats.totalFinal / stats.totalRawUrls) * 100) : 0,
    };

    log.info("Pipeline conversion rates", { phase: "stats", conversionRates });

    // Identify bottlenecks — any stage dropping more than 80% is worth investigating
    const bottlenecks: string[] = [];
    if (conversionRates.screenToExtract < 20 && stats.totalAfterScreen > 10) {
      bottlenecks.push(`Extraction success rate low (${conversionRates.screenToExtract}%) — product pages may be hard to scrape`);
    }
    if (conversionRates.deepToFinal < 30 && stats.totalDeepScored > 10) {
      bottlenecks.push(`Deep score → final rate low (${conversionRates.deepToFinal}%) — scoring may be too strict or search queries are off-target`);
    }
    if (stats.totalFinal === 0 && stats.totalRawUrls > 20) {
      bottlenecks.push(`Zero final products from ${stats.totalRawUrls} URLs — search queries may not match available products`);
    }
    // Merge requirement validation issues into bottlenecks
    bottlenecks.push(...requirementIssues);
    if (bottlenecks.length > 0) {
      log.warn("Pipeline bottlenecks detected", { phase: "stats", bottlenecks });
    }

    // Check for score drift
    const driftWarnings = checkForDrift();
    if (driftWarnings.length > 0) {
      log.warn(`Score drift detected (${driftWarnings.length} warnings)`, { phase: "drift", warnings: driftWarnings.map((w) => w.message) });
    }

    const distribution = getScoreDistributionSummary();
    if (Object.keys(distribution).length > 0) {
      log.info("Score distributions", { phase: "drift", distribution });
    }

    // Log per-phase token breakdown for cost analysis
    log.info("Token usage by phase", { phase: "stats", tokensPerPhase: stats.tokensPerPhase, totalTokens: stats.tokensUsed });

    // ═══════════════════════════════════════════════════════════
    // Live confidence — deterministic math over current picks.
    // Replaces the AI validation agent's confidence (which converges
    // at 8.5-9.2 regardless of actual picks) with a reproducible
    // score and issues that reference THIS bundle's actual state.
    // ═══════════════════════════════════════════════════════════
    try {
      const topPicks: CandidateProduct[] = [];
      for (const products of Object.values(candidatesByCategory)) {
        const sorted = [...products].sort((a, b) => {
          const sA = evaluations.get(a.id)?.final_item_score || 0;
          const sB = evaluations.get(b.id)?.final_item_score || 0;
          return (sB - sA) || tiebreakProduct(a, b);
        });
        if (sorted.length > 0) topPicks.push(sorted[0]);
      }

      if (topPicks.length > 0) {
        const mathScores = computeBundleMathScores(
          topPicks.map((p) => ({
            title: p.title || undefined,
            category: p.category || undefined,
            price: p.price || undefined,
            materials: p.materials || undefined,
            colors: p.colors || undefined,
            dimensions: p.dimensions || undefined,
          })),
          {
            roomType: ctx.roomType,
            recommendedPalette: ctx.designDirection?.recommended_palette,
            recommendedMaterials: ctx.designDirection?.recommended_materials,
            floorPlan: ctx.floorPlan as Record<string, unknown> | undefined,
            placementMap: ctx.placementMap as Record<string, string> | undefined,
            existingItems: ctx.keepItems,
          }
        );

        const liveConfidence = Math.round(mathScores.overall * 100) / 10; // 0-10, 1 decimal
        const liveIssues = mathScores.issues.slice(0, 6);
        const priorFlags = validationResult.success && validationResult.data?.product_flags
          ? validationResult.data.product_flags
              .filter((f) => f.harmony_score <= 5)
              .filter((f) => topPicks.some((p) => p.title?.toLowerCase() === f.title.toLowerCase()))
              .map((f) => `${f.title}: ${f.reason}`)
          : [];

        const mergedIssues = [...requirementIssues, ...liveIssues, ...priorFlags].slice(0, 10);

        // Blend live bundle-math confidence with the requirement-audit
        // alignment score. Both are 0-10; the audit reflects how well the
        // picks satisfy the assessment, the math reflects internal cohesion.
        // When the audit is available, average the two (audit weighted 60%
        // because it's the externally-grounded signal).
        const blendedConfidence = requirementAudit
          ? Math.round((liveConfidence * 0.4 + requirementAudit.overall_alignment * 0.6) * 10) / 10
          : liveConfidence;

        validationData = {
          isValid: blendedConfidence >= 7 && mergedIssues.length === 0,
          confidence: blendedConfidence,
          issues: mergedIssues,
        };

        log.info("Live confidence computed from bundle math", {
          phase: "validation",
          confidence: liveConfidence,
          picks: topPicks.length,
          issueCount: mergedIssues.length,
          overall: mathScores.overall,
        });
      }
    } catch (err) {
      log.warn("Live confidence computation failed — keeping AI validation value", {
        phase: "validation",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      success: true,
      data: {
        searchBrief: brief,
        candidatesByCategory,
        alsoConsidered: Object.keys(alsoConsidered).length > 0 ? alsoConsidered : undefined,
        evaluations,
        bundles,
        steps,
        validation: validationData,
        requirementAudit,
        categoryPlan: agenticCategoryPlan,
        stats: { ...stats, conversionRates, bottlenecks, driftWarnings: driftWarnings.map((w) => w.message) },
        trace: tracer.getTrace(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Orchestration failed",
    };
  }
}
