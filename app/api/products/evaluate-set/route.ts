import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { extractFromUrl } from "@/lib/agents/product-extractor";
import { scoreProduct, type ScoringContext } from "@/lib/agents/fit-scorer";
import { evaluateBundle, type BundleContext } from "@/lib/agents/bundle-optimizer";
import { buildDesignProfile } from "@/lib/design-context/build-profile";
import { logServerError } from "@/lib/utils/api-error";
import { validateExternalUrl } from "@/lib/utils/url-validator";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import type { CandidateProduct } from "@/lib/types/database";

// This endpoint fans out many LLM calls per request (extract + deep-score per
// URL, then a combinatorial bundle sweep). Without an explicit maxDuration,
// Vercel applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a paid path. 300s is the
// Vercel Pro ceiling and covers the documented worst-case latency.
export const maxDuration = 300;

/**
 * POST /api/products/evaluate-set
 *
 * Accepts per-category URLs from the user, extracts product data,
 * deep-scores each product individually, then evaluates all combinations
 * as bundles to find the best set. Returns individual scorecards,
 * bundle evaluations, and the best combination.
 *
 * Body: {
 *   room_id: string,
 *   items: Array<{ category: string, urls: string[] }>
 * }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // This endpoint fans out many LLM calls per request — one extraction + one
  // deep-score per URL, then a combinatorial sweep of bundle evaluations
  // (Promise.all batches). Unguarded, a single authed user could drain the LLM
  // budget. Gate it behind the per-user rate limit + daily spend breaker.
  const limit = checkRateLimit(`evaluate-set:${user.id}`, RATE_LIMITS.bundleEvaluate);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many set-evaluation requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } }
    );
  }
  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { room_id, items } = body as {
    room_id: string;
    items: Array<{ category: string; urls: string[] }>;
  };

  if (!room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  if (!items?.length) return NextResponse.json({ error: "items required" }, { status: 400 });

  // Ownership guard BEFORE the (paid) fan-out of extraction + scoring + bundle
  // evaluation: room_id is client-supplied and the memory-store reads are not
  // user-scoped, so without this check any authenticated caller could run the
  // full set evaluation against another user's room (IDOR + LLM-cost abuse).
  if (!(await userOwnsRoom(supabase, room_id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Fetch room + project + diagnosis context ──────────────────
  const [roomRes, diagRes] = await Promise.all([
    supabase.from("rooms").select("*, room_images(*)").eq("id", room_id).single(),
    supabase
      .from("room_diagnoses")
      .select("*")
      .eq("room_id", room_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (roomRes.error || !roomRes.data) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const room = roomRes.data;
  const roomImageUrls = (room.room_images || []).map((img: { image_url: string }) => img.image_url);
  const diagnosis = diagRes.data?.diagnosis_json || undefined;
  const designDirection = diagRes.data?.design_direction_json || undefined;

  // The project row and the sibling-rooms context both key only on
  // room.project_id and are independent — fetch them in parallel to shave a
  // full DB round-trip off this per-request path. Fixed-position destructure
  // keeps the read order deterministic.
  const [projectRes, otherRoomsRes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", room.project_id).single(),
    supabase
      .from("rooms")
      .select("name, room_type, room_diagnoses(diagnosis_json, created_at)")
      .eq("project_id", room.project_id)
      .neq("id", room_id),
  ]);

  const project = projectRes.data;
  const designProfile = buildDesignProfile(project);

  // Build cross-room context
  let otherRoomsContext: string | undefined;
  const otherRooms = otherRoomsRes.data;

  if (otherRooms?.length) {
    // 90-day freshness window — stale sibling diagnoses bias the set-level
    // coherence pass toward palettes/materials the user has since moved on
    // from.
    const staleCutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    otherRoomsContext = otherRooms
      .map((r: Record<string, unknown>) => {
        const diags = r.room_diagnoses as Array<{ diagnosis_json: Record<string, string>; created_at?: string }> | undefined;
        const recent = (diags ?? []).filter((d) => {
          if (!d.created_at) return false;
          const t = Date.parse(d.created_at);
          return Number.isFinite(t) && t >= staleCutoffMs;
        });
        const diag = recent[recent.length - 1];
        const summary = diag ? diag.diagnosis_json?.summary || "analyzed" : "not analyzed";
        return `- ${r.name} (${r.room_type}): ${summary}`;
      })
      .join("\n");
  }

  // Spatial context from building research
  const br = project?.building_research as Record<string, unknown> | undefined;
  const floorPlan = br?.floor_plan as Record<string, unknown> | undefined;

  // ── Phase 1: Extract all URLs in parallel ─────────────────────
  const extractionResults: Array<{
    category: string;
    url: string;
    product: CandidateProduct | null;
    error?: string;
  }> = [];

  const extractionPromises = items.flatMap((item) =>
    item.urls.map(async (url) => {
      try {
        // SSRF guard: extractFromUrl fetches this URL server-side. Reject private
        // IPs / loopback / cloud-metadata / credentialed URLs before the fetch,
        // mirroring the /api/products/ingest route.
        const validation = validateExternalUrl(url);
        if (!validation.valid) {
          return { category: item.category, url, product: null, error: validation.error || "Invalid URL" };
        }

        const result = await extractFromUrl(url, designProfile, roomImageUrls);
        if (!result.success || !result.data) {
          return { category: item.category, url, product: null, error: result.error || "Extraction failed" };
        }

        // Save to candidate_products
        const { data: saved, error: saveErr } = await supabase
          .from("candidate_products")
          .insert({
            room_id,
            title: result.data.title,
            category: item.category,
            retailer: result.data.retailer,
            product_url: url,
            image_url: result.data.image_url || null,
            price: result.data.price,
            dimensions: result.data.dimensions,
            materials: result.data.materials,
            colors: result.data.colors,
            description: result.data.description,
            source_type: "manual_url" as const,
            metadata: {
              lifestyle_image_url: result.data.lifestyle_image_url,
              visual_style_tags: result.data.visual_style_tags,
              available_variants: result.data.available_variants,
            },
          })
          .select()
          .single();

        if (saveErr || !saved) {
          logServerError("products/evaluate-set save", saveErr);
          return { category: item.category, url, product: null, error: "Could not save this product." };
        }

        return { category: item.category, url, product: saved as CandidateProduct };
      } catch (err) {
        logServerError("products/evaluate-set extract", err);
        return {
          category: item.category,
          url,
          product: null,
          error: "Could not process this product URL.",
        };
      }
    })
  );

  const extracted = await Promise.all(extractionPromises);
  extractionResults.push(...extracted);

  const successfulProducts = extractionResults.filter((r) => r.product !== null) as Array<{
    category: string;
    url: string;
    product: CandidateProduct;
  }>;

  if (successfulProducts.length === 0) {
    return NextResponse.json(
      {
        error: "No products could be extracted",
        details: extractionResults.map((r) => ({ url: r.url, error: r.error })),
      },
      { status: 422 }
    );
  }

  // ── Phase 2: Deep-score each product ──────────────────────────
  const scoringCtx: ScoringContext = {
    roomType: room.room_type,
    budgetMode: room.budget_mode,
    existingItems: room.keep_items || [],
    roomImageUrls,
    priorities: room.priorities || [],
    otherRoomsContext,
    designProfile,
    diagnosis,
    designDirection,
    replaceItems: room.replace_items || [],
    floorPlan,
    userContext: (room.user_context as string) || undefined,
  };

  const scoringResults: Array<{
    product: CandidateProduct;
    category: string;
    scores: Record<string, unknown> | null;
    final_item_score: number | null;
    verdict: string | null;
    reasoning: Record<string, unknown> | null;
    area_fit_note?: string;
    apartment_fit_note?: string;
    error?: string;
  }> = [];

  // Score up to 5 concurrently
  const SCORE_CONCURRENCY = 5;
  for (let i = 0; i < successfulProducts.length; i += SCORE_CONCURRENCY) {
    const batch = successfulProducts.slice(i, i + SCORE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ product, category }) => {
        const result = await scoreProduct(product, scoringCtx);
        if (!result.success || !result.data) {
          return {
            product,
            category,
            scores: null,
            final_item_score: null,
            verdict: null,
            reasoning: null,
            error: result.error,
          };
        }

        // Save evaluation to DB
        const evalData = {
          product_id: product.id,
          room_id,
          ...result.data.scores,
          final_item_score: result.data.final_item_score,
          verdict: result.data.verdict,
          reasoning: {
            ...result.data.reasoning,
            area_fit_note: result.data.area_fit_note,
            apartment_fit_note: result.data.apartment_fit_note,
          },
          model_used: result.model,
        };

        const { error: insertError } = await supabase
          .from("product_evaluations")
          .insert(evalData);

        // Only flip the product to "evaluated" once its evaluation row is actually
        // persisted. Marking it evaluated after a failed insert would orphan the
        // status (product shows "evaluated" with no evaluation behind it) and hide
        // the product from a future re-evaluation pass.
        if (insertError) {
          logServerError("evaluate-set product_evaluations insert", insertError);
        } else {
          const { error: statusError } = await supabase
            .from("candidate_products")
            .update({ status: "evaluated", updated_at: new Date().toISOString() })
            .eq("id", product.id);
          if (statusError) {
            logServerError("evaluate-set candidate_products status update", statusError);
          }
        }

        return {
          product,
          category,
          scores: result.data.scores as unknown as Record<string, unknown>,
          final_item_score: result.data.final_item_score,
          verdict: result.data.verdict,
          reasoning: result.data.reasoning as unknown as Record<string, unknown>,
          area_fit_note: result.data.area_fit_note,
          apartment_fit_note: result.data.apartment_fit_note,
        };
      })
    );
    scoringResults.push(...batchResults);
  }

  // ── Phase 3: Combinatorial bundle evaluation ──────────────────
  // Group scored products by category
  const productsByCategory = new Map<string, typeof scoringResults>();
  for (const sr of scoringResults) {
    if (!sr.scores) continue; // skip failed scores
    const arr = productsByCategory.get(sr.category) || [];
    arr.push(sr);
    productsByCategory.set(sr.category, arr);
  }

  const categoryKeys = [...productsByCategory.keys()].sort();

  // Generate all combinations (one product per category)
  // Cap at 50 combinations to avoid runaway costs
  function generateCombinations<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restCombos = generateCombinations(rest);
    const result: T[][] = [];
    for (const item of first) {
      for (const combo of restCombos) {
        result.push([item, ...combo]);
        if (result.length >= 50) return result;
      }
    }
    return result;
  }

  const categoryArrays = categoryKeys.map((k) => productsByCategory.get(k)!);
  const combinations = generateCombinations(categoryArrays);

  const bundleCtx: BundleContext = {
    roomType: room.room_type,
    roomImageUrls,
    priorities: room.priorities || [],
    existingItems: room.keep_items || [],
    designProfile,
    diagnosis,
    designDirection,
    replaceItems: room.replace_items || [],
    floorPlan,
    userContext: (room.user_context as string) || undefined,
  };

  // Evaluate bundles — up to 3 concurrently
  const bundleResults: Array<{
    products: Array<{ id: string; title: string | null; category: string }>;
    scores: Record<string, unknown> | null;
    final_bundle_score: number | null;
    verdict: string | null;
    analysis: Record<string, unknown> | null;
    error?: string;
  }> = [];

  const BUNDLE_CONCURRENCY = 3;
  for (let i = 0; i < combinations.length; i += BUNDLE_CONCURRENCY) {
    const batch = combinations.slice(i, i + BUNDLE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (combo) => {
        const comboProducts = combo.map((sr) => sr.product);
        const result = await evaluateBundle(comboProducts, bundleCtx);

        const productList = combo.map((sr) => ({
          id: sr.product.id,
          title: sr.product.title,
          category: sr.category,
        }));

        if (!result.success || !result.data) {
          return {
            products: productList,
            scores: null,
            final_bundle_score: null,
            verdict: null,
            analysis: null,
            error: result.error,
          };
        }

        return {
          products: productList,
          scores: result.data.scores as unknown as Record<string, unknown>,
          final_bundle_score: result.data.final_bundle_score,
          verdict: result.data.verdict,
          analysis: result.data.analysis as unknown as Record<string, unknown>,
        };
      })
    );
    bundleResults.push(...batchResults);
  }

  // Find best combination
  const validBundles = bundleResults.filter((b) => b.final_bundle_score !== null);
  const bestBundle = validBundles.length > 0
    ? validBundles.reduce((best, curr) =>
        (curr.final_bundle_score || 0) > (best.final_bundle_score || 0) ? curr : best
      )
    : null;

  // Calculate overall score (average of best individual scores + bundle harmony)
  const avgItemScore =
    scoringResults.filter((s) => s.final_item_score !== null).length > 0
      ? scoringResults
          .filter((s) => s.final_item_score !== null)
          .reduce((sum, s) => sum + (s.final_item_score || 0), 0) /
        scoringResults.filter((s) => s.final_item_score !== null).length
      : 0;

  const bestBundleScore = bestBundle?.final_bundle_score || 0;
  // overallScore (legacy) kept for reference: Math.round(((avgItemScore * 0.5 + bestBundleScore * 0.5) / 10) * 100) / 10
  // Normalize to 0-10 scale
  const overallScoreOutOf10 = Math.round((avgItemScore * 0.5 + bestBundleScore * 0.5) * 10) / 10;

  // Identify gaps (what prevents a perfect 10)
  const gaps: string[] = [];
  if (overallScoreOutOf10 < 10) {
    // Check individual product gaps
    for (const sr of scoringResults) {
      if (!sr.scores) continue;
      const s = sr.scores as Record<string, number>;
      if ((s.style_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Style fit is weak (${s.style_fit_score}/10)`);
      if ((s.palette_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Palette doesn't match well (${s.palette_fit_score}/10)`);
      if ((s.scale_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Scale/size concerns (${s.scale_fit_score}/10)`);
      if ((s.material_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Material mismatch (${s.material_fit_score}/10)`);
      if ((s.cohesion_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Doesn't cohere with room (${s.cohesion_fit_score}/10)`);
      if ((s.value_fit_score ?? 10) < 7)
        gaps.push(`${sr.product.title}: Value concern (${s.value_fit_score}/10)`);
    }

    // Check bundle gaps
    if (bestBundle?.scores) {
      const bs = bestBundle.scores as Record<string, number>;
      if ((bs.palette_harmony_score ?? 10) < 7)
        gaps.push(`Bundle: Palette harmony is weak (${bs.palette_harmony_score}/10)`);
      if ((bs.style_consistency_score ?? 10) < 7)
        gaps.push(`Bundle: Style consistency is weak (${bs.style_consistency_score}/10)`);
      if ((bs.scale_balance_score ?? 10) < 7)
        gaps.push(`Bundle: Scale balance concerns (${bs.scale_balance_score}/10)`);
      if ((bs.room_completion_score ?? 10) < 7)
        gaps.push(`Bundle: Room feels incomplete (${bs.room_completion_score}/10)`);
      if ((bs.spatial_arrangement_score ?? 10) < 7)
        gaps.push(`Bundle: Spatial arrangement issues (${bs.spatial_arrangement_score}/10)`);
    }

    // Check bundle analysis text
    if (bestBundle?.analysis) {
      const a = bestBundle.analysis as Record<string, string>;
      if (a.what_feels_missing && a.what_feels_missing !== "Nothing")
        gaps.push(`Missing: ${a.what_feels_missing}`);
      if (a.what_should_be_swapped_first && a.what_should_be_swapped_first !== "Nothing")
        gaps.push(`Consider swapping: ${a.what_should_be_swapped_first}`);
    }
  }

  // Check which categories had extraction failures
  const failedExtractions = extractionResults
    .filter((r) => r.product === null)
    .map((r) => ({ url: r.url, category: r.category, error: r.error }));

  return NextResponse.json(
    {
      individual_scores: scoringResults.map((sr) => ({
        product_id: sr.product.id,
        title: sr.product.title,
        category: sr.category,
        price: sr.product.price,
        retailer: sr.product.retailer,
        image_url: sr.product.image_url,
        product_url: sr.product.product_url,
        scores: sr.scores,
        final_item_score: sr.final_item_score,
        verdict: sr.verdict,
        reasoning: sr.reasoning,
        area_fit_note: sr.area_fit_note,
        apartment_fit_note: sr.apartment_fit_note,
        error: sr.error,
      })),
      bundles: bundleResults.map((br) => ({
        products: br.products,
        scores: br.scores,
        final_bundle_score: br.final_bundle_score,
        verdict: br.verdict,
        analysis: br.analysis,
        error: br.error,
      })),
      best_combination: bestBundle
        ? {
            products: bestBundle.products,
            scores: bestBundle.scores,
            final_bundle_score: bestBundle.final_bundle_score,
            verdict: bestBundle.verdict,
            analysis: bestBundle.analysis,
          }
        : null,
      overall_score: overallScoreOutOf10,
      gaps,
      failed_extractions: failedExtractions,
    },
    { status: 200 }
  );
}
