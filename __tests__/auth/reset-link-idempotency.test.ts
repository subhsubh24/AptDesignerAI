import { describe, it, expect } from "vitest";
import { resolveRedeemedStatus, redeemedMarkerKey } from "@/lib/auth/reset-link-idempotency";

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
