import { createMemoryClient } from "@/lib/store/memory-store";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Data backend selector.
 *
 * - `memory` (default): the in-memory store backs all `.from()`/`.storage`/`.rpc`
 *   DATA ops, with real Supabase auth proxied on top when credentials exist. Data
 *   does NOT persist across server processes — fine for local dev, but NOT for
 *   production (see docs/quality/QUALITY_SCORECARD.md `functional_reality`).
 * - `supabase`: real Supabase Postgres backs ALL data ops, with RLS enforced at
 *   runtime. This is the production persistence path. It is HUMAN-GATED: the owner
 *   applies the migrations, sets the Supabase env vars, flips
 *   `DATA_BACKEND=supabase`, and verifies the money path survives a cold start
 *   before launch. Until flipped, this module ships INERT (memory backend).
 *
 * The flag exists so the persistent path is real, reviewable code today without a
 * risky blind cutover: default behavior is unchanged, and enabling persistence is
 * a single env flip the owner controls.
 */
export function supabaseDataBackendEnabled(): boolean {
  return process.env.DATA_BACKEND === "supabase";
}

function supabaseCredentials(): { url?: string; key?: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Builds a real user-scoped Supabase SSR client (reads/writes the session cookie).
 * Because it is user-scoped, RLS policies execute at runtime, so it is safe for
 * both auth AND data. Caller guarantees `url`/`key` are present.
 */
async function buildRealClient(url: string, key: string) {
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll can fail in Server Components (read-only cookies).
          // This is expected — the middleware handles session refresh.
        }
      },
    },
  });
}

/**
 * Returns the request-scoped Supabase client used by API routes.
 *
 * With `DATA_BACKEND=supabase` this is a real Supabase client backing both auth
 * and data (persistent Postgres + runtime RLS). Otherwise it is the interim
 * hybrid: the in-memory store for data, enriched with real Supabase auth when
 * credentials are configured — real user accounts while the data layer stays
 * in-memory until the persistence cutover.
 */
export async function createClient() {
  const { url, key } = supabaseCredentials();

  if (supabaseDataBackendEnabled()) {
    // Production persistence path. FAIL LOUD on missing creds — silently falling
    // back to the non-persistent memory store on a critical path is the exact
    // BUILDS≠WORKS trap (a "saved" design that vanishes). If the owner asked for
    // the persistent backend, a misconfiguration must surface, not degrade.
    if (!url || !key) {
      throw new Error(
        "DATA_BACKEND=supabase requires NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY. Apply the migrations and set the " +
          "Supabase env vars before enabling the persistent data backend.",
      );
    }
    return buildRealClient(url, key);
  }

  // Interim hybrid: in-memory data + (optional) real auth.
  const memoryClient = createMemoryClient();
  if (!url || !key) {
    return memoryClient;
  }
  const supabase = await buildRealClient(url, key);
  // Proxy: use real Supabase for auth, memory store for everything else.
  const proxy = Object.create(memoryClient);
  proxy.auth = supabase.auth;
  return proxy;
}

/** Fixed identity used ONLY in local dev, where there is no real session. */
const DEV_MOCK_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Get the current user ID, or `null` when the request has no authenticated user.
 *
 * Callers MUST handle null (401) — it is not "the anonymous user", it means we
 * could not establish who is asking.
 *
 * Falling back to `DEV_MOCK_USER_ID` is a LOCAL-DEV-ONLY convenience. Anywhere
 * real — production, or `DATA_BACKEND=supabase` — handing it back is an
 * identity bug of the same family the credential branch below already refuses:
 * an unresolved caller silently becomes one fixed account that every other
 * unresolved caller also becomes, so they read and write each other's
 * `saved_designs` rows through it. So in those environments a missing session,
 * or an auth call that fails outright, returns null instead.
 *
 * This is defence in depth, not the only guard: `lib/supabase/middleware.ts`
 * already 401s an unauthenticated request to these API paths, and under
 * `DATA_BACKEND=supabase` RLS would reject a mismatched identity at the
 * database. What this closes is the gap between those layers — middleware's
 * `getUser()` succeeding while the handler's own call a moment later does not —
 * and the memory-backend case, which has no RLS behind it at all.
 *
 * A transient auth outage and a genuinely signed-out request both surface as
 * null (and therefore 401) rather than being told apart: the distinction would
 * change the message, not the correct answer, and conflating them keeps the
 * safe outcome on the failure path. The throw is logged server-side so the
 * outage case stays diagnosable (G3).
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { url, key } = supabaseCredentials();
  // Environments where a fixed fallback identity is never acceptable.
  const strictIdentity =
    supabaseDataBackendEnabled() || process.env.NODE_ENV === "production";

  if (!url || !key) {
    // Symmetric with createClient(): if the persistent backend was explicitly
    // selected, missing creds must FAIL LOUD here too — never hand back the mock
    // user, which would silently attribute data to a fake identity.
    if (supabaseDataBackendEnabled()) {
      throw new Error(
        "DATA_BACKEND=supabase requires NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("Supabase credentials are required in production");
    }
    return DEV_MOCK_USER_ID;
  }

  const supabase = await buildRealClient(url, key);
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user?.id) return data.user.id;
    return strictIdentity ? null : DEV_MOCK_USER_ID;
  } catch (err) {
    if (strictIdentity) {
      console.error("[supabase] auth.getUser() failed; treating as unauthenticated:", err);
      return null;
    }
    return DEV_MOCK_USER_ID;
  }
}
