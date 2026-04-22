import { createMemoryClient } from "@/lib/store/memory-store";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Returns a data client backed by the in-memory store (for queries/mutations),
 * but enriched with real Supabase auth when credentials are configured.
 *
 * This hybrid approach lets us have real user accounts while keeping the
 * memory store as the data layer until a full DB migration is done.
 */
export async function createClient() {
  const memoryClient = createMemoryClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return memoryClient;
  }

  // Real Supabase auth — replace mock auth methods on the memory client
  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
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

  // Proxy: use real Supabase for auth, memory store for everything else
  const proxy = Object.create(memoryClient);
  proxy.auth = supabase.auth;
  return proxy;
}

/**
 * Get the current user ID, falling back to mock user for local dev.
 */
export async function getCurrentUserId(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Supabase credentials are required in production");
    }
    return "00000000-0000-0000-0000-000000000001";
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch { /* read-only in Server Components */ }
      },
    },
  });

  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "00000000-0000-0000-0000-000000000001";
  } catch {
    return "00000000-0000-0000-0000-000000000001";
  }
}
