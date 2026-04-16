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
  if (input.expectedTitle) hints.push(`Expected title (approximate): "${input.expectedTitle}"`);
  if (input.expectedColor) hints.push(`Expected color: ${input.expectedColor}`);
  if (input.expectedSize) hints.push(`Expected size: ${input.expectedSize}`);
  const hintBlock = hints.length
    ? `\n\nCONTEXT:\n${hints.join("\n")}`
    : "";

  return `Your goal: extract the current verified product details from this retailer page.

STARTING URL: ${input.productUrl}${hintBlock}

PROCEDURE:
1. Wait for the page to finish loading. Let it settle for a moment if there's a skeleton state.
2. Confirm this is the product you were asked about. If the page is a category/listing page (not a product page), navigate into the matching product.
3. Scroll if needed to expose the spec section (dimensions, materials).
4. Capture:
   - Exact product title
   - Current price (number) and currency
   - Stock status (in stock, low stock, out of stock, backordered)
   - Dimensions: width × depth × height in inches. If the page shows cm, convert (1 in = 2.54 cm).
   - Materials (couch fabric, leg wood species, etc.)
   - Available colors (from color swatches)
   - Available sizes (if applicable)
   - Shipping estimate ("ships in 2 weeks", "free 2-day", etc.)
   - Return policy summary in one sentence
5. If ANY field is absent or ambiguous, return null for that field and add a short note to "caveats".

SAFETY:
- Do NOT click "Add to Cart" or any checkout/buy buttons.
- Do NOT interact with login, account, or newsletter signup popups.
- If a cookie banner is covering content, you may dismiss it only if it's a non-consequential "Accept" (not a ToS agreement).

WHEN FINISHED:
Stop emitting actions. Respond with a single text block ending in a fenced JSON block:

\`\`\`json
{
  "title": "string or null",
  "price": 123.45,
  "currency": "USD",
  "in_stock": true,
  "dimensions": { "width_in": 72, "depth_in": 36, "height_in": 34 },
  "materials": ["boucle", "oak"],
  "available_colors": ["ivory", "charcoal"],
  "available_sizes": [],
  "shipping_estimate": "ships in 2 weeks",
  "return_policy_summary": "30-day free returns",
  "caveats": ["height only shown in cm — converted"]
}
\`\`\`

The JSON fence must be the last thing in your response.`;
}

function parseFinal(finalText: string): VerifiedProduct | undefined {
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
