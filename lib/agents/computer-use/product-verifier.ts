/**
 * Product verifier — Computer Use agent specialized for visiting a product
 * page and extracting the current price, stock status, dimensions, and
 * available variants. Useful when:
 *
 *   - The text-only extractor couldn't render a JS-heavy retailer page.
 *   - A recommendation is older than a day and we want to re-verify price/stock.
 *   - A product is borderline-fit and we need dimension precision beyond what
 *     Google Shopping's snippet shows.
 *
 * Ships as a STANDALONE module — not wired into /api/search by default.
 * Callers that want live verification must opt in explicitly. The UX choice
 * of when to run this (blocking vs background vs user-triggered) is left
 * to the caller.
 */

import { runComputerUseAgent } from "./agent-loop";
import { createDefaultBrowserDriver } from "./browserbase-driver";
import type { AgentRunResult, AgentStepLog } from "./types";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("product-verifier");

export interface ProductVerifierInput {
  productUrl: string;
  /** What the user originally saw — helps the agent confirm it found the right variant. */
  expectedTitle?: string;
  expectedColor?: string;
  expectedSize?: string;
  maxTurns?: number;
  onStep?: (step: AgentStepLog) => void;
}

export interface VerifiedProduct {
  title: string | null;
  price: number | null;
  currency: string | null;
  in_stock: boolean | null;
  dimensions: {
    width_in: number | null;
    depth_in: number | null;
    height_in: number | null;
  } | null;
  materials: string[];
  available_colors: string[];
  available_sizes: string[];
  shipping_estimate: string | null;
  return_policy_summary: string | null;
  /** Anything the agent thinks a human should double-check. */
  caveats: string[];
}

export interface ProductVerifierResult {
  product: VerifiedProduct | null;
  source_url: string;
  agent_status: AgentRunResult<VerifiedProduct>["status"];
  turns: number;
  notes?: string;
}

