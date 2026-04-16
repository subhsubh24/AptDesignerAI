/**
 * Floor-plan navigator — Computer Use agent specialized for extracting the
 * full list of floor-plan variants from a building's website.
 *
 * Used as a FALLBACK when the text-only research pass (apartment-research)
 * either returns zero variants, or returns variants without images (a
 * strong signal that urlContext couldn't render JavaScript-gated tabs).
 *
 * The agent browses the site, clicks through every floor-plan variant for
 * the target bed/bath count, and reports back a structured list. A final
 * JSON fence at the end of the run is parsed into FloorPlanVariant[].
 */

import { runComputerUseAgent } from "./agent-loop";
import { createDefaultBrowserDriver } from "./browserbase-driver";
import type { AgentRunResult, AgentStepLog } from "./types";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("floor-plan-navigator");

export interface FloorPlanNavigatorInput {
  buildingUrl: string;
  bedrooms: number;
  bathrooms: number;
  /** Helps the agent target the correct variant when the site has many. */
  targetSqft?: number | null;
  maxTurns?: number;
  onStep?: (step: AgentStepLog) => void;
}

export interface NavigatedFloorPlanVariant {
  name: string;
  sqft: number | string | null;
  floor_plan_image_url: string | null;
  room_layout?: string | null;
  living_dining_combined?: boolean | null;
  kitchen_style?: string | null;
  notable_spatial_features?: string[];
}

export interface FloorPlanNavigatorResult {
  variants: NavigatedFloorPlanVariant[];
  source_url: string | null;
  agent_status: AgentRunResult<{ variants: NavigatedFloorPlanVariant[] }>["status"];
  turns: number;
  notes?: string;
}

function buildGoal(input: FloorPlanNavigatorInput): string {
  const bbl = `${input.bedrooms}-bedroom ${input.bathrooms}-bathroom`;
  const sqftHint = input.targetSqft
    ? `\n\nFOCUS: The user lives in a ${input.targetSqft} sqft unit. Make sure that EXACT variant is included in your final list, not just similar ones.`
    : "";

  return `Your goal: find EVERY ${bbl} floor-plan variant on this building's website and return them as structured JSON.

STARTING URL: ${input.buildingUrl}

PROCEDURE:
1. From the homepage, find the link to "Floor Plans" / "Floorplans" / "Apartments" / "Availability". Click it.
2. On the floor-plans page, filter or scroll to the ${bbl} category.
3. Click through EVERY variant card/tab. Buildings typically have 3–10 variants per bed/bath count (names like "A1", "S 1.2", "N J1.6", "The Loop"). Missing any is a failure.
4. For each variant, note:
   - name
   - sqft
   - the DIRECT floor-plan image URL (right-click the image → view its URL, or read from the <img src>)
   - brief layout description (open-concept? galley kitchen? living/dining combined?)
   - notable features (walk-in closet, balcony, en-suite)
5. If the current page doesn't expose images directly, open each variant's detail page and grab the image URL there.${sqftHint}

WHEN FINISHED:
Stop emitting actions. Respond with a single text block containing your findings. The last part of your response MUST be a fenced JSON block in this exact schema:

\`\`\`json
{
  "variants": [
    {
      "name": "string",
      "sqft": "number or string or null",
      "floor_plan_image_url": "string or null",
      "room_layout": "string or null",
      "living_dining_combined": "true | false | null",
      "kitchen_style": "string or null",
      "notable_spatial_features": ["string"]
    }
  ],
  "source_url": "the floor-plans page URL you ended on"
}
\`\`\`

Do not wrap this block in prose after it. The JSON fence must be the last thing in your response.`;
}

/**
 * Parse the agent's final text to extract the JSON payload. The final
 * response is expected to end with a \`\`\`json ... \`\`\` block; we look
 * for the last such block defensively.
 */
function parseFinal(finalText: string): {
  variants: NavigatedFloorPlanVariant[];
  source_url?: string | null;
} | undefined {
  if (!finalText) return undefined;
  const fenceMatches = [...finalText.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const lastFence = fenceMatches[fenceMatches.length - 1];
  const raw = lastFence ? lastFence[1] : finalText;

  try {
    const parsed = JSON.parse(raw.trim());
    if (!parsed || !Array.isArray(parsed.variants)) return undefined;
    return parsed;
  } catch {
    // Try to salvage a JSON object from the text
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        const salvaged = JSON.parse(raw.slice(braceStart, braceEnd + 1));
        if (salvaged && Array.isArray(salvaged.variants)) return salvaged;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export async function runFloorPlanNavigator(
  input: FloorPlanNavigatorInput,
): Promise<FloorPlanNavigatorResult> {
  const driver = createDefaultBrowserDriver({
    screenWidth: 1440,
    screenHeight: 900,
  });

  const goal = buildGoal(input);
  log.info("Floor-plan navigator starting", {
    building: input.buildingUrl,
    beds: input.bedrooms,
    baths: input.bathrooms,
    targetSqft: input.targetSqft,
  });

  const runResult = await runComputerUseAgent<{
    variants: NavigatedFloorPlanVariant[];
    source_url?: string | null;
  }>(driver, {
    startUrl: input.buildingUrl,
    goal,
    // Maps / floor plans can require 10+ clicks (homepage → floor plans → each
    // variant tab). 20 gives real headroom without burning hours.
    maxTurns: input.maxTurns ?? 20,
    excludedPredefinedFunctions: ["drag_and_drop"],
    onStep: input.onStep,
  }, {
    parseFinal,
  });

  const parsed = runResult.parsedOutput;
  log.info("Floor-plan navigator finished", {
    status: runResult.status,
    turns: runResult.totalTurns,
    variants: parsed?.variants?.length ?? 0,
  });

  return {
    variants: parsed?.variants ?? [],
    source_url: parsed?.source_url ?? null,
    agent_status: runResult.status,
    turns: runResult.totalTurns,
    notes: runResult.error,
  };
}
