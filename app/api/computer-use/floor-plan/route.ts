/**
 * POST /api/computer-use/floor-plan
 *
 * User-initiated floor-plan navigator. Kicks off a Gemini Computer Use
 * agent that visits `building_url`, clicks through every floor-plan
 * variant tab, and returns the structured list.
 *
 * Gated behind ENABLE_COMPUTER_USE=1 so the route is a no-op in any
 * deployment that hasn't opted in (and doesn't have Browserbase creds).
 *
 * If project_id is provided, the result is merged into
 * projects.building_research.floor_plan.unit_variants so downstream
 * agents (diagnosis, search) see the expanded list immediately.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFloorPlanNavigator } from "@/lib/agents/computer-use/floor-plan-navigator";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api-computer-use-floor-plan");

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
  const { building_url, bedrooms, bathrooms, target_sqft, project_id } = body as {
    building_url?: string;
    bedrooms?: number;
    bathrooms?: number;
    target_sqft?: number | null;
    project_id?: string;
  };

  if (!building_url || typeof building_url !== "string") {
    return NextResponse.json({ error: "building_url required" }, { status: 400 });
  }

  try {
    const result = await runFloorPlanNavigator({
      buildingUrl: building_url,
      bedrooms: typeof bedrooms === "number" ? bedrooms : 1,
      bathrooms: typeof bathrooms === "number" ? bathrooms : 1,
      targetSqft: typeof target_sqft === "number" ? target_sqft : null,
    });

    // Merge into project building_research if a project_id was passed.
    if (project_id && result.variants.length > 0) {
      const { data: project } = await supabase
        .from("projects")
        .select("building_research")
        .eq("id", project_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (project) {
        const existingBr = (project.building_research as Record<string, unknown>) || {};
        const existingFp = (existingBr.floor_plan as Record<string, unknown> | undefined) ?? {};
        const existingVariants = Array.isArray(existingFp.unit_variants)
          ? (existingFp.unit_variants as Array<{ name?: string | null }>)
          : [];
        const existingNames = new Set(
          existingVariants
            .map((v) => (typeof v.name === "string" ? v.name.toLowerCase().trim() : null))
            .filter(Boolean),
        );
        // Only append variants we didn't already know about — avoid duplication
        // when this route is re-run.
        const newVariants = result.variants.filter(
          (v) => !existingNames.has(v.name.toLowerCase().trim()),
        );
        const mergedVariants = [...existingVariants, ...newVariants];

        const updatedBr = {
          ...existingBr,
          floor_plan: {
            ...existingFp,
            unit_variants: mergedVariants,
            computer_use_sourced: {
              source_url: result.source_url,
              status: result.agent_status,
              added: newVariants.length,
              turns: result.turns,
            },
          },
        };

        await supabase
          .from("projects")
          .update({ building_research: updatedBr })
          .eq("id", project_id);

        log.info("Merged Computer Use variants into project", {
          project_id,
          existing: existingVariants.length,
          added: newVariants.length,
        });
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    log.error("Floor-plan navigator failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
