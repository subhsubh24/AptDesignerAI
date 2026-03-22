"use client";

// Browser-side: auth actions call fetch to API routes,
// so we only need the auth methods here.
export function createClient() {
  return {
    auth: {
      signInWithPassword: async ({ email }: { email: string; password: string }) => {
        // Auth is bypassed — always succeed
        return {
          data: {
            user: { id: "00000000-0000-0000-0000-000000000001", email },
            session: { access_token: "mock" },
          },
          error: null,
        };
      },
      signUp: async ({ email }: { email: string; password: string; options?: unknown }) => {
        return {
          data: {
            user: { id: "00000000-0000-0000-0000-000000000001", email },
            session: { access_token: "mock" },
          },
          error: null,
        };
      },
      signOut: async () => ({ error: null }),
      getUser: async () => ({
        data: {
          user: {
            id: "00000000-0000-0000-0000-000000000001",
            email: "user@aptdesigner.local",
            user_metadata: { full_name: "Designer" },
          },
        },
        error: null,
      }),
    },
  };
}
