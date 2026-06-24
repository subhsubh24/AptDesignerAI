import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// In-memory rate limiter: 5 requests per IP per 15 minutes.
// Acceptable for a single-instance deployment; swap for Upstash Redis if needed.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const ipBucket = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipBucket.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof (body as Record<string, unknown>).email === "string"
    ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
    : "";

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Waitlist sign-up is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const { error } = await admin.from("waitlist_emails").insert({ email, source: "waitlist" });

  if (error) {
    if (error.code === "23505") {
      // Unique constraint violation — already on the list
      return NextResponse.json({ alreadySubscribed: true }, { status: 200 });
    }
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
