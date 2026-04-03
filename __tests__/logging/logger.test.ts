import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "@/lib/logging/logger";

describe("createLogger", () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a logger with all log levels", () => {
    const log = createLogger("test-agent");
    expect(log.debug).toBeTypeOf("function");
    expect(log.info).toBeTypeOf("function");
    expect(log.warn).toBeTypeOf("function");
    expect(log.error).toBeTypeOf("function");
    expect(log.timed).toBeTypeOf("function");
  });

  it("should emit structured JSON to console", () => {
    const log = createLogger("test-agent");
    log.info("test message");

    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const output = consoleSpy.log.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.agent).toBe("test-agent");
    expect(parsed.timestamp).toBeDefined();
  });

  it("should include context fields", () => {
    const log = createLogger("scorer");
    log.info("Scored product", { productId: "abc", model: "flash", finalScore: 7.5 });

    const parsed = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(parsed.productId).toBe("abc");
    expect(parsed.model).toBe("flash");
    expect(parsed.finalScore).toBe(7.5);
  });

  it("should route warn to console.warn", () => {
    const log = createLogger("test");
    log.warn("warning!");

    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.warn.mock.calls[0][0]);
    expect(parsed.level).toBe("warn");
  });

  it("should route error to console.error", () => {
    const log = createLogger("test");
    log.error("failure!");

    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.error.mock.calls[0][0]);
    expect(parsed.level).toBe("error");
  });

  it("should omit undefined context values", () => {
    const log = createLogger("test");
    log.info("clean", { productId: undefined, model: "flash" });

    const parsed = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(parsed).not.toHaveProperty("productId");
    expect(parsed.model).toBe("flash");
  });

  it("timed should log duration on success", async () => {
    const log = createLogger("test");
    const result = await log.timed("Operation", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });

    expect(result).toBe(42);
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(parsed.message).toBe("Operation");
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("timed should log error on failure", async () => {
    const log = createLogger("test");

    await expect(
      log.timed("Failed op", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.error.mock.calls[0][0]);
    expect(parsed.message).toBe("Failed op — failed");
    expect(parsed.error).toBe("boom");
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
  });
});
