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

// A fixed far-future period end so the entitlement never expires mid-suite AND
// no wall-clock (Date.now/new Date) enters the test — keeping the seed
// deterministic-checker clean, like the rest of this file.
const FAR_FUTURE = "2099-12-31T00:00:00.000Z";

/**
 * Seed an ACTIVE Pro entitlement for a user by inserting the `stripe_customers`
 * row the Stripe webhook would normally write. This lets the paywall-UNLOCK
 * journey assert that the UI reflects Pro entitlement WITHOUT a live Stripe
 * checkout — the same way `createConfirmedUser` seeds a confirmed account
 * without the email link. Service-role bypasses RLS, so the insert succeeds even
 * though authenticated users have no INSERT policy on the table (migration 018).
 *
 * `hasProEntitlementWeb`/`getWebBillingStatus` read exactly these columns, so a
 * tier='pro' + status='active' + future period-end row makes `hasPaid` true and
 * the free-tier upgrade surface disappears — the intended unlock outcome.
 */
export async function seedProEntitlement(userId: string): Promise<void> {
  const { error } = await admin().from("stripe_customers").insert({
    user_id: userId,
    stripe_customer_id: `cus_e2e_${userId}`,
    stripe_subscription_id: `sub_e2e_${userId}`,
    tier: "pro",
    status: "active",
    current_period_end: FAR_FUTURE,
  });
  if (error) {
    throw new Error(`seed: seedProEntitlement failed: ${error.message}`);
  }
}

/**
 * Seed a minimal project + room owned by `userId` and return the room id.
 *
 * The AI design→render money path (POST /api/mockups) requires an owned room,
 * but walking the whole photo→diagnose→source UI first is far too slow + brittle
 * for a journey assertion. The `recommendation_mockup` branch of the route needs
 * ONLY an owned room (no diagnosis/product rows), so this seeds the minimum: a
 * project + a `living_room` (a valid room_type per migration 001). Service-role
 * bypasses RLS; the room's project.user_id = userId, so the route's own
 * user-scoped ownership + agent_runs RLS checks (auth.uid() = userId) pass.
 */
export async function seedRoom(userId: string): Promise<string> {
  const db = admin();
  const { data: project, error: projectError } = await db
    .from("projects")
    .insert({ user_id: userId, name: "E2E Money-Path Project" })
    .select("id")
    .single();
  if (projectError || !project) {
    throw new Error(
      `seed: seedRoom project insert failed: ${projectError?.message ?? "no row returned"}`,
    );
  }
  const { data: room, error: roomError } = await db
    .from("rooms")
    .insert({ project_id: project.id, name: "E2E Living Room", room_type: "living_room" })
    .select("id")
    .single();
  if (roomError || !room) {
    throw new Error(
      `seed: seedRoom room insert failed: ${roomError?.message ?? "no row returned"}`,
    );
  }
  return room.id;
}
