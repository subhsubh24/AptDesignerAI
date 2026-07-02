import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { getCurrentUserId } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("saved_designs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  let body: { is_public?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const is_public = body.is_public ?? false;

  // Verify ownership and get existing share_token
  const { data: existing } = await supabase
    .from("saved_designs")
    .select("id, share_token, is_public")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

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
    .eq("user_id", userId);

  // `data` is null when no rows matched (e.g. deleted between read and write)
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
