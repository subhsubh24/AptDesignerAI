import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { geminiProvider } from "@/lib/ai/gemini";
import { selectModel } from "@/lib/ai/models";
import { thinkingFor } from "@/lib/ai/thinking";
import { extractJsonObject } from "@/lib/ai/extract-json";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";
import { withCostLedger, recordUsage } from "@/lib/observability/cost-meter";
import type { AIContentBlock } from "@/lib/ai/provider";

const ROOM_TYPES = new Set([
  "living_room", "bedroom", "kitchen", "bathroom", "dining_room",
  "home_office", "nursery", "laundry_room", "garage", "basement",
]);

/**
 * POST /api/mobile/analyze
 *
 * Mobile-specific room analysis endpoint. Accepts a Bearer token (from the
 * mobile Supabase session) instead of cookies, and runs a single Pass A
 * (room understanding) directly from an image URL. No project/room DB records
 * are required — the mobile uploads to Supabase Storage first and passes the
 * public URL here.
 *
 * Returns: { analysis: { summary, style_name, design_direction,
 *   recommended_palette, recommended_materials, recommended_textures,
 *   what_works, what_should_go } }
 */
// Long-running LLM pipeline route. Without an explicit maxDuration, Vercel
// applies a short platform default and can kill the function mid-run — a
// "builds green, request gets killed" failure on a core product path. 300s is
// the Vercel Pro ceiling and covers the documented worst-case pipeline latency.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Bearer token auth — mobile clients cannot use cookies
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Validate JWT directly (no cookie session needed)
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: same budget as area-analysis (3 per 5 minutes per user)
  const limit = checkRateLimit(`mobile-analyze:${user.id}`, RATE_LIMITS.areaAnalysis);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many analysis requests. Please wait a few minutes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  let body: { image_url?: unknown; room_type?: unknown };
  try {
    body = await request.json() as { image_url?: unknown; room_type?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { image_url, room_type } = body;
  if (!image_url || typeof image_url !== "string") {
    return NextResponse.json({ error: "image_url is required" }, { status: 400 });
  }

  // SSRF guard: image_url must be an https URL on our own Supabase Storage host
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(image_url);
  } catch {
    return NextResponse.json({ error: "image_url is not a valid URL" }, { status: 400 });
  }
  const supabaseHost = new URL(supabaseUrl).hostname;
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== supabaseHost) {
    return NextResponse.json({ error: "image_url must be a Supabase Storage URL" }, { status: 400 });
  }

  const roomTypeName =
    typeof room_type === "string" && ROOM_TYPES.has(room_type.trim())
      ? room_type.trim()
      : "living_room";

  try {
    return await withCostLedger(async (summary) => {
      const model = selectModel("area_analysis");
      const { thinkingLevel } = thinkingFor("area_analysis");

      const contentBlocks: AIContentBlock[] = [
        { type: "image", source: { type: "url", url: image_url } },
      ];

      const displayRoomType = roomTypeName.replace(/_/g, " ");
      const prompt = buildMobilePassAPrompt(displayRoomType);

      const response = await geminiProvider.chat({
        model,
        system: "You are an expert interior designer analyzing room photos for a mobile design app. Provide specific, actionable analysis grounded in what you actually see in the photo.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt } as AIContentBlock,
              ...contentBlocks,
            ],
          },
        ],
        max_tokens: 8192,
        seed: DETERMINISTIC_SEED,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel },
      });

      recordUsage("mobile-pass-a", model, response.usage, { thinkingLevel });

      const s = summary();
      console.log(`[mobile/analyze] user=${user.id} room=${roomTypeName} tokens=${s.totalTokens}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = extractJsonObject<any>(response.content);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return NextResponse.json({ error: "Analysis failed — unexpected AI response shape" }, { status: 500 });
      }

      if (typeof raw.summary !== "string" || !raw.summary) {
        return NextResponse.json({ error: "Analysis failed — incomplete AI response" }, { status: 500 });
      }

      // Guard array fields so a malformed AI response does not crash the mobile client
      const arrayFields = [
        "recommended_palette", "recommended_materials", "recommended_textures",
        "what_works", "what_should_go",
      ];
      for (const field of arrayFields) {
        if (!Array.isArray(raw[field])) {
          return NextResponse.json({ error: "Analysis failed — malformed AI response" }, { status: 500 });
        }
      }

      return NextResponse.json({ analysis: raw });
    });
  } catch (err) {
    console.error("[mobile/analyze] LLM error", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

function buildMobilePassAPrompt(roomType: string): string {
  return `Analyze this ${roomType} photo and provide a comprehensive room understanding.

Study the photo carefully:
- Identify every visible piece of furniture, finish, lighting element, and fixture.
- Note what's working well and what needs improvement.
- Determine a design direction based on the existing aesthetic and materials.

<critical_rules>
WHAT_WORKS — every entry must be a physical object the owner has and can move:
✅ furniture, decor, lamps, art, textiles, baskets
❌ NEVER include: flooring, countertops, walls, built-ins, ceiling fixtures, appliances

WHAT_SHOULD_GO — only removable items clearly visible in the photo:
✅ "Black laminate TV stand — undersized, wrong material, clashes with warm palette"
❌ NEVER include: absences, architectural features, hypotheticals, vague phrases

NAME EVERYTHING specifically: material + color + form. Never use "generic furniture" or "clutter".
</critical_rules>

Return ONLY valid JSON (no markdown, no prose, no code fences):
{
  "summary": "3-4 sentences — dominant colors, materials, what's working, what's broken. Mention flooring and wall finishes here, not in what_works.",
  "style_name": "2-3 word evocative label from the room's actual cues. GOOD: 'Industrial Warmth', 'Nordic Calm', 'Cognac and Charcoal'. BAD: 'Contemporary Modern', 'Refined Minimalism'.",
  "design_direction": "4-6 sentences — color strategy, material mixing, texture layering. Specific and actionable. Reference the actual finishes visible in the photo.",
  "recommended_palette": ["4-6 specific colors — e.g. 'warm ivory', 'walnut brown', 'sage green', 'matte black'"],
  "recommended_materials": ["4-6 materials — e.g. 'solid walnut', 'linen', 'brushed brass', 'natural jute'"],
  "recommended_textures": ["3-5 textures — e.g. 'bouclé', 'woven rattan', 'matte ceramic', 'raw linen weave'"],
  "what_works": ["Exact item — color + material + form. What the owner should KEEP. Only movable furniture and decor you can see."],
  "what_should_go": ["Exact item + why. What the owner should REMOVE or REPLACE. Only removable items you can actually see in the photo."]
}`;
}
