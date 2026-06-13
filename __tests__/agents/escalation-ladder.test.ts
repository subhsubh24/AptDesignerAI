import { describe, it, expect, vi } from "vitest";
import { escalate, type EscalationConfig } from "@/lib/agents/escalation-ladder";

function makeConfig<T>(
  overrides: Partial<EscalationConfig<T>> & Pick<EscalationConfig<T>, "tiers" | "verify">,
): EscalationConfig<T> {
  return { ...overrides };
}

describe("escalate", () => {
  it("returns at tier 0 when verify passes on first try", async () => {
    const result = await escalate(
      makeConfig<number>({
        tiers: [
          { label: "cheap", generate: async () => 42 },
          { label: "expensive", generate: async () => 99 },
        ],
        verify: () => ({ ok: true }),
      }),
    );

    expect(result.chosen).toBe(42);
    expect(result.tierReached).toBe(0);
    expect(result.accepted).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("escalates to tier 1 when tier 0 fails verify", async () => {
    let callCount = 0;
    const result = await escalate(
      makeConfig<string>({
        tiers: [
          { label: "cheap", generate: async () => "bad" },
          {
            label: "expensive",
            generate: async (prev) => {
              callCount++;
              expect(prev?.reason).toBe("not good enough");
              return "good";
            },
          },
        ],
        verify: (c) =>
          c === "good" ? { ok: true } : { ok: false, reason: "not good enough" },
      }),
    );

    expect(result.chosen).toBe("good");
    expect(result.tierReached).toBe(1);
    expect(result.accepted).toBe(true);
    expect(callCount).toBe(1);
  });

  it("returns best candidate when all tiers fail verify", async () => {
    const result = await escalate(
      makeConfig<number>({
        tiers: [
          { label: "tier0", generate: async () => 1 },
          { label: "tier1", generate: async () => 2 },
        ],
        verify: () => ({ ok: false, reason: "always fails" }),
      }),
    );

    expect(result.accepted).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it("throws when all tiers return null", async () => {
    await expect(
      escalate(
        makeConfig<string>({
          tiers: [
            { label: "tier0", generate: async () => null },
            { label: "tier1", generate: async () => null },
          ],
          verify: () => ({ ok: true }),
        }),
      ),
    ).rejects.toThrow("all tiers returned null or threw");
  });

  it("throws when no tiers provided", async () => {
    await expect(
      escalate(
        makeConfig<string>({
          tiers: [],
          verify: () => ({ ok: true }),
        }),
      ),
    ).rejects.toThrow("at least one tier required");
  });

  it("skips null-returning tiers and continues", async () => {
    const result = await escalate(
      makeConfig<string>({
        tiers: [
          { label: "tier0", generate: async () => null },
          { label: "tier1", generate: async () => "found" },
        ],
        verify: () => ({ ok: true }),
      }),
    );

    expect(result.chosen).toBe("found");
    expect(result.tierReached).toBe(1);
    expect(result.accepted).toBe(true);
  });

  it("handles tiers that throw and continues", async () => {
    const result = await escalate(
      makeConfig<string>({
        tiers: [
          {
            label: "tier0",
            generate: async () => {
              throw new Error("boom");
            },
          },
          { label: "tier1", generate: async () => "recovered" },
        ],
        verify: () => ({ ok: true }),
      }),
    );

    expect(result.chosen).toBe("recovered");
    expect(result.tierReached).toBe(1);
    expect(result.accepted).toBe(true);
  });

  it("calls onTier callback for each tier attempted", async () => {
    const onTier = vi.fn();
    await escalate(
      makeConfig<number>({
        tiers: [
          { label: "cheap", generate: async () => 1 },
          { label: "mid", generate: async () => 2 },
        ],
        verify: (c) => (c === 2 ? { ok: true } : { ok: false, reason: "too low" }),
        onTier,
      }),
    );

    expect(onTier).toHaveBeenCalledTimes(2);
    expect(onTier).toHaveBeenCalledWith(0, "cheap", false);
    expect(onTier).toHaveBeenCalledWith(1, "mid", true);
  });

  it("verify is never called with an LLM (contract test)", async () => {
    const verify = vi.fn(() => ({ ok: true }));
    await escalate(
      makeConfig<string>({
        tiers: [{ label: "tier0", generate: async () => "result" }],
        verify,
      }),
    );

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("result");
  });

  it("propagates prev.reason from verify failure to next tier", async () => {
    const generateSpy = vi.fn(async (prev?: { output: string; reason: string }) => {
      return prev ? `fixed:${prev.reason}` : "first";
    });

    await escalate(
      makeConfig<string>({
        tiers: [
          { label: "tier0", generate: async () => "first" },
          { label: "tier1", generate: generateSpy },
        ],
        verify: (c) =>
          c.startsWith("fixed") ? { ok: true } : { ok: false, reason: "needs fix" },
      }),
    );

    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "needs fix" }),
    );
  });
});
