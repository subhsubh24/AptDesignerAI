import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionEnv, MissingEnvError } from "@/lib/config/env";

/**
 * Covers the production-boot env contract (lib/config/env.ts) — previously
 * untested. This guard is what turns a mis-deploy (a missing Supabase/Gemini
 * credential) into a fast, loud boot failure instead of a first-request 500, so
 * its branch behavior (enforce gating, the provider-conditional DeepSeek
 * requirement, the MissingEnvError shape) must not silently regress.
 */

// The four unconditionally-required prod vars + the default-provider DeepSeek key.
const ALL_PRESENT: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  GEMINI_API_KEY: "gemini-key",
  TAVILY_API_KEY: "tavily-key",
  DEEPSEEK_API_KEY: "deepseek-key",
};

/** Stub every var this contract reads to a known baseline, then apply overrides. */
function stubEnv(overrides: Record<string, string> = {}) {
  const merged = { ...ALL_PRESENT, ...overrides };
  for (const [k, v] of Object.entries(merged)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertProductionEnv", () => {
  it("is a no-op outside production, even with every required var missing", () => {
    vi.stubEnv("NODE_ENV", "development");
    stubEnv({
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      GEMINI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
    });
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it("enforces in production (NODE_ENV=production) and throws when a var is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "gemini");
    stubEnv({ GEMINI_API_KEY: "" });
    expect(() => assertProductionEnv()).toThrow(MissingEnvError);
  });

  it("enforces when alwaysEnforce is true regardless of NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER", "gemini");
    stubEnv({ SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(() => assertProductionEnv({ alwaysEnforce: true })).toThrow(MissingEnvError);
  });

  it("passes when every required var is present (gemini provider needs no DeepSeek key)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER", "gemini");
    stubEnv({ DEEPSEEK_API_KEY: "" }); // gemini path: DeepSeek key not required
    expect(() => assertProductionEnv({ alwaysEnforce: true })).not.toThrow();
  });

  it("REQUIRES TAVILY_API_KEY in real prod (the search/sourcing pipeline throws without it)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("E2E_AUTH_STACK", ""); // real prod is NOT the CI cassette boot
    stubEnv({ TAVILY_API_KEY: "" });
    let caught: MissingEnvError | undefined;
    try {
      assertProductionEnv();
    } catch (e) {
      caught = e as MissingEnvError;
    }
    expect(caught).toBeInstanceOf(MissingEnvError);
    expect(caught!.missing.map((m) => m.name)).toContain("TAVILY_API_KEY");
  });

  it("EXEMPTS TAVILY_API_KEY under E2E_AUTH_STACK (the CI journeys cassette boot never calls Tavily)", () => {
    // The journeys CI job boots in production mode with dummy LLM keys but no
    // TAVILY key; cassette-backed search never calls Tavily, so its boot must
    // not fail. Every other required var is present here.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("E2E_AUTH_STACK", "1");
    stubEnv({ TAVILY_API_KEY: "" });
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it("REQUIRES the DeepSeek key on the default (non-gemini) provider", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER", "deepseek"); // default provider → DeepSeek key required
    stubEnv({ DEEPSEEK_API_KEY: "" });
    let caught: MissingEnvError | undefined;
    try {
      assertProductionEnv({ alwaysEnforce: true });
    } catch (e) {
      caught = e as MissingEnvError;
    }
    expect(caught).toBeInstanceOf(MissingEnvError);
    expect(caught!.missing.map((m) => m.name)).toContain("DEEPSEEK_API_KEY");
  });

  it("passes on the default provider once the DeepSeek key is present", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER", "deepseek");
    stubEnv();
    expect(() => assertProductionEnv({ alwaysEnforce: true })).not.toThrow();
  });

  it("surfaces a readable MissingEnvError naming each missing var + why", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_PROVIDER", "gemini");
    stubEnv({ NEXT_PUBLIC_SUPABASE_URL: "", GEMINI_API_KEY: "" });
    let caught: MissingEnvError | undefined;
    try {
      assertProductionEnv();
    } catch (e) {
      caught = e as MissingEnvError;
    }
    expect(caught).toBeInstanceOf(MissingEnvError);
    expect(caught!.name).toBe("MissingEnvError");
    const names = caught!.missing.map((m) => m.name);
    expect(names).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(names).toContain("GEMINI_API_KEY");
    expect(names).not.toContain("DEEPSEEK_API_KEY"); // gemini provider
    expect(caught!.message).toMatch(/NEXT_PUBLIC_SUPABASE_URL — Supabase project URL/);
  });
});
