import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  isRetryableError,
  CircuitBreaker,
  CircuitOpenError,
  withResilientCall,
} from "@/lib/ai/retry";

describe("isRetryableError", () => {
  it("should return true for rate limit errors", () => {
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetryableError(new Error("quota exceeded"))).toBe(true);
  });

  it("should return true for server errors", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("should return true for network errors", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });

  it("should return true for Gemini overloaded errors", () => {
    expect(isRetryableError(new Error("resource exhausted"))).toBe(true);
    expect(isRetryableError(new Error("model overloaded"))).toBe(true);
  });

  it("should return false for non-retryable errors", () => {
    expect(isRetryableError(new Error("Invalid JSON"))).toBe(false);
    expect(isRetryableError(new Error("Missing required field"))).toBe(false);
  });

  it("should check status property on error objects", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 400 })).toBe(false);
  });
});

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable error and succeed", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw on non-retryable error immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid JSON"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })
    ).rejects.toThrow("Invalid JSON");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should throw after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, jitter: false })
    ).rejects.toThrow("503 Service Unavailable");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should call onRetry callback between attempts", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 10, expect.any(Error));
  });

  it("should use exponential backoff", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 100,
      jitter: false,
      onRetry,
    });

    // First retry: 100ms, second: 200ms
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][1]).toBe(100);
    expect(onRetry.mock.calls[1][1]).toBe(200);
  });

  it("should respect maxDelayMs cap", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue("ok");

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      jitter: false,
      onRetry,
    });

    // Second retry would be 2000 but capped at 1500
    expect(onRetry.mock.calls[1][1]).toBe(1500);
  });
});

describe("CircuitBreaker", () => {
  it("should start in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
  });

  it("should open after reaching failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000 });

    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    }

    expect(cb.getState()).toBe("open");
  });

  it("should throw CircuitOpenError when open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});

    await expect(
      cb.execute(() => Promise.resolve("ok"))
    ).rejects.toThrow(CircuitOpenError);
  });

  it("should transition to half-open after reset timeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });

    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(cb.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe("half_open");
  });

  it("should close after enough successes in half-open state", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 10,
      halfOpenSuccesses: 2,
    });

    // Trip the circuit
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));

    // Two successes in half-open → closed
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("half_open");
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("closed");
  });

  it("should reset state correctly", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
  });
});

describe("withResilientCall", () => {
  it("should combine circuit breaker and retry", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 2) throw new Error("503 Service Unavailable");
      return Promise.resolve("ok");
    };

    const result = await withResilientCall(fn, cb, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitter: false,
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("should fail fast when circuit is open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });

    // Trip the circuit
    await cb.execute(() => Promise.reject(new Error("fail"))).catch(() => {});

    await expect(
      withResilientCall(() => Promise.resolve("ok"), cb)
    ).rejects.toThrow(CircuitOpenError);
  });
});
