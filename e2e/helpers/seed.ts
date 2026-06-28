/**
 * Test seeding helpers for the runtime functional journey suite.
 *
 * Signup itself no longer requires email verification (the server route
 * auto-confirms — see app/api/auth/signup/route.ts), so a real UI signup now
 * reaches the dashboard directly. These helpers still seed a CONFIRMED user via
 * the Supabase admin (service-role) client for the journeys that need a
 * pre-existing account (sign-in, account, paywall) without re-running the signup
 * form each time.
 *
 * This requires a real auth backend (Supabase-local in CI). When the
 * service-role env is absent, `adminAvailable()` is false and the authed
 * journeys skip — the public/structural journeys still run everywhere.
 *
 * NEVER point this at a production/shared project: it creates and deletes
 * real users. CI stands up an ephemeral, fully-migrated Supabase-local DB.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True only when the service-role env needed to seed users is present. */
export function adminAvailable(): boolean {
  return Boolean(url && serviceKey);
}

function admin(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "seed: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required to seed test users",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A unique, clearly-fake test email (UUID-based; no Math.random in the repo). */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${randomUUID()}@e2e.aptdesigner.local`;
}

/** Create an already-confirmed user so login works without the email link. */
export async function createConfirmedUser(
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "E2E Tester" },
  });
  if (error || !data.user) {
    throw new Error(`seed: createUser failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/** Best-effort teardown — never fail a test because cleanup hiccupped. */
export async function deleteUser(id: string): Promise<void> {
  try {
    await admin().auth.admin.deleteUser(id);
  } catch {
    /* best-effort */
  }
}
