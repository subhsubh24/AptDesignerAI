import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceWriteRateLimit } from "@/lib/utils/write-rate-limit";

// User-scoped (cookie-authed) endpoint for managing the signed-in user's
// marketing-email preference. Uses the request-scoped client so RLS (migration
// 027) confines every read/write to the caller's own row — no admin client, no
// trust in a client-supplied user id.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_email_preferences")
    .select("marketing_emails")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[email-preferences] read error:", error.message);
    return NextResponse.json({ error: "Couldn't load your preferences." }, { status: 500 });
  }

  // No row → subscribed by default (matches the marketing send-path default).
  return NextResponse.json({ marketingEmails: data ? data.marketing_emails !== false : true });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(user.id, "email-preferences");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketingEmails = (body as Record<string, unknown>).marketingEmails;
  if (typeof marketingEmails !== "boolean") {
    return NextResponse.json({ error: "marketingEmails must be a boolean." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_email_preferences")
    .upsert(
      { user_id: user.id, marketing_emails: marketingEmails, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[email-preferences] write error:", error.message);
    return NextResponse.json({ error: "Couldn't save your preferences." }, { status: 500 });
  }

  return NextResponse.json({ marketingEmails });
}
