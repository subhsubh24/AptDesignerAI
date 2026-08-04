import { describe, it, expect, vi } from "vitest";
import {
  resolveRedeemedStatus,
  redeemedMarkerKey,
  redeemResetLink,
  type RedeemStorage,
} from "@/lib/auth/reset-link-idempotency";

/** In-memory fake matching the storage surface redeemResetLink depends on. */
function fakeStorage(initial: Record<string, string> = {}): RedeemStorage {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

describe("resolveRedeemedStatus", () => {
  it("is ready on a genuine double-click: this exact token was redeemed here and the session is live", () => {
    expect(
      resolveRedeemedStatus({ alreadyRedeemedHere: true, hasActiveSession: true }),
    ).toBe("ready");
  });

  it("is invalid when the marker exists but the session is gone (defense-in-depth)", () => {
    expect(
      resolveRedeemedStatus({ alreadyRedeemedHere: true, hasActiveSession: false }),
    ).toBe("invalid");
  });

  it("is invalid for a genuinely dead/garbage token even with an unrelated live session — the shared-machine and already-logged-in bypass this guards against", () => {
    expect(
      resolveRedeemedStatus({ alreadyRedeemedHere: false, hasActiveSession: true }),
    ).toBe("invalid");
  });

  it("is invalid when neither a marker nor a session exist", () => {
    expect(
      resolveRedeemedStatus({ alreadyRedeemedHere: false, hasActiveSession: false }),
    ).toBe("invalid");
  });
});

describe("redeemedMarkerKey", () => {
  it("scopes the marker key to the exact token so different tokens never collide", () => {
    expect(redeemedMarkerKey("token-a")).not.toBe(redeemedMarkerKey("token-b"));
  });

  it("is deterministic for the same token", () => {
    expect(redeemedMarkerKey("abc123")).toBe(redeemedMarkerKey("abc123"));
  });
});

// Integration-level tests of the actual WIRING (not just the pure decision
// table above): which key gets written on success, which key gets read on
// failure, and in what order — this is where both prior review rounds on
// this page found real bugs, so the sequencing itself needs direct coverage.
describe("redeemResetLink (wiring)", () => {
  it("first click: verifyOtp succeeds, marks THIS token's exact key redeemed, never calls getSession", async () => {
    const storage = fakeStorage();
    const getSession = vi.fn();
    const status = await redeemResetLink("token-a", {
      verifyOtp: async () => ({ error: null }),
      getSession,
      storage,
    });
    expect(status).toBe("ready");
    expect(storage.getItem(redeemedMarkerKey("token-a"))).toBe("1");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("genuine double-click: same token redeemed here previously, verifyOtp fails on replay, session still live", async () => {
    const storage = fakeStorage({ [redeemedMarkerKey("token-a")]: "1" });
    const status = await redeemResetLink("token-a", {
      verifyOtp: async () => ({ error: new Error("otp_expired") }),
      getSession: async () => ({ session: { user: { id: "u1" } } }),
      storage,
    });
    expect(status).toBe("ready");
  });

  it("shared-machine bypass stays closed: an UNRELATED token's marker does not unlock a different, dead token", async () => {
    // The marker is set for "token-a" (redeemed earlier by someone else on
    // this machine); the current link in the address bar is "token-b" and
    // was never redeemed here.
    const storage = fakeStorage({ [redeemedMarkerKey("token-a")]: "1" });
    const status = await redeemResetLink("token-b", {
      verifyOtp: async () => ({ error: new Error("otp_expired") }),
      getSession: async () => ({ session: { user: { id: "u1" } } }), // ambient session from token-a's redemption
      storage,
    });
    expect(status).toBe("invalid");
  });

  it("a truly dead link with no prior redemption and no session is invalid", async () => {
    const status = await redeemResetLink("token-c", {
      verifyOtp: async () => ({ error: new Error("otp_expired") }),
      getSession: async () => ({ session: null }),
      storage: fakeStorage(),
    });
    expect(status).toBe("invalid");
  });

  it("storage writes never throw the sequence into an unhandled rejection when storage is unavailable (private mode)", async () => {
    const throwingStorage: RedeemStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    await expect(
      redeemResetLink("token-a", {
        verifyOtp: async () => ({ error: null }),
        getSession: async () => ({ session: null }),
        storage: throwingStorage,
      }),
    ).resolves.toBe("ready");
    await expect(
      redeemResetLink("token-a", {
        verifyOtp: async () => ({ error: new Error("otp_expired") }),
        getSession: async () => ({ session: { user: { id: "u1" } } }),
        storage: throwingStorage,
      }),
    ).resolves.toBe("invalid");
  });
});
