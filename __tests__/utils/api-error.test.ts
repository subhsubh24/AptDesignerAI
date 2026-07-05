import { describe, it, expect, vi, afterEach } from "vitest";
import { apiError, logServerError } from "@/lib/utils/api-error";

/**
 * api-error.ts is the error-hygiene boundary (ROADMAP G3): the FULL error is
 * logged server-side, only a GENERIC message reaches the client — so raw
 * Supabase/Postgres/Stripe/LLM strings (schema, table, column names, query
 * logic) never leak and can't be used for enumeration. It's used ~25× across
 * the API routes, so a regression that leaks `error.message` to the client is a
 * real security bug. These tests pin the boundary.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

// The kind of raw error whose text must NEVER reach the client.
const LEAKY = new Error(
  'relation "stripe_customers" does not exist at column "user_id" — SELECT ...',
);

describe("apiError — client response never leaks the raw error", () => {
  it("returns the generic message + 500 by default, not the raw error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = apiError("billing.webhook", LEAKY);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong. Please try again." });
    // The sensitive schema/table/column text must be absent from the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("stripe_customers");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("SELECT");
  });

  it("preserves a caller-supplied status + neutral client message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = apiError("rooms.get", LEAKY, 404, "Not found");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("logs the FULL error server-side (scope + detail) even though the client sees generic", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiError("diagnosis.post", LEAKY);
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg, raw] = spy.mock.calls[0];
    // The server log carries the scope + the real message, and the raw object.
    expect(String(msg)).toContain("[diagnosis.post]");
    expect(String(msg)).toContain("stripe_customers");
    expect(raw).toBe(LEAKY);
  });
});

describe("logServerError — extracts detail across error shapes", () => {
  it("logs an Error's message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("scope.a", new Error("boom"));
    expect(String(spy.mock.calls[0][0])).toBe("[scope.a] boom");
  });

  it("logs a string error verbatim", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("scope.b", "raw string failure");
    expect(String(spy.mock.calls[0][0])).toBe("[scope.b] raw string failure");
  });

  it("JSON-stringifies a plain object error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError("scope.c", { code: "42P01", table: "rooms" });
    expect(String(spy.mock.calls[0][0])).toBe('[scope.c] {"code":"42P01","table":"rooms"}');
  });

  it("falls back to String() when the object is not JSON-serializable (circular)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logServerError("scope.d", circular);
    // JSON.stringify throws on a cycle → the catch returns String(error).
    expect(String(spy.mock.calls[0][0])).toBe("[scope.d] [object Object]");
  });
});
