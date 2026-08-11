import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/utils/api-error";

type OwnershipRow = { data: unknown; error: { code?: string } | null };

/**
 * Classifies an ownership query's result into a response the caller should
 * return immediately, or `null` to proceed (ownership confirmed).
 *
 * A genuine miss — no row, or Postgres "zero rows" (PGRST116) — is a 404.
 * Anything else (a connection drop, too-many-connections, etc.) is a real DB
 * failure and must NOT be reported as "not found": that silently tells the
 * caller (and any retry logic) the resource doesn't exist when the truth is
 * "we couldn't check." See APT-16.
 */
function ownershipVerdict(scope: string, { data, error }: OwnershipRow): NextResponse | null {
  if (data) return null;
  if (error && error.code !== "PGRST116") return apiError(scope, error);
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function fetchRoomOwnership(supabase: SupabaseClient, roomId: string, userId: string): Promise<OwnershipRow> {
  return supabase
    .from("rooms")
    .select("id, projects!inner(user_id)")
    .eq("id", roomId)
    .eq("projects.user_id", userId)
    .single();
}

async function fetchProjectOwnership(supabase: SupabaseClient, projectId: string, userId: string): Promise<OwnershipRow> {
  return supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
}

async function fetchCandidateProductOwnership(supabase: SupabaseClient, productId: string, userId: string): Promise<OwnershipRow> {
  return supabase
    .from("candidate_products")
    .select("id, rooms!inner(projects!inner(user_id))")
    .eq("id", productId)
    .eq("rooms.projects.user_id", userId)
    .single();
}

/**
 * Ownership guard for room-scoped routes: returns a `NextResponse` the route
 * must return immediately (404 "not found", or 500 on a real DB error), or
 * `null` when ownership is confirmed and the route should proceed.
 */
export async function requireRoomOwnership(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<NextResponse | null> {
  return ownershipVerdict("ownership.room", await fetchRoomOwnership(supabase, roomId, userId));
}

/** Ownership guard for project-scoped routes. See `requireRoomOwnership`. */
export async function requireProjectOwnership(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<NextResponse | null> {
  return ownershipVerdict("ownership.project", await fetchProjectOwnership(supabase, projectId, userId));
}

/** Ownership guard for candidate-product routes. See `requireRoomOwnership`. */
export async function requireCandidateProductOwnership(
  supabase: SupabaseClient,
  productId: string,
  userId: string,
): Promise<NextResponse | null> {
  return ownershipVerdict(
    "ownership.candidateProduct",
    await fetchCandidateProductOwnership(supabase, productId, userId),
  );
}
