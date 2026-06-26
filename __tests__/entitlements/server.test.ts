import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// hasProEntitlement reads REVENUECAT_SECRET_KEY at module load time, so each
// test that changes the env must reset modules and re-import dynamically.

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function importModule() {
  return import("@/lib/entitlements/server");
}

// ── Missing key (fail-open) ───────────────────────────────────────────────────

describe("hasProEntitlement — missing REVENUECAT_SECRET_KEY", () => {
  it("returns true and logs error when key is unset", async () => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "");
    const { hasProEntitlement } = await importModule();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await hasProEntitlement("user-1");

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("REVENUECAT_SECRET_KEY"));
    consoleSpy.mockRestore();
  });
});

// ── Network errors (fail-open) ────────────────────────────────────────────────

describe("hasProEntitlement — network errors", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "rc_test_key");
  });

  it("returns true on network failure (fetch throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });

  it("returns true on timeout (fetch throws AbortError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("Timeout"), { name: "AbortError" }))
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });
});

// ── HTTP error responses ──────────────────────────────────────────────────────

describe("hasProEntitlement — HTTP errors", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "rc_test_key");
  });

  it("returns false for 404 (subscriber not found in RC)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(false);
  });

  it("returns true (fail-open) for 500 server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });

  it("returns true (fail-open) for 429 rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });
});

// ── JSON parse failure (fail-open) ───────────────────────────────────────────

describe("hasProEntitlement — JSON parse failure", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "rc_test_key");
  });

  it("returns true when response JSON fails to parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });
});

// ── No entitlement in response ────────────────────────────────────────────────

describe("hasProEntitlement — no entitlement", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "rc_test_key");
  });

  it("returns false when the pro entitlement is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          subscriber: { entitlements: {} },
        }),
      })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(false);
  });
});

// ── Active entitlement ────────────────────────────────────────────────────────

describe("hasProEntitlement — active entitlement", () => {
  beforeEach(() => {
    vi.stubEnv("REVENUECAT_SECRET_KEY", "rc_test_key");
  });

  it("returns true for a lifetime purchase (expires_date is null)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          subscriber: {
            entitlements: {
              pro: { expires_date: null, product_identifier: "pro_lifetime", purchase_date: "2024-01-01" },
            },
          },
        }),
      })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });

  it("returns true when expires_date is in the future", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          subscriber: {
            entitlements: {
              pro: { expires_date: future, product_identifier: "pro_monthly", purchase_date: "2024-01-01" },
            },
          },
        }),
      })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(true);
  });

  it("returns false when expires_date is in the past", async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          subscriber: {
            entitlements: {
              pro: { expires_date: past, product_identifier: "pro_monthly", purchase_date: "2024-01-01" },
            },
          },
        }),
      })
    );
    const { hasProEntitlement } = await importModule();
    expect(await hasProEntitlement("user-1")).toBe(false);
  });
});
