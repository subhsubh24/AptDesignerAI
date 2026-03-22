// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type { ProductBundle, ProductBundleItem, BundleEvaluation } from "@/lib/types/database";

export async function getBundles(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, candidate_products(*)), bundle_evaluations(*)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createBundle(
  supabase: SupabaseClient,
  input: { room_id: string; name?: string; description?: string }
) {
  const { data, error } = await supabase
    .from("product_bundles")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ProductBundle;
}

export async function addBundleItem(
  supabase: SupabaseClient,
  input: { bundle_id: string; product_id: string; category?: string; sort_order?: number }
) {
  const { data, error } = await supabase
    .from("product_bundle_items")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ProductBundleItem;
}

export async function saveBundleEvaluation(
  supabase: SupabaseClient,
  evaluation: Omit<BundleEvaluation, "id" | "created_at">
) {
  const { data, error } = await supabase
    .from("bundle_evaluations")
    .insert(evaluation)
    .select()
    .single();
  if (error) throw error;
  return data as BundleEvaluation;
}
