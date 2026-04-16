/**
 * POST /api/computer-use/product-verify
 *
 * Manual single-URL product verifier. The same verifier runs
 * automatically as a post-search step in /api/search — this route is
 * kept for ad-hoc re-verification (e.g. a "refresh price" action from
 * the dashboard) and for debugging. Requires Browserbase credentials.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runProductVerifier } from "@/lib/agents/computer-use/product-verifier";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api-computer-use-product-verify");

export async function POST(request: Request) {
  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    return NextResponse.json(
      { error: "Browserbase credentials not configured on this deployment." },
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
