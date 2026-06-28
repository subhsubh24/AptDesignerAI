import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/utils/api-error";
import { userOwnsCandidateProduct } from "@/lib/auth/ownership";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userOwnsCandidateProduct(supabase, productId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedFields: Record<string, unknown> = {};
  const ALLOWED_KEYS = [
    "title", "category", "retailer", "product_url", "image_url",
    "price", "dimensions", "materials", "colors", "description",
    "source_type", "metadata", "user_rating", "user_notes",
  ];
  for (const key of ALLOWED_KEYS) {
    if (key in body) allowedFields[key] = body[key];
  }
  allowedFields.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("candidate_products")
    .update(allowedFields)
    .eq("id", productId)
    .select()
    .single();

  if (error) return apiError("products.byId", error);
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await userOwnsCandidateProduct(supabase, productId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase.from("candidate_products").delete().eq("id", productId);
  if (error) return apiError("products.byId", error);
  return NextResponse.json({ success: true });
}
