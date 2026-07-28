/**
 * Seeds the `product_image_embeddings` index with catalog rows for every brand
 * in `lib/constants/identifiable-brands.ts`.
 *
 * How it works:
 *   1. For each brand, we ask Gemini's googleSearch-grounded tool to list its
 *      most iconic / distinctive products — brand + model + one public image
 *      URL per variant.
 *   2. For each { brand, model, image_url } triple we call `embedImage()` to
 *      get the 1408-dim vector and write it via `insertEmbedding()`.
 *   3. Idempotent-ish: we skip any (brand, model, image_url) triple that's
 *      already in the index.
 *
 * Run modes:
 *   - Without arguments, seeds ALL brands in the allow-list.
 *   - `--brand "IKEA"` limits to a single brand (partial-match ok).
 *   - `--limit N` caps the products fetched per brand (default 6).
 *   - `--dry-run` prints what would be inserted without making embedding calls.
 *
 * The seeder is best-effort: a failed embed or search for one brand logs and
 * moves on — we never abort the whole run. At worst we end up with a thin
 * index, which the identifier handles gracefully (falls back to unconditional
 * visual reasoning).
 *
 * Run: `npx tsx scripts/seed-product-embeddings.ts`
 *      `npx tsx scripts/seed-product-embeddings.ts --brand IKEA --limit 10`
 */

import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { getSystemPrompt } from "@/lib/prompts/system";
import { thinkingFor } from "@/lib/ai/thinking";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { embedImage } from "@/lib/ai/embeddings";
import { insertEmbedding } from "@/lib/store/embedding-index";
import { createMemoryClient } from "@/lib/store/memory-store";
import {
  IDENTIFIABLE_BRANDS,
  type IdentifiableBrand,
} from "@/lib/constants/identifiable-brands";
import { z } from "zod";

// ── CLI flags ────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args: { brand?: string; limit: number; dryRun: boolean } = {
    limit: 6,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--brand") args.brand = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i] || "6", 10);
  }
  return args;
}

const ProductRowSchema = z.object({
  model: z.string().min(1),
  variant: z.string().nullable().optional(),
  image_url: z.string().url(),
});
const ProductsResponseSchema = z.object({
  products: z.array(ProductRowSchema).default([]),
});

/**
 * Ask Gemini (grounded) for N iconic products from a brand. We deliberately
 * ask for "iconic" / "signature" so retrieval priors surface the pieces users
 * are most likely to own.
 */
async function listBrandIconicProducts(
  brand: IdentifiableBrand,
  limit: number,
): Promise<Array<{ model: string; variant: string | null; image_url: string }>> {
  const model = selectModel("extraction");
  const system = getSystemPrompt();

  const taglineHints = brand.tagline_hits?.length
    ? `Prioritize these signature lines if they still ship: ${brand.tagline_hits.join(", ")}.`
    : "";

  const prompt = `List the ${limit} most iconic / commercially recognizable furniture
or lighting products currently shipping from ${brand.brand}${brand.domain ? ` (${brand.domain})` : ""}.
${taglineHints}

For each product, return:
  - "model": the product's official model name (e.g. "KIVIK", "Eames Lounge Chair")
  - "variant": a standard colorway or size variant if listed, else null
  - "image_url": a direct URL to a representative product image — hero product
    photo on a plain background preferred, NOT a lifestyle shot. Must be a
    publicly accessible HTTPS URL ending in an image extension (.jpg/.jpeg/.png/.webp).

Rules:
  - Prefer the brand's own site for image URLs.
  - Skip products whose image you can't find a real URL for — don't fabricate.
  - Return fewer than ${limit} if the brand doesn't have that many iconic SKUs.

Return ONLY JSON: { "products": [ ... ] }.`;

  const response = await geminiProvider.chat({
    model,
    system,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    max_tokens: 2500,
    tools: [{ googleSearch: {} as Record<string, never> }],
    // The cost contract requires an explicit thinkingConfig on EVERY .chat(),
    // and the determinism rule requires a seed. This call had neither, and the
    // harness ratchet could not see it: __tests__/ai/harness-ratchet.test.ts
    // scans lib/ and app/ only, so a live provider call under scripts/ is
    // invisible to it by construction rather than by exemption.
    //
    // `search` is the honest task here — this is googleSearch-grounded
    // retrieval of catalog rows, not reasoning — and it resolves to the
    // minimal tier, which is what the contract prescribes for anything with a
    // cheap verifier. There is one: every row is Zod-parsed
    // (ProductsResponseSchema) and each image_url must resolve to a real
    // embeddable image or the row is dropped.
    thinkingConfig: thinkingFor("search"),
    seed: DETERMINISTIC_SEED,
  });

  const raw = extractJsonObject(response.content);
  const parsed = ProductsResponseSchema.parse(raw);
  return parsed.products.map((p) => ({
    model: p.model,
    variant: p.variant ?? null,
    image_url: p.image_url,
  }));
}

