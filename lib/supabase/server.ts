import { createMemoryClient } from "@/lib/store/memory-store";

/**
 * Returns the in-memory store client.
 * Replaces Supabase server client — no external database needed.
 */
export async function createClient() {
  return createMemoryClient();
}