function buildGoal(input: ProductVerifierInput): string {
  const hints: string[] = [];
  if (input.expectedTitle) hints.push(`Expected product title (approximate): "${input.expectedTitle}"`);
  if (input.expectedColor) hints.push(`Expected color/finish: ${input.expectedColor}`);
  if (input.expectedSize) hints.push(`Expected size: ${input.expectedSize}`);
  const hintBlock = hints.length
    ? `\n\nCONTEXT (from earlier search snippet — may be stale):\n${hints.join("\n")}`
    : "";

  return `You are a meticulous product research agent. Your job is to visit a retailer page and extract ground-truth product data — the kind a professional buyer would verify before placing an order.

STARTING URL: ${input.productUrl}${hintBlock}

══════════════════════════════════════════════════════
STEP 1 — CONFIRM YOU'RE ON THE RIGHT PRODUCT PAGE
══════════════════════════════════════════════════════
After the page loads, verify:
  a) The page is a PRODUCT DETAIL PAGE (not search results, a category, or a collection).
     If you land on a listing page, identify the matching product and click through to it.
  b) The product matches the context hints above. If the page shows a completely different
     product (wrong category, wrong brand), output the JSON with all fields null and
     add "wrong product page" to caveats. Do NOT try to search for the correct product.
  c) If you're redirected to a region-blocked page ("not available in your region" or a
     country-selector page), set in_stock = false, price = null, and add "geo-restricted"
     to caveats. Do NOT try to bypass region restrictions.

══════════════════════════════════════════════════════
STEP 2 — HANDLE OVERLAYS & BLOCKERS (before reading content)
══════════════════════════════════════════════════════
Before reading any product data, clear visual blockers in this order:
  a) Cookie/GDPR banners: dismiss using the "Accept" or "Accept all" button ONLY if it
     is a cookie consent button (not a full Terms of Service agreement). After dismissing,
     wait 1 second for the overlay to disappear.
  b) Newsletter/email popups: click the close (×) button or "No thanks" link. Never
     enter an email address.
  c) Age-verification dialogs: click the affirmative option ("I am 18+", "Enter") to
     proceed.
  d) Sticky chat widgets / floating elements covering content: if they obscure the
     product info area, close them if there's a clearly visible close control.
  e) If a login wall appears blocking product details: set price = null, in_stock = null,
     add "login required to view price/stock" to caveats. Do NOT attempt to log in.
  f) If a CAPTCHA / robot-check appears: STOP immediately. Set all price/stock fields to
     null and add "captcha encountered — human verification required" to caveats. Do NOT
     try to solve or bypass the CAPTCHA.

══════════════════════════════════════════════════════
STEP 3 — EXTRACT PRODUCT DATA
══════════════════════════════════════════════════════
With the page clear, scroll carefully and capture:

TITLE:
  - Read the primary h1 product title exactly as shown on the page.
  - Do NOT use the browser tab title or meta title — those are often truncated.

PRICE:
  - Capture the CURRENT SELLING PRICE (after any automatic discount, not the
    crossed-out "was" price).
  - If price is shown as a range ("$299–$499"), record the lower bound and add
    "price varies by variant" to caveats.
  - If price says "starting at $X", record X and add "starting price — depends on
    configuration" to caveats.
  - If "price on request", "call for pricing", or "see in store" is shown,
    set price = null and add that exact phrase to caveats.
  - If the price is in a non-USD currency (€, £, ¥, etc.), record the numeric
    value as shown and set currency to the correct ISO code (EUR, GBP, JPY…).
  - If price is only visible in a dropdown or after selecting a variant, click
    the FIRST available variant option to reveal it.

STOCK STATUS (in_stock: true/false/null):
  - true  = "In stock", "Add to cart" is active/enabled, ships within a stated window
  - false = "Out of stock", "Sold out", "Temporarily unavailable", "Backordered"
  - null  = Cannot determine (price-on-request, login wall, fully ambiguous)
  - Low-stock messages ("Only 3 left!") → set in_stock: true and note "low stock" in caveats.
  - Backorder with a stated ship date ("ships in 8 weeks") → set in_stock: false and
    include the ship date in caveats.

DIMENSIONS (always in INCHES — convert if needed: 1 in = 2.54 cm):
  - Look for a "Dimensions", "Specs", "Specifications", or "Details" section.
  - If the section is collapsed (accordion), click the header to expand it.
  - Scroll past the fold; dimensions are often below the images.
  - Common retailer label patterns:
      W × D × H / Width × Depth × Height / Overall: WxDxH
      "Seat depth: 22 in", "Overall width: 72 in"  ← parse individually
  - If dimensions are listed ONLY in cm, divide each by 2.54 and round to 1 decimal.
    Add "converted from cm" to caveats.
  - If only width × height (2D item like a mirror or artwork), set depth_in = null.
  - If completely absent, set dimensions = null and add "dimensions not listed" to caveats.

MATERIALS:
  - List material descriptors in plain English: ["top-grain leather", "stainless steel legs",
    "solid oak frame", "linen upholstery", "marble top"].
  - Exclude marketing fluff ("sustainably sourced", "artisan crafted").
  - If not listed at all, return [].

COLORS (available_colors):
  - List ALL purchasable color/finish/fabric options visible on the page (swatches or
    a dropdown). Use the label shown ("ivory boucle", "walnut", "brushed brass").
  - If the page only shows one color with no variants, return that one color.
  - If the product is configured with a specific expected color (see CONTEXT), verify
    it exists in the available set. If it's missing, add "expected color not found" to caveats.

SIZES (available_sizes):
  - List dimension-based sizes if applicable (e.g. ["48×84", "60×84", "72×84"] for rugs;
    ["S", "M", "L"] for soft goods).
  - If the product has no size variants, return [].

SHIPPING:
  - Look for "Ships in", "Delivery", "Estimated arrival", "Free shipping" messages near
    the add-to-cart button or in a product info accordion.
  - Record as a short phrase: "free 2-day delivery", "ships in 4–6 weeks", "local pickup only".
  - If not visible, return null.

RETURN POLICY:
  - Look for a "Returns", "Free returns", "30-day return policy" statement near the
    product or in a footer/accordion.
  - Summarise in one sentence: "30-day free returns, no questions asked."
  - If not visible, return null.

══════════════════════════════════════════════════════
STEP 4 — NAVIGATION RULES & HARD LIMITS
══════════════════════════════════════════════════════
- You may click ONCE on a spec accordion, a "Show more" / "See full details" link,
  or a variant selector to reveal hidden data.
- You may scroll the page up/down to find spec tables.
- You may navigate to a size/color variant of the SAME product if the URL redirects
  (e.g., Wayfair SKU changes when you select a color) — but stay on the same product.
- Do NOT navigate to a different product, category, or site.
- Do NOT click "Add to Cart", "Buy Now", "Checkout", or any purchase button.
- Do NOT fill in any form (address, email, phone, credit card).
- Do NOT follow links to external sites (reviews, brand pages).
- If you have scrolled the full page and visited one variant without finding a field,
  mark it null — do NOT keep clicking or searching indefinitely.

══════════════════════════════════════════════════════
WHEN FINISHED — OUTPUT FORMAT
══════════════════════════════════════════════════════
Stop all actions. Write a brief summary of what you found, then end with this exact JSON block:

\`\`\`json
{
  "title": "Exact product title from page or null",
  "price": 499.00,
  "currency": "USD",
  "in_stock": true,
  "dimensions": {
    "width_in": 72.0,
    "depth_in": 36.0,
    "height_in": 34.5
  },
  "materials": ["performance linen", "solid oak legs"],
  "available_colors": ["natural linen", "slate gray", "terracotta"],
  "available_sizes": [],
  "shipping_estimate": "ships in 3–4 weeks, free delivery",
  "return_policy_summary": "30-day free returns on most items.",
  "caveats": [
    "depth dimension converted from cm (91.4 cm ÷ 2.54)",
    "price varies by fabric selection — recorded base price"
  ]
}
\`\`\`

Rules for the JSON:
- price: number (not a string, not a range) or null
- dimensions: object with at least one non-null field, or null if completely absent
- All array fields default to [] not null
- caveats: include one item per uncertainty, conversion, assumption, or blocker encountered
- The JSON fence MUST be the last thing in your response — no text after it.`;
}

