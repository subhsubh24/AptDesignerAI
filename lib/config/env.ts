/**
 * Runtime env validation — fails hard in production if required keys are missing.
 *
 * Development mode logs a warning and returns null/undefined so local work can
 * proceed without every key set. Production refuses to boot without the keys
 * the app cannot function without, catching mis-deployments early rather than
 * waiting for the first user request to 500.
 *
 * Import `assertProductionEnv()` from `instrumentation.ts` or a startup path to
 * perform the check once per process.
 */

const REQUIRED_PROD: { name: string; why: string }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", why: "Supabase anon (browser) key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "Service-role key for admin storage writes" },
  { name: "GEMINI_API_KEY", why: "Gemini LLM access for every agent" },
];

export class MissingEnvError extends Error {
  missing: { name: string; why: string }[];
  constructor(missing: { name: string; why: string }[]) {
    super(
      `Missing required production env vars:\n` +
        missing.map((m) => `  - ${m.name} — ${m.why}`).join("\n"),
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/**
 * Asserts all REQUIRED_PROD vars are present. No-op outside production unless
 * `alwaysEnforce` is true (useful for CI).
 */
export function assertProductionEnv(opts?: { alwaysEnforce?: boolean }): void {
  const enforce =
    opts?.alwaysEnforce === true || process.env.NODE_ENV === "production";
  if (!enforce) return;
  const missing = REQUIRED_PROD.filter((r) => !process.env[r.name]);
  if (missing.length > 0) throw new MissingEnvError(missing);
}
