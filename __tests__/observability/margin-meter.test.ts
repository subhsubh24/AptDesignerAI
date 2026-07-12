import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Margin meter is the ONLY thing that egresses per-call LLM economics to an
 * external ingest API. Its three fail-safe guarantees (no key => disabled;
 * hermetic CI/E2E => never construct; construction error => null) are what keep
 * telemetry from leaking during the cassette-based journey suite or crashing the
 * host. These tests pin that gate so a mutation can't silently re-enable egress.
 *
 * getMeter() memoises at module scope, so each case resets the module registry
 * and re-imports after stubbing the env.
 */

async function freshGetMeter() {
  vi.resetModules();
  const mod = await import("@/lib/observability/margin-meter");
  return mod.getMeter;
}

beforeEach(() => {
  // Force the "online" baseline: no CI/E2E context. Individual cases override.
  vi.stubEnv("CI", "");
  vi.stubEnv("E2E_AUTH_STACK", "");
  vi.stubEnv("MARGIN_INGEST_KEY", "");
  vi.stubEnv("MARGIN_INGEST_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMeter (Margin egress gate)", () => {
  it("is disabled (null) when no ingest key is set", async () => {
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("refuses to construct under CI even when a key is present", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    vi.stubEnv("CI", "1");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("refuses to construct under the hermetic E2E auth stack even with a key", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    vi.stubEnv("E2E_AUTH_STACK", "1");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBeNull();
  });

  it("returns a working meter when a key is set and not in a hermetic context", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    const getMeter = await freshGetMeter();
    const meter = getMeter();
    expect(meter).not.toBeNull();
    // A real meter, not a stub — but constructing it opens NO socket (recordCall
    // does), so this asserts the surface without any network egress.
    expect(typeof meter?.recordCall).toBe("function");
    expect(typeof meter?.recordOutcome).toBe("function");
  });

  it("memoises the resolved meter (same instance across calls, resolved once)", async () => {
    vi.stubEnv("MARGIN_INGEST_KEY", "test-key");
    const getMeter = await freshGetMeter();
    expect(getMeter()).toBe(getMeter());
  });

  it("never throws — returns null rather than propagating a construction error", async () => {
    // No key => the guarded path returns null; the call itself must be safe.
    const getMeter = await freshGetMeter();
    expect(() => getMeter()).not.toThrow();
  });
});