async function seedBrand(
  supabase: ReturnType<typeof createMemoryClient>,
  brand: IdentifiableBrand,
  limit: number,
  dryRun: boolean,
): Promise<{ ok: number; skipped: number; failed: number }> {
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`[seed] ${brand.brand} — discovering up to ${limit} iconic products…`);
  let products: Array<{ model: string; variant: string | null; image_url: string }>;
  try {
    products = await listBrandIconicProducts(brand, limit);
  } catch (err) {
    console.warn(
      `[seed] ${brand.brand} — discovery failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok, skipped, failed: 1 };
  }

  console.log(`[seed] ${brand.brand} — found ${products.length} product(s)`);
  for (const p of products) {
    // Idempotency check — skip if we already have this (brand, model, image_url).
    const { data: existing } = await supabase
      .from("product_image_embeddings")
      .select("id")
      .eq("brand", brand.brand)
      .eq("model", p.model)
      .eq("image_url", p.image_url);
    if (existing && (existing as unknown[]).length > 0) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] would insert: ${brand.brand} / ${p.model} ${p.variant ? `(${p.variant})` : ""}`);
      ok++;
      continue;
    }

    try {
      const vec = await embedImage({
        image: p.image_url,
        text: `${brand.brand} ${p.model}${p.variant ? " " + p.variant : ""}`,
      });
      const result = await insertEmbedding(supabase, {
        brand: brand.brand,
        model: p.model,
        variant: p.variant,
        image_url: p.image_url,
        embedding: vec,
        source: "catalog",
      });
      if (result.ok) {
        console.log(`  ✓ ${brand.brand} / ${p.model}`);
        ok++;
      } else {
        console.warn(`  ✗ ${brand.brand} / ${p.model} — insert failed: ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.warn(
        `  ✗ ${brand.brand} / ${p.model} — embed failed:`,
        err instanceof Error ? err.message : String(err),
      );
      failed++;
    }
  }

  return { ok, skipped, failed };
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createMemoryClient();

  const targets = args.brand
    ? IDENTIFIABLE_BRANDS.filter((b) =>
        b.brand.toLowerCase().includes(args.brand!.toLowerCase()),
      )
    : IDENTIFIABLE_BRANDS;

  if (targets.length === 0) {
    console.error(`No brands matched --brand "${args.brand}"`);
    process.exit(1);
  }

  console.log(
    `[seed] Starting ${args.dryRun ? "(dry-run) " : ""}seed of ${targets.length} brand(s), limit=${args.limit}`,
  );

  const totals = { ok: 0, skipped: 0, failed: 0 };
  for (const brand of targets) {
    const r = await seedBrand(supabase, brand, args.limit, args.dryRun);
    totals.ok += r.ok;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
  }

  console.log(
    `[seed] Done. inserted=${totals.ok} skipped=${totals.skipped} failed=${totals.failed}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[seed] Fatal:", err);
    process.exit(1);
  });
}
