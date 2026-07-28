import { describe, it, expect, vi, beforeEach } from "vitest";

// verifyMockupImage runs a single geminiProvider.chat vision call (after
// resolving the reference photos into image blocks). generateWithVerification
// orchestrates an injected generateFn against that verifier. Mock the provider +
// image resolver so we drive every branch deterministically, no real model call.
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: vi.fn() },
}));
vi.mock("@/lib/ai/resolve-image", () => {
  const resolveImageBlock = vi.fn(async (url: string) => ({
    type: "image",
    source: { type: "url", url },
  }));
  return {
    resolveImageBlock,
    // The verifier batches its reference photos. Mirror the real module's
    // index-preserving contract so the caption/photo pairing this suite relies
    // on is exercised, not bypassed.
    resolveImageBlocks: vi.fn(async (urls: string[]) =>
      Promise.all(urls.map((u) => resolveImageBlock(u))),
    ),
  };
});

import {
  verifyMockupImage,
  generateWithVerification,
  type MockupVerification,
} from "@/lib/agents/mockup-verifier";
import { geminiProvider } from "@/lib/ai/gemini";
import { DETERMINISTIC_SEED } from "@/lib/ai/determinism";

const mockChat = geminiProvider.chat as unknown as ReturnType<typeof vi.fn>;

function chatResponse(content: string) {
  return {
    content,
    usage: { input_tokens: 50, output_tokens: 30, thinking_tokens: 4 },
    model: "gemini-test",
  };
}

function verification(overrides: Partial<MockupVerification> = {}): MockupVerification {
  return {
    matches_room: true,
    confidence: 0.9,
    issues: {},
    overall_assessment: "looks like the same room",
    ...overrides,
  };
}

const ROOM_PHOTOS = ["https://example.com/room-1.jpg"];

/** A generateFn that always succeeds, returning a tagged image per call. */
function okGenerator() {
  let n = 0;
  return vi.fn(async (prompt: string) => {
    n += 1;
    return {
      success: true as const,
      data: { image_url: `img-${n}`, image_mime_type: "image/png", prompt_used: prompt, provider: "gemini-image" },
    };
  });
}

beforeEach(() => {
  mockChat.mockReset();
});

describe("verifyMockupImage", () => {
  it("passes through (no model call) when there are no reference photos", async () => {
    const res = await verifyMockupImage("base64data", "image/png", []);
    expect(res.success).toBe(true);
    expect(res.data?.matches_room).toBe(true);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns the parsed verification on a well-formed response", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(verification({ matches_room: false, confidence: 0.4 }))));
    const res = await verifyMockupImage("base64data", "image/png", ROOM_PHOTOS);
    expect(res.success).toBe(true);
    expect(res.data?.matches_room).toBe(false);
    expect(res.data?.confidence).toBe(0.4);
  });

  it("passes the deterministic seed + cheap thinking to the model", async () => {
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(verification())));
    await verifyMockupImage("base64data", "image/png", ROOM_PHOTOS);
    const callArg = mockChat.mock.calls[0][0];
    expect(callArg).toHaveProperty("seed", DETERMINISTIC_SEED);
    expect(callArg.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("fails (success:false) when the model call throws", async () => {
    mockChat.mockRejectedValue(new Error("vision timeout"));
    const res = await verifyMockupImage("base64data", "image/png", ROOM_PHOTOS);
    expect(res.success).toBe(false);
  });
});

describe("generateWithVerification", () => {
  it("skips verification when skipVerification is set", async () => {
    const generateFn = okGenerator();
    const res = await generateWithVerification({
      generateFn,
      originalPrompt: "a cozy room",
      roomImageUrls: ROOM_PHOTOS,
      skipVerification: true,
    });
    expect(res.verified).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.finalImageData).toBe("img-1");
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("skips verification when there are no reference photos", async () => {
    const generateFn = okGenerator();
    const res = await generateWithVerification({ generateFn, originalPrompt: "p", roomImageUrls: [] });
    expect(res.verified).toBe(true);
    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns verified on the first attempt when the room shell matches", async () => {
    const generateFn = okGenerator();
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(verification({ matches_room: true }))));
    const res = await generateWithVerification({ generateFn, originalPrompt: "p", roomImageUrls: ROOM_PHOTOS });
    expect(res.verified).toBe(true);
    expect(res.attempts).toBe(1);
    expect(generateFn).toHaveBeenCalledTimes(1);
  });

  it("regenerates with corrections, then accepts the corrected render", async () => {
    const generateFn = okGenerator();
    mockChat
      .mockResolvedValueOnce(chatResponse(JSON.stringify(verification({ matches_room: false, correction_instructions: "fix the floor" }))))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(verification({ matches_room: true }))));

    const res = await generateWithVerification({ generateFn, originalPrompt: "base prompt", roomImageUrls: ROOM_PHOTOS });

    expect(res.verified).toBe(true);
    expect(res.attempts).toBe(2);
    expect(generateFn).toHaveBeenCalledTimes(2);
    // The second generation must carry the correction text.
    expect(generateFn.mock.calls[1][0]).toContain("fix the floor");
  });

  it("returns failure when the very first generation fails", async () => {
    const generateFn = vi.fn(async () => ({ success: false as const, error: "image model down" }));
    const res = await generateWithVerification({ generateFn, originalPrompt: "p", roomImageUrls: ROOM_PHOTOS });
    expect(res.verified).toBe(false);
    expect(res.finalImageData).toBe("");
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("fails open (accepts the image) when the verification call itself errors", async () => {
    const generateFn = okGenerator();
    mockChat.mockRejectedValue(new Error("verifier exploded"));
    const res = await generateWithVerification({ generateFn, originalPrompt: "p", roomImageUrls: ROOM_PHOTOS });
    expect(res.verified).toBe(true);
    expect(res.finalImageData).toBe("img-1");
  });

  it("gives up after the max attempts when the room never matches", async () => {
    const generateFn = okGenerator();
    mockChat.mockResolvedValue(chatResponse(JSON.stringify(verification({ matches_room: false, correction_instructions: "still wrong" }))));
    const res = await generateWithVerification({ generateFn, originalPrompt: "p", roomImageUrls: ROOM_PHOTOS });
    expect(res.verified).toBe(false);
    // MAX_VERIFICATION_ATTEMPTS (2) + 1 = 3 generation attempts.
    expect(res.attempts).toBe(3);
    expect(generateFn).toHaveBeenCalledTimes(3);
    expect(res.finalVerification?.matches_room).toBe(false);
  });
});
