import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { checkDailySpend, dailySpendExceededResponse } from "@/lib/utils/spend-limiter";

const CACHE = new Map<string, { url: string; attributions: string[]; ts: number }>();
const TTL = 24 * 60 * 60 * 1000; // 24h

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`places-photo:${user.id}`, RATE_LIMITS.placesPhoto);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs || 60000) / 1000)) } },
    );
  }

  // Google Places is a paid API (~$7 / 1000 photo requests). Rate limiting caps
  // burst rate but not daily volume, so gate it behind the same per-user daily
  // spend breaker as the other paid endpoints — otherwise a single authed user
  // enumerating place_ids can drain the daily API budget.
  const spend = checkDailySpend(user.id);
  if (!spend.allowed) return dailySpendExceededResponse(spend);

  const placeId = req.nextUrl.searchParams.get("place_id");
  if (!placeId || !/^[A-Za-z0-9_-]+$/.test(placeId)) {
    return NextResponse.json({ error: "Valid place_id required" }, { status: 400 });
  }

  const cached = CACHE.get(placeId);
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ photoUrl: cached.url, attributions: cached.attributions });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "maps api key not configured" }, { status: 500 });
  }

  try {
    // Step 1: Get place details with photos field. Auth via header so the
    // key never appears in URLs / access logs / Referer headers.
    const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=photos`;
    const detailsRes = await fetch(detailsUrl, {
      headers: {
        "X-Goog-FieldMask": "photos",
        "X-Goog-Api-Key": apiKey,
      },
      // Bound the external call so a stalled Google connection can't hold the
      // serverless function open to its full budget.
      signal: AbortSignal.timeout(5000),
    });

    if (!detailsRes.ok) {
      return NextResponse.json({ error: "places lookup failed" }, { status: 502 });
    }

    const details = (await detailsRes.json()) as {
      photos?: Array<{ name: string; authorAttributions?: Array<{ displayName: string }> }>;
    };

    if (!details.photos?.length) {
      return NextResponse.json({ photoUrl: null, attributions: [] });
    }

    const photo = details.photos[0];
    const attributions = (photo.authorAttributions ?? []).map((a) => a.displayName);

    // Step 2: Get photo media URL (header-auth)
    const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=480&maxWidthPx=640`;
    const mediaRes = await fetch(mediaUrl, {
      redirect: "follow",
      headers: { "X-Goog-Api-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!mediaRes.ok) {
      return NextResponse.json({ photoUrl: null, attributions: [] });
    }

    const finalUrl = mediaRes.url;
    CACHE.set(placeId, { url: finalUrl, attributions, ts: Date.now() });

    return NextResponse.json({ photoUrl: finalUrl, attributions });
  } catch {
    return NextResponse.json({ error: "photo fetch failed" }, { status: 502 });
  }
}
