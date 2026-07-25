"use client";

import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return createMockClient();
  }

  if (!_client) {
    _client = createBrowserClient(url, key);
  }
  return _client;
}

function createMockClient() {
  const MOCK_USER = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "user@aptdesigner.local",
    user_metadata: { full_name: "Designer" },
  };

  return {
    auth: {
      signInWithPassword: async (_opts: { email: string; password: string }) => ({
        data: { user: MOCK_USER, session: { access_token: "mock" } },
        error: null,
      }),
      signUp: async (_opts: { email: string; password: string; options?: unknown }) => ({
        data: { user: MOCK_USER, session: { access_token: "mock" } },
        error: null,
      }),
      signOut: async () => ({ error: null }),
      // Back the /reset-password flow so it is exercisable without a real
      // backend — local dev, and the journey tests that assert the page
      // resolves to a real state (e2e/journeys.spec.ts). Mirrors the other mock
      // methods: succeeds, changes nothing.
      updateUser: async (_attrs: { password?: string }) => ({
        data: { user: MOCK_USER },
        error: null,
      }),
      verifyOtp: async (_params: { token_hash: string; type: string }) => ({
        data: { user: MOCK_USER, session: { user: MOCK_USER, access_token: "mock" } },
        error: null,
      }),
      getUser: async () => ({ data: { user: MOCK_USER }, error: null }),
      getSession: async () => ({
        data: { session: { user: MOCK_USER, access_token: "mock" } },
        error: null,
      }),
      onAuthStateChange: (_cb: unknown) => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  } as unknown as ReturnType<typeof createBrowserClient>;
}
