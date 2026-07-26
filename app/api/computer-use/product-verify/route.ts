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
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpendForUser, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { validateExternalUrl } from "@/lib/utils/url-validator";

const log = createLogger("api-computer-use-product-verify");

// The verifier drives an agentic Browserbase browser loop (up to 10 turns, each
// with its own multi-second nav timeouts). Without this the route inherits
// Vercel's short default budget and is killed mid-verification once Browserbase
// creds are set. Mirrors the 300s cap on the other LLM pipeline routes; the
// verifier itself carries a wall-clock cap shorter than this (see product-verifier.ts).
export const maxDuration = 300;

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

  const limit = checkRateLimit(`computer-use-verify:${user.id}`, RATE_LIMITS.computerUseVerify);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many verification requests. Please wait before retrying." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 3600000) / 1000)) } },
    );
  }

  const spend = await checkDailySpendForUser(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: {
    product_url?: string;
    expected_title?: string;
    expected_color?: string;
    expected_size?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { product_url, expected_title, expected_color, expected_size } = body;

  if (!product_url || typeof product_url !== "string") {
    return NextResponse.json({ error: "product_url required" }, { status: 400 });
  }

  // SSRF guard: the verifier drives Browserbase to fetch this URL server-side, so
  // an authenticated caller could otherwise point it at internal/metadata hosts
  // (169.254.169.254, localhost, private ranges). Mirror the guard the sibling
  // ingest route already applies before any server-side fetch.
  const validation = validateExternalUrl(product_url);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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
    log.error("Product verifier failed", { error: (e as Error).message });
    return NextResponse.json({ error: "Verification request failed. Please try again." }, { status: 500 });
  }
}
