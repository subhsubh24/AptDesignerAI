import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Regression guard for the compute/write IDOR fixes: the paid-LLM endpoints that
// resolve a room (directly or via a bundle) by a client-supplied id must verify
// ownership BEFORE running the pipeline, so no authenticated caller can drive
// model spend on — or write results into — another user's room. We mock
// `userOwnsRoom` and assert a non-owner gets 404.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/ownership", () => ({ userOwnsRoom: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { userOwnsRoom } from "@/lib/auth/ownership";
import { POST as diagnosisPost } from "@/app/api/diagnosis/route";
import { POST as bundlesEvaluatePost } from "@/app/api/bundles/evaluate/route";

const mockCreateClient = createClient as unknown as Mock;
const mockUserOwnsRoom = userOwnsRoom as unknown as Mock;

function singleStub(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockUserOwnsRoom.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("compute/write IDOR guards", () => {
  it("POST /api/diagnosis 404s a non-owner before the diagnosis pipeline runs", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-diag" } } }) },
      from: vi.fn(() => singleStub(null)),
    });
    mockUserOwnsRoom.mockResolvedValue(false);

    const res = await diagnosisPost(jsonReq({ room_id: "victim-room" }));

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-diag");
  });

  it("POST /api/bundles/evaluate 404s when the caller does not own the bundle's room", async () => {
    // The route fetches the bundle first (to learn its room_id), THEN checks
    // ownership of that room. Serve a bundle owned by someone else and assert the
    // guard rejects the non-owner before evaluation.
    mockCreateClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "attacker-bundle" } } }) },
      from: vi.fn(() => singleStub({ id: "b1", room_id: "victim-room", product_bundle_items: [] })),
    });
    mockUserOwnsRoom.mockResolvedValue(false);

    const res = await bundlesEvaluatePost(jsonReq({ bundle_id: "b1" }));

    expect(res.status).toBe(404);
    expect(mockUserOwnsRoom).toHaveBeenCalledWith(expect.anything(), "victim-room", "attacker-bundle");
  });
});
