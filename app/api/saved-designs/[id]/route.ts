import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, logServerError } from "@/lib/utils/api-error";
import { getCurrentUserId } from "@/lib/supabase/server";
import { enforceWriteRateLimit, DELETE_WRITE_LIMIT } from "@/lib/utils/write-rate-limit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getCurrentUserId();
  // null means the request has no established identity; `.eq("user_id", null)`
  // is not an ownership check, so refuse rather than query on it.
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("saved_designs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return apiError(
      "saved-designs.byId.get",
      error ?? "Query returned no data",
      error && error.code !== "PGRST116" ? 500 : 404,
      error && error.code !== "PGRST116" ? "Something went wrong. Please try again." : "Not found",
    );
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(userId, "saved-designs:update");
  if (limited) return limited;

  let body: { is_public?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const is_public = body.is_public ?? false;

  // Verify ownership and get existing share_token
  const { data: existing, error: existingError } = await supabase
    .from("saved_designs")
    .select("id, share_token, is_public")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) logServerError("saved-designs.update.existing", existingError);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Preserve existing token when toggling off so the URL stays valid if re-enabled
  const share_token = is_public
    ? (existing.share_token ?? randomBytes(16).toString("hex"))
    : existing.share_token;

  const { data: updated, error } = await supabase
    .from("saved_designs")
    .update({ is_public, share_token, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  // `.select().single()` is load-bearing, not decoration: PostgREST returns NO
  // body for an update unless the rows are asked for, so without it `data` is
  // null on SUCCESS and the guard below rejects every share toggle that in fact
  // wrote. With it, a row that vanished between the ownership read above and
  // this write surfaces as a no-rows error instead. Same shape as the sibling
  // PATCH handlers in projects/[projectId] and rooms/[roomId].
  if (error || !updated) {
    return apiError("saved-designs.byId", error ?? "Update failed");
  }

  return NextResponse.json({ share_token, is_public });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = enforceWriteRateLimit(userId, "saved-designs:delete", DELETE_WRITE_LIMIT);
  if (limited) return limited;

  const { error } = await supabase
    .from("saved_designs")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return apiError("saved-designs.byId", error);
  }

  return NextResponse.json({ deleted: true });
}
