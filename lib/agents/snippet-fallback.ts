import type { SearchCandidate } from "./shopping-researcher";
import type { CandidateProduct } from "@/lib/types/database";
import type { PriceTier } from "@/lib/prompts/search-brief";

const PRICE_REGEX = /\$\s?([\d,]+(?:\.\d{2})?)/;

export function parsePriceFromSnippet(snippet: string): number | null {
  const match = snippet.match(PRICE_REGEX);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  return isFinite(num) && num > 0 && num < 50_000 ? num : null;
}

export function buildSnippetProduct(
  candidate: SearchCandidate,
  category: string,
  tier: PriceTier,
  roomId: string,
): CandidateProduct | null {
  if (!candidate.title || candidate.title.length < 5) return null;
  if (!candidate.url) return null;

  const price = parsePriceFromSnippet(candidate.snippet || "");

  return {
    id: crypto.randomUUID(),
    room_id: roomId,
    search_session_id: null,
    title: candidate.title,
    category,
    retailer: candidate.source || null,
    product_url: candidate.url,
    image_url: candidate.imageUrl || null,
    local_image_path: null,
    price: price,
    dimensions: null,
    materials: null,
    colors: null,
    description: candidate.snippet?.slice(0, 200) || null,
    source_type: "agentic_search",
    metadata: {
      price_tier: tier,
      snippet_fallback: true,
    },
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
