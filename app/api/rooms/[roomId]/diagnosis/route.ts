import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: room } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: diagnosis } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ diagnosis: diagnosis ?? null });
}
