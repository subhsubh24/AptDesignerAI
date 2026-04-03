/**
 * Structured logging for the AI pipeline.
 *
 * Emits JSON log lines with consistent fields for observability.
 * In production, pipe stdout to a log aggregator (Datadog, Axiom, etc.).
 * Locally, logs are human-readable JSON to the console.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** Which agent or module is logging */
  agent?: string;
  /** Pipeline phase (search, extract, score, bundle, validate) */
  phase?: string;
  /** Room being processed */
  roomId?: string;
  /** Product being evaluated */
  productId?: string;
  /** Category being searched */
  category?: string;
  /** Price tier */
  tier?: string;
  /** Model used */
  model?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Token usage */
  tokens?: { input?: number; output?: number; thinking?: number; total?: number };
  /** Arbitrary metadata */
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimum log level — set via LOG_LEVEL env var. Defaults to "info". */
function getMinLevel(): number {
  const env = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LOG_LEVELS[env] ?? LOG_LEVELS.info;
}

function emit(level: LogLevel, message: string, ctx?: LogContext): void {
  if (LOG_LEVELS[level] < getMinLevel()) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx,
  };

  // Remove undefined values for cleaner output
  const clean = Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined)
  );

  const line = JSON.stringify(clean);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

/**
 * Create a logger scoped to a specific agent/module.
 *
 * Usage:
 *   const log = createLogger("fit-scorer");
 *   log.info("Scoring product", { productId: "abc", model: "flash" });
 */
export function createLogger(agent: string) {
  return {
    debug: (message: string, ctx?: LogContext) => emit("debug", message, { agent, ...ctx }),
    info: (message: string, ctx?: LogContext) => emit("info", message, { agent, ...ctx }),
    warn: (message: string, ctx?: LogContext) => emit("warn", message, { agent, ...ctx }),
    error: (message: string, ctx?: LogContext) => emit("error", message, { agent, ...ctx }),

    /**
     * Time an async operation and log its duration.
     * Returns the operation's result.
     */
    async timed<T>(
      message: string,
      fn: () => Promise<T>,
      ctx?: LogContext
    ): Promise<T> {
      const start = performance.now();
      try {
        const result = await fn();
        const durationMs = Math.round(performance.now() - start);
        emit("info", message, { agent, durationMs, ...ctx });
        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        emit("error", `${message} — failed`, {
          agent,
          durationMs,
          error: err instanceof Error ? err.message : String(err),
          ...ctx,
        });
        throw err;
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
