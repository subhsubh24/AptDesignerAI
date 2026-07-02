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
 *
 * Fail LOUD on a WRONG key (§28 / §32): a present-but-wrong key — pasting the
 * ANON key into SUPABASE_SERVICE_ROLE_KEY — constructs a client fine but makes
 * every admin call fail with a cryptic "User not allowed", which surfaced only
 * as a generic 500 and once fully blocked signup in prod. We reject it at
 * construction with a specific, actionable error instead.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Role encoded in a legacy Supabase JWT key (`service_role` for admin, `anon`
 * for the public key). Returns null when the key isn't a decodable JWT (e.g. the
 * newer `sb_secret_…` / `sb_publishable_…` format), in which case we fall back
 * to the prefix check below.
 */
function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Reject a key that clearly cannot act as service_role, with an actionable
 * message, BEFORE any admin call fails cryptically downstream.
 */
export function assertServiceRoleKey(key: string): void {
  const role = jwtRole(key);
  if (role && role !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY is a "${role}" key, not the service_role key — ` +
        `admin operations (createUser, RLS bypass) will fail with "User not allowed". ` +
        `Copy the service_role secret from Supabase → Settings → API.`,
    );
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY is a publishable key (sb_publishable_…), not the secret key. ` +
        `Use the sb_secret_… key from Supabase → Settings → API.`,
    );
  }
}

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
    assertServiceRoleKey(key); // §28: fail loud on a wrong-key misconfiguration
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
