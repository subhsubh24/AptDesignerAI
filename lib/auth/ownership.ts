import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifies the authenticated user owns the given room via its project.
 * Returns true only when the room exists AND belongs to a project owned by `userId`.
 * Uses the provided (user-scoped) client so RLS still applies as defence-in-depth.
 */
export async function userOwnsRoom(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", userId)
    .single();
  return Boolean(data);
}

/**
 * Verifies the authenticated user owns the candidate product
 * (via room → project → user chain).
 */
export async function userOwnsCandidateProduct(
  supabase: SupabaseClient,
  productId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("candidate_products")
    .select("id, rooms!inner(projects!inner(user_id))")
    .eq("id", productId)
    .eq("rooms.projects.user_id", userId)
    .single();
  return Boolean(data);
}
