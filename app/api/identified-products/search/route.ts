/**
 * Typeahead search for the "Different model" correction UI.
 *
 * Input:  GET /api/identified-products/search?q=kivik&limit=8
 *
 * Strategy (fast path → fallback):
 *   1. Substring match over the in-memory `product_image_embeddings` table —
 *      anything seeded via `scripts/seed-product-embeddings.ts` is free and
 *      O(n).
 *   2. Substring match over the brand allow-list (returns brand-only
 *      suggestions like "IKEA / (type a model)" for brands we haven't seeded
 *      with specific models).
 *   3. Substring match over tagline_hits — lets a query like "togo" surface
 *      "Ligne Roset — Togo" even without a seeded image.
 *
 * We DO NOT hit Gemini or any external search API here — typeaheads must be
 * sub-50ms. If none of the above produce hits, the UI lets the user type in
 * a free-form brand/model pair that gets enriched on submit via the
 * correction endpoint.
 *
 * Returns: { results: Array<{ brand, model, variant?, image_url?, source }> }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getIdentifiableBrands,
  type IdentifiableBrand,
} from "@/lib/constants/identifiable-brands";
import type { ProductImageEmbedding } from "@/lib/types/database";

interface Suggestion {
  brand: string;
  model: string;
  variant?: string | null;
  image_url?: string | null;
  /** "catalog" / "user_confirmed" / "allow_list" / "tagline_hit". */
  source: string;
}

function dedupeByBrandModel(items: Suggestion[]): Suggestion[] {
  const byKey = new Map<string, Suggestion>();
  for (const s of items) {
    const key = `${s.brand.toLowerCase()}::${s.model.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, s);
  }
  return Array.from(byKey.values());
}

function matchesQuery(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q.toLowerCase());
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const limit = Math.max(
    1,
    Math.min(50, parseInt(request.nextUrl.searchParams.get("limit") || "12", 10) || 12),
  );

  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const results: Suggestion[] = [];

  // ── Pass 1: seeded embedding index (brand + model pairs with images) ──
  const { data: embedRows } = await supabase
    .from("product_image_embeddings")
    .select("*")
    .order("brand", { ascending: true })
    .limit(500);
  const rows = (embedRows as ProductImageEmbedding[] | null) ?? [];
  for (const row of rows) {
    if (
      matchesQuery(row.brand, q) ||
      matchesQuery(row.model, q) ||
      (row.variant && matchesQuery(row.variant, q))
    ) {
      results.push({
        brand: row.brand,
        model: row.model,
        variant: row.variant ?? null,
        image_url: row.image_url,
        source: row.source || "catalog",
      });
      if (results.length >= limit * 2) break;
    }
  }

  // ── Pass 2: brand allow-list (covers brands not yet seeded) ───────────
  const brands = getIdentifiableBrands();
  for (const b of brands) {
    if (matchesQuery(b.brand, q)) {
      // Surface each tagline hit as a concrete model suggestion.
      if (b.tagline_hits?.length) {
        for (const hit of b.tagline_hits) {
          results.push({
            brand: b.brand,
            model: hit,
            variant: null,
            image_url: null,
            source: "allow_list",
          });
          if (results.length >= limit * 2) break;
        }
      } else {
        // No tagline hits — suggest the brand with a blank model placeholder
        // so the UI can prompt the user to type one.
        results.push({
          brand: b.brand,
          model: "",
          variant: null,
          image_url: null,
          source: "allow_list",
        });
      }
    }
  }

  // ── Pass 3: tagline_hits matches (for queries like "togo", "kivik") ──
  for (const b of brands) {
    if (!b.tagline_hits?.length) continue;
    for (const hit of b.tagline_hits) {
      if (matchesQuery(hit, q)) {
        results.push({
          brand: b.brand,
          model: hit,
          variant: null,
          image_url: null,
          source: "tagline_hit",
        });
      }
    }
  }

  const deduped = dedupeByBrandModel(results).slice(0, limit);
  return NextResponse.json({ results: deduped });
}

type _SuppressUnused = IdentifiableBrand;
