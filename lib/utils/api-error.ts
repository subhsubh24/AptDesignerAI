import { NextResponse } from "next/server";

/**
 * API error hygiene (ROADMAP Track G3 — error-message hygiene / no enumeration).
 *
 * Raw Supabase/Postgres/Stripe/LLM error strings leak schema, table, and column
 * names plus query logic to the client (OWASP information exposure, and an
 * enumeration surface). The boundary rule: log the FULL error server-side, return
 * a GENERIC message to the client. Use these helpers instead of returning
 * `error.message` / `String(error)` in an HTTP response.
 */

/** Log the full error context server-side (never sent to the client). */
export function logServerError(scope: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  console.error(`[${scope}] ${detail}`, error);
}

/**
 * Build a generic JSON error response and log the real error server-side.
 * Defaults to a 500 with a neutral message; pass `status`/`clientMessage` to
 * preserve a specific status (e.g. 404) with an appropriately neutral message.
 */
export function apiError(
  scope: string,
  error: unknown,
  status = 500,
  clientMessage = "Something went wrong. Please try again.",
): NextResponse {
  logServerError(scope, error);
  return NextResponse.json({ error: clientMessage }, { status });
}
