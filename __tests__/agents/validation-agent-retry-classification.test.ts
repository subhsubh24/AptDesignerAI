import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `validateProductSet`'s retry classifier (validation-agent.ts, the `isRetryable`
 * passed to `withRetry`) treats a malformed-JSON response (SyntaxError, from
 * `extractJsonObject`) and a schema-invalid response (ZodError, from
 * `ProductSetValidationResponseSchema.parse`) as WORTH RETRYING — the model
 * probably just needs another attempt at well-formed output — while any other
 * error (a network failure not already covered by `isRetryableError`, an
 * unexpected exception) is NOT retried and fails immediately.
 *
 * Neither `__tests__/agents/validation-agent.test.ts` (data-contract shapes)
 * nor `__tests__/agents/validation-agent-math-cap.test.ts` (the math-cap
 * enforcement layer) exercises this branch — both mock a single successful
 * response. This drives the classifier itself: a regression that stopped
 * retrying a SyntaxError/ZodError (or started retrying everything, masking a
 * real bug behind three slow attempts) would pass both of those files.
 */

const chat = vi.fn();
vi.mock("@/lib/ai/gemini", () => ({
  geminiProvider: { chat: (...args: unknown[]) => chat(...args) },
}));

const { validateProductSet } = await import("@/lib/agents/validation-agent");

const PRODUCTS = [
  { title: "Oak Side Table", category: "side_table", tier: "balanced", materials: ["oak"], colors: ["brown"], price: 150 },
];

const ROOM_CONTEXT = {
  roomType: "living_room",
  designDirection: "warm minimalist",
  existingItems: [],
};

const VALID_BODY = { isValid: true, confidence: 8, issues: [] };

function response(content: string) {
  return {
    content,
    model: "gemini-2.5-flash-lite",
    usage: { input_tokens: 10, output_tokens: 10, thinking_tokens: 0 },
  };
}

describe("validateProductSet retry classification", () => {
  beforeEach(() => {
    chat.mockReset();
  });

  it("retries and recovers when the model returns non-JSON text (SyntaxError)", async () => {
    chat
      .mockResolvedValueOnce(response("Sorry, I can't help with that right now."))
      .mockResolvedValueOnce(response(JSON.stringify(VALID_BODY)));

    const result = await validateProductSet(PRODUCTS, ROOM_CONTEXT);

    expect(result.success, `expected recovery after retry: ${JSON.stringify(result)}`).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
  }, 10000);

  it("retries and recovers when the model's JSON fails schema validation (ZodError)", async () => {
    chat
      // isValid must be boolean per ProductSetValidationResponseSchema — a
      // string value parses as valid JSON but fails z.boolean().
      .mockResolvedValueOnce(response(JSON.stringify({ isValid: "yes", confidence: 8, issues: [] })))
      .mockResolvedValueOnce(response(JSON.stringify(VALID_BODY)));

    const result = await validateProductSet(PRODUCTS, ROOM_CONTEXT);

    expect(result.success, `expected recovery after retry: ${JSON.stringify(result)}`).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
  }, 10000);

  it("does NOT retry a non-retryable error — fails on the first attempt", async () => {
    chat.mockRejectedValueOnce(new Error("unexpected provider failure shape"));

    const result = await validateProductSet(PRODUCTS, ROOM_CONTEXT);

    expect(result.success).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
