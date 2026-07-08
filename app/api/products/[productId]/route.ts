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

  // Server-side input validation (client Zod is UX, not security): reject
  // oversized/malformed writes before they reach the DB (Track G2). Mirrors the
  // bounds the sibling POST /api/products already enforces so a PATCH can't
  // smuggle unbounded strings/arrays/objects past them. Bounds are abuse-only.
  const STRING_FIELDS = [
    "title", "category", "retailer", "product_url", "image_url",
    "description", "source_type", "user_notes",
  ] as const;
  for (const f of STRING_FIELDS) {
    const v = body[f];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 2000)) {
      return NextResponse.json({ error: `${f} must be a string of at most 2000 characters` }, { status: 400 });
    }
  }
  for (const f of ["price", "user_rating"] as const) {
    const v = body[f];
    if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v))) {
      return NextResponse.json({ error: `${f} must be a finite number` }, { status: 400 });
    }
  }
  for (const f of ["materials", "colors"] as const) {
    const v = body[f];
    if (v !== undefined && v !== null && (!Array.isArray(v) || v.length > 100 || v.some((x: unknown) => typeof x !== "string" || x.length > 500))) {
      return NextResponse.json({ error: `${f} must be an array of at most 100 strings (each at most 500 characters)` }, { status: 400 });
    }
  }
  for (const f of ["dimensions", "metadata"] as const) {
    const v = body[f];
    if (v !== undefined && v !== null && (typeof v !== "object" || Array.isArray(v) || JSON.stringify(v).length > 50_000)) {
      return NextResponse.json({ error: `${f} must be an object of at most 50KB` }, { status: 400 });
    }
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