export function parseFinal(finalText: string): VerifiedProduct | undefined {
  if (!finalText) return undefined;
  const fenceMatches = [...finalText.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const lastFence = fenceMatches[fenceMatches.length - 1];
  const raw = lastFence ? lastFence[1] : finalText;
  try {
    const parsed = JSON.parse(raw.trim()) as Partial<VerifiedProduct>;
    return {
      title: parsed.title ?? null,
      price: typeof parsed.price === "number" ? parsed.price : null,
      currency: parsed.currency ?? null,
      in_stock: typeof parsed.in_stock === "boolean" ? parsed.in_stock : null,
      dimensions: parsed.dimensions ?? null,
      materials: Array.isArray(parsed.materials) ? parsed.materials : [],
      available_colors: Array.isArray(parsed.available_colors) ? parsed.available_colors : [],
      available_sizes: Array.isArray(parsed.available_sizes) ? parsed.available_sizes : [],
      shipping_estimate: parsed.shipping_estimate ?? null,
      return_policy_summary: parsed.return_policy_summary ?? null,
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats : [],
    };
  } catch {
    return undefined;
  }
}

export async function runProductVerifier(
  input: ProductVerifierInput,
): Promise<ProductVerifierResult> {
  const driver = createDefaultBrowserDriver({
    screenWidth: 1440,
    screenHeight: 900,
  });
  const goal = buildGoal(input);
  log.info("Product verifier starting", { url: input.productUrl });

  const runResult = await runComputerUseAgent<VerifiedProduct>(driver, {
    startUrl: input.productUrl,
    goal,
    maxTurns: input.maxTurns ?? 10,
    // Verifier is read-only — block anything that could modify state.
    excludedPredefinedFunctions: ["drag_and_drop"],
    // Stop ~30s before the route's 300s maxDuration so we always have headroom
    // to dispose the browser session and return a response instead of being
    // killed mid-turn by the platform.
    maxWallClockMs: 270_000,
    onStep: input.onStep,
  }, {
    parseFinal,
  });

  log.info("Product verifier finished", {
    status: runResult.status,
    turns: runResult.totalTurns,
    hasData: !!runResult.parsedOutput,
  });

  return {
    product: runResult.parsedOutput ?? null,
    source_url: input.productUrl,
    agent_status: runResult.status,
    turns: runResult.totalTurns,
    notes: runResult.error,
  };
}
