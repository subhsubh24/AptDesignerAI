/**
 * Retry utility with exponential backoff and circuit breaker.
 *
 * Provides resilient API call handling for the AI pipeline:
 * - Exponential backoff with jitter for transient failures
 * - Circuit breaker to fail fast during sustained outages
 * - Configurable per-operation retry policies
 *
 * When DETERMINISTIC_MODE=true (see lib/ai/determinism.ts), jitter is
 * disabled so retry timing is reproducible run-to-run.
 */

import { DETERMINISTIC } from "./determinism";

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay in ms. Default: 30000 */
  maxDelayMs?: number;
  /** Whether to add jitter to backoff delays. Default: true */
  jitter?: boolean;
  /** Which errors are retryable. Default: rate limits + 5xx + network errors */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry with attempt number and delay */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/** Default retryable error classifier */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) return true;
    // Server errors
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    // Network errors
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout")) return true;
    if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("socket")) return true;
    // Gemini overloaded
    if (msg.includes("overloaded") || msg.includes("resource exhausted")) return true;
  }
  // Check for status code on error objects
  const e = error as Record<string, unknown>;
  if (typeof e?.status === "number") {
    return e.status === 429 || e.status >= 500;
  }
  return false;
}

/**
 * Execute an async function with exponential backoff retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = true,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }

      // Exponential backoff: baseDelay * 2^(attempt-1)
      let delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

      // Add jitter: random value between 0 and delay.
      // Disabled under DETERMINISTIC_MODE so retry timing is reproducible.
      if (jitter && !DETERMINISTIC) {
        delay = Math.round(delay * (0.5 + Math.random() * 0.5));
      }

      onRetry?.(attempt, delay, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ─── Circuit Breaker ─────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** How long to wait (ms) before trying again (half-open). Default: 60000 */
  resetTimeoutMs?: number;
  /** Successes in half-open state needed to close. Default: 2 */
  halfOpenSuccesses?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccesses: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 2;
  }

  getState(): CircuitState {
    if (this.state === "open") {
      // Check if reset timeout has passed → transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half_open";
        this.successes = 0;
      }
    }
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new CircuitOpenError(
        `Circuit breaker is open. ${Math.ceil((this.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s until retry.`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half_open") {
      this.successes++;
      if (this.successes >= this.halfOpenSuccesses) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  /** Reset for testing */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Combine retry + circuit breaker for a resilient API call.
 */
export async function withResilientCall<T>(
  fn: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryOptions?: RetryOptions
): Promise<T> {
  return circuitBreaker.execute(() => withRetry(fn, retryOptions));
}
