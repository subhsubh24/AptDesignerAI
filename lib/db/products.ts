// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
import type { CandidateProduct, ProductEvaluation } from "@/lib/types/database";

export async function getProducts(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as (CandidateProduct & { product_evaluations: ProductEvaluation[] })[];
}

export async function getProduct(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as CandidateProduct & { product_evaluations: ProductEvaluation[] };
}

export async function createProduct(
  supabase: SupabaseClient,
  input: Partial<CandidateProduct> & { room_id: string }
) {
  const { data, error } = await supabase
    .from("candidate_products")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as CandidateProduct;
}

export async function updateProductStatus(
  supabase: SupabaseClient,
  id: string,
  status: string
) {
  const { data, error } = await supabase
    .from("candidate_products")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as CandidateProduct;
}

export async function saveProductEvaluation(
  supabase: SupabaseClient,
  evaluation: Omit<ProductEvaluation, "id" | "created_at">
) {
  const { data, error } = await supabase
    .from("product_evaluations")
    .insert(evaluation)
    .select()
    .single();
  if (error) throw error;
  return data as ProductEvaluation;
}
