import { NextRequest, NextResponse } from "next/server";

const CACHE = new Map<string, { url: string; attributions: string[]; ts: number }>();
const TTL = 24 * 60 * 60 * 1000; // 24h

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("place_id");
  if (!placeId) {
    return NextResponse.json({ error: "place_id required" }, { status: 400 });
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
    // Step 1: Get place details with photos field
    const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=photos&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl, {
      headers: { "X-Goog-FieldMask": "photos" },
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

    // Step 2: Get photo media URL
    const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=480&maxWidthPx=640&key=${apiKey}`;
    const mediaRes = await fetch(mediaUrl, { redirect: "follow" });

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
