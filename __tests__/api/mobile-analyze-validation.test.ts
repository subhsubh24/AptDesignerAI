import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Exercise POST /api/mobile/analyze's response-shape validation without a real
// Supabase backend or a live Gemini call. We mock ONLY the two external
// boundaries — auth (token → user) and the LLM provider/JSON extractor — so the
// route's own field guards run for real. The rate/spend limiters and cost
// ledger run unmocked (first call per fresh user id is always allowed).
// vi.mock factories are hoisted above module init, so the fns they reference
// must be created via vi.hoisted (the gemini/extract factories reference them
// eagerly while building the mocked module object → a plain const would hit the
// temporal-dead-zone).
const { mockGetUser, mockChat, mockExtract } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockChat: vi.fn(),
  mockExtract: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));
vi.mock("@/lib/ai/gemini", () => ({ geminiProvider: { chat: mockChat } }));
vi.mock("@/lib/ai/extract-json", () => ({ extractJsonObject: mockExtract }));

vi.mock("@/lib/observability/cost-meter", () => ({
  withCostLedger: (fn: (summary: () => { totalTokens: number }) => unknown) =>
    fn(() => ({ totalTokens: 0 })),
  recordUsage: vi.fn(),
}));

import { POST } from "@/app/api/mobile/analyze/route";

const extract = mockExtract as unknown as Mock;

// A fully-valid Pass A analysis. Every case below keeps summary + all five array
// fields valid, so the ONLY variable under test is style_name/design_direction —
// which makes the new guard mutation-provable: remove it and cases 3–5 return 200.
const VALID_ANALYSIS = {
  summary: "A warm mid-century living room with good bones but an undersized rug.",
  style_name: "Mid-Century Modern",
  design_direction: "Layer warm walnut tones against a soft neutral base.",
  recommended_palette: ["#8a5a44", "#efe7dc"],
  recommended_materials: ["walnut", "brass"],
  recommended_textures: ["boucle", "linen"],
  what_works: ["The leather lounge chair"],
  what_should_go: ["The black laminate TV stand"],
};

let userSeq = 0;
function req() {
  return new NextRequest("http://localhost/api/mobile/analyze", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "content-type": "application/json" },
    body: JSON.stringify({
      image_url: "https://test.supabase.co/storage/v1/object/public/rooms/a.jpg",
      room_type: "living_room",
    }),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockChat.mockReset();
  extract.mockReset();
  // Unique user id per test so the real per-user rate limiter never trips.
  userSeq += 1;
  mockGetUser.mockResolvedValue({ data: { user: { id: `analyze-user-${userSeq}` } }, error: null });
  mockChat.mockResolvedValue({ content: "{}", usage: {} });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/mobile/analyze — response-shape validation", () => {
  it("returns the analysis (200) when every rendered field is present", async () => {
    extract.mockReturnValue({ ...VALID_ANALYSIS });
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis.style_name).toBe("Mid-Century Modern");
    expect(body.analysis.design_direction).toBeTruthy();
  });

  it("fails loud (500) when style_name is missing", async () => {
    const raw = { ...VALID_ANALYSIS };
    delete (raw as Record<string, unknown>).style_name;
    extract.mockReturnValue(raw);
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/incomplete/i);
  });

  it("fails loud (500) when style_name is an empty string", async () => {
    extract.mockReturnValue({ ...VALID_ANALYSIS, style_name: "" });
    const res = await POST(req());
    expect(res.status).toBe(500);
  });

  it("fails loud (500) when design_direction is missing", async () => {
    const raw = { ...VALID_ANALYSIS };
    delete (raw as Record<string, unknown>).design_direction;
    extract.mockReturnValue(raw);
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/incomplete/i);
  });

  it("fails loud (500) when design_direction is an empty string", async () => {
    extract.mockReturnValue({ ...VALID_ANALYSIS, design_direction: "" });
    const res = await POST(req());
    expect(res.status).toBe(500);
  });

  it("still 500s (summary guard) when summary is missing — unchanged behaviour", async () => {
    const raw = { ...VALID_ANALYSIS };
    delete (raw as Record<string, unknown>).summary;
    extract.mockReturnValue(raw);
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
