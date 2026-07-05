import { afterEach, describe, expect, it } from "vitest";
import { assertCassetteSafe, geminiProvider } from "@/lib/ai/gemini";
import { CASSETTE_PNG_BASE64 } from "@/lib/ai/cassette-provider";

// Guards the TEST-ONLY AI cassette gate (lib/ai/gemini.ts): it must route the
// render pipeline to the hermetic cassette in CI (E2E_AUTH_STACK=1, no VERCEL)
// but HARD-REFUSE on any deployed (Vercel) environment. A silent prod cassette
// would serve canned images to real, paying users — worse than a crash — so this
// regression test locks the fail-closed behavior AND the CI activation wiring.
// Mirrors __tests__/utils/rate-limiter-bypass.test.ts (the pattern it copies).

const origFlag = process.env.E2E_AUTH_STACK;
const origVercel = process.env.VERCEL;

afterEach(() => {
  if (origFlag === undefined) delete process.env.E2E_AUTH_STACK;
  else process.env.E2E_AUTH_STACK = origFlag;
  if (origVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = origVercel;
});

describe("AI cassette gate (fail-closed on deploy)", () => {
  it("does not refuse by default (no env)", () => {
    delete process.env.E2E_AUTH_STACK;
    delete process.env.VERCEL;
    expect(() => assertCassetteSafe()).not.toThrow();
  });

  it("does not refuse in CI/local when the flag is set and NOT on Vercel", () => {
    process.env.E2E_AUTH_STACK = "1";
    delete process.env.VERCEL;
    expect(() => assertCassetteSafe()).not.toThrow();
  });

  it("HARD-REFUSES (throws) if the flag is set on a Vercel deploy", () => {
    process.env.E2E_AUTH_STACK = "1";
    process.env.VERCEL = "1";
    expect(() => assertCassetteSafe()).toThrow(/E2E_AUTH_STACK is set on a deployed/);
  });

  it("does not refuse on Vercel when the flag is absent", () => {
    delete process.env.E2E_AUTH_STACK;
    process.env.VERCEL = "1";
    expect(() => assertCassetteSafe()).not.toThrow();
  });

  it("routes chat() to the hermetic cassette (real PNG, no network) when the flag is on", async () => {
    // The activation wiring: with the CI flag set, an image-modality request is
    // answered by the cassette — a REAL decodable PNG — WITHOUT hitting Gemini.
    // If this delegation regresses, the money-path journey would silently start
    // calling the real provider (and fail on the CI dummy key), so this pins it.
    process.env.E2E_AUTH_STACK = "1";
    delete process.env.VERCEL;
    const res = await geminiProvider.chat({
      model: "gemini-3-pro-image",
      system: "",
      messages: [{ role: "user", content: "render a product shot" }],
      responseModalities: ["Text", "Image"],
      thinkingConfig: { thinkingLevel: "low" },
    });
    expect(res.imageData?.mimeType).toBe("image/png");
    expect(res.imageData?.data).toBe(CASSETTE_PNG_BASE64);
    // Cassette responses are zero-cost so they never perturb cost accounting.
    expect(res.usage.output_tokens).toBe(0);
  });
});
