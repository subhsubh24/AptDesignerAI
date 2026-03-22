// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type { RoomDiagnosis } from "@/lib/types/database";

export async function getDiagnosis(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase
    .from("room_diagnoses")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data as RoomDiagnosis | null;
}

export async function saveDiagnosis(
  supabase: SupabaseClient,
  input: Omit<RoomDiagnosis, "id" | "created_at">
) {
  const { data, error } = await supabase
    .from("room_diagnoses")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as RoomDiagnosis;
}
