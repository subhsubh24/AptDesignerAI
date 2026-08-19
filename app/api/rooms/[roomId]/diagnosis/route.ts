import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/utils/api-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", user.id)
    .single();
  // PGRST116 ("no rows") is the normal shape of "not found or not owned" here
  // — the inner join + eq(user.id) filters it out just like an ownership
  // check would — so it's not logged as a failure; a genuine DB error is.
  if (roomError && roomError.code !== "PGRST116") {
    logServerError("rooms.diagnosis.room", roomError);
  }
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: diagnosis, error: diagnosisError } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (diagnosisError) logServerError("rooms.diagnosis.diagnosis", diagnosisError);

  return NextResponse.json({ diagnosis: diagnosis ?? null });
}
