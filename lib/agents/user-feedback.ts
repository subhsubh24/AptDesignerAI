// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

import type { CandidateProduct, ProductEvaluation } from "@/lib/types/database";

type ReviewedProduct = CandidateProduct & {
  product_evaluations: ProductEvaluation[];
};

const MAX_ITEMS_PER_STATUS = 10;

/**
 * Loads user feedback from past product evaluations within the same project.
 * Returns a context string that can be injected into scoring prompts to enable
 * cross-session learning from accepted/rejected products.
 */
export async function loadUserFeedbackContext(
  supabase: SupabaseClient,
  roomId: string,
  projectId: string
): Promise<string> {
  // Find all rooms in this project so we can gather project-wide feedback
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id")
    .eq("project_id", projectId);

  if (roomsError || !rooms || rooms.length === 0) {
    return "";
  }

  const roomIds = rooms.map((r: { id: string }) => r.id);

  // Query accepted products with their evaluations
  const { data: accepted, error: acceptedError } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
    .in("room_id", roomIds)
    .eq("status", "accepted")
    .order("updated_at", { ascending: false })
    .limit(MAX_ITEMS_PER_STATUS);

  // Query rejected products with their evaluations
  const { data: rejected, error: rejectedError } = await supabase
    .from("candidate_products")
    .select("*, product_evaluations(*)")
    .in("room_id", roomIds)
    .eq("status", "rejected")
    .order("updated_at", { ascending: false })
    .limit(MAX_ITEMS_PER_STATUS);

  if (acceptedError || rejectedError) {
    return "";
  }

  const acceptedProducts = (accepted ?? []) as ReviewedProduct[];
  const rejectedProducts = (rejected ?? []) as ReviewedProduct[];

  if (acceptedProducts.length === 0 && rejectedProducts.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## USER FEEDBACK FROM PAST SEARCHES",
    "The user has previously reviewed products for this apartment. Learn from their preferences:",
    "",
  ];

  if (acceptedProducts.length > 0) {
    lines.push("ACCEPTED (user liked these):");
    for (const product of acceptedProducts) {
      lines.push(formatProductLine(product, "accepted"));
    }
    lines.push("");
  }

  if (rejectedProducts.length > 0) {
    lines.push("REJECTED (user disliked these):");
    for (const product of rejectedProducts) {
      lines.push(formatProductLine(product, "rejected"));
    }
    lines.push("");
  }

  lines.push(
    "Use this feedback to calibrate: if the user rejected items similar to what you're scoring, penalize. If they accepted similar items, that confirms the direction."
  );

  return lines.join("\n");
}

function formatProductLine(
  product: ReviewedProduct,
  status: "accepted" | "rejected"
): string {
  const title = product.title ?? "Untitled";
  const category = product.category ?? "unknown";
  const priceStr = product.price != null ? `$${product.price}` : "N/A";

  const evaluation = product.product_evaluations?.[0];
  const scoreStr =
    evaluation?.final_item_score != null
      ? evaluation.final_item_score.toFixed(1)
      : "N/A";

  return `- "${title}" (${category}, ${priceStr}) — scored ${scoreStr}, user ${status}`;
}
