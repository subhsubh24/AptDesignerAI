import { createMemoryClient } from "@/lib/store/memory-store";

/**
 * Returns the in-memory store client (admin).
 * Replaces Supabase admin client — no external database needed.
 */
export function createAdminClient() {
  return createMemoryClient();
}
