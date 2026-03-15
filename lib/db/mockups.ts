import type { SupabaseClient } from "@supabase/supabase-js";
import type { MockupJob } from "@/lib/types/database";

export async function getMockups(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase
    .from("mockup_jobs")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as MockupJob[];
}

export async function createMockupJob(
  supabase: SupabaseClient,
  input: {
    room_id: string;
    bundle_id?: string;
    prompt?: string;
    selected_products?: Record<string, unknown>;
    generation_provider?: string;
  }
) {
  const { data, error } = await supabase
    .from("mockup_jobs")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as MockupJob;
}

export async function updateMockupJob(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<MockupJob>
) {
  const { data, error } = await supabase
    .from("mockup_jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as MockupJob;
}
