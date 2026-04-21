/**
 * Real Supabase admin client — service-role key, bypasses RLS.
 *
 * Used ONLY by background / agent pipelines that need persistent storage
 * across server restarts (Computer Use cache, agent logs). The main app
 * uses the in-memory store for local dev; this module gives the CU
 * pipeline durable Supabase-backed storage without touching that layer.
 *
 * Graceful degradation: if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are
 * absent, `getAdminClient()` returns null and callers should skip
 * Supabase operations silently.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "getAdminClient() must never be called in a browser context — service-role key would be exposed.",
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  if (!_client) {
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
