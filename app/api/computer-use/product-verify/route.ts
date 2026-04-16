/**
 * POST /api/computer-use/product-verify
 *
 * Standalone product verifier — visits a retailer page and extracts
 * current price, stock, dimensions, etc. Not wired into the main product
 * pipeline by default. Intended as an opt-in enrichment step for cases
 * where Google Shopping snippets are stale or a product's fit hinges on
 * exact dimensions not in the search result.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runProductVerifier } from "@/lib/agents/computer-use/product-verifier";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api-computer-use-product-verify");

export async function POST(request: Request) {
  if (process.env.ENABLE_COMPUTER_USE !== "1") {
    return NextResponse.json(
      { error: "Computer Use is disabled. Set ENABLE_COMPUTER_USE=1 to enable." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { product_url, expected_title, expected_color, expected_size } = body as {
    product_url?: string;
    expected_title?: string;
    expected_color?: string;
    expected_size?: string;
  };

  if (!product_url || typeof product_url !== "string") {
    return NextResponse.json({ error: "product_url required" }, { status: 400 });
  }

  try {
    const result = await runProductVerifier({
      productUrl: product_url,
      expectedTitle: expected_title,
      expectedColor: expected_color,
      expectedSize: expected_size,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    log.error("Product verifier failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
