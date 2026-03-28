// pipeline-trace.ts — Observability for the search pipeline

export interface TraceEvent {
  phase: string;
  action: string;
  productId?: string;
  url?: string;
  category?: string;
  tier?: string;
  reason?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface PipelineTrace {
  sessionId: string;
  roomId: string;
  startedAt: number;
  events: TraceEvent[];
  summary: {
    searchQueries: number;
    rawUrls: number;
    afterScreen: number;
    extractionSuccesses: number;
    extractionFailures: number;
    extractionFailureReasons: Record<string, number>;
    quickScoreFiltered: number;
    deepScored: number;
    finalProducts: number;
    bundlesEvaluated: number;
  };
}

export class PipelineTracer {
  private sessionId: string;
  private roomId: string;
  private startedAt: number;
  private events: TraceEvent[];

  constructor(sessionId: string, roomId: string) {
    this.sessionId = sessionId;
    this.roomId = roomId;
    this.startedAt = Date.now();
    this.events = [];
  }

  /** Add an event with an automatic timestamp. */
  trace(event: Omit<TraceEvent, "timestamp">): void {
    this.events.push({ ...event, timestamp: Date.now() });
  }

  /** Shorthand for filtered / skipped events. */
  traceFilter(
    phase: string,
    productId: string,
    url: string,
    reason: string
  ): void {
    this.trace({
      phase,
      action: "filtered",
      productId,
      url,
      reason,
    });
  }

  /** Shorthand for scoring events. */
  traceScore(
    phase: string,
    productId: string,
    score: number,
    metadata?: Record<string, unknown>
  ): void {
    this.trace({
      phase,
      action: "scored",
      productId,
      score,
      metadata,
    });
  }

  /** Shorthand for failure events. */
  traceError(phase: string, url: string, error: unknown): void {
    const reason =
      error instanceof Error ? error.message : String(error);
    this.trace({
      phase,
      action: "failed",
      url,
      reason,
    });
  }

  /** Compute the summary by walking the event list. */
  getSummary(): PipelineTrace["summary"] {
    let searchQueries = 0;
    let rawUrls = 0;
    let afterScreen = 0;
    let extractionSuccesses = 0;
    let extractionFailures = 0;
    const extractionFailureReasons: Record<string, number> = {};
    let quickScoreFiltered = 0;
    let deepScored = 0;
    let finalProducts = 0;
    let bundlesEvaluated = 0;

    for (const e of this.events) {
      switch (e.phase) {
        case "search":
          if (e.action === "query") searchQueries++;
          if (e.action === "found") rawUrls++;
          break;

        case "screen":
          if (e.action === "passed") afterScreen++;
          break;

        case "extract":
          if (e.action === "success") extractionSuccesses++;
          if (e.action === "failed") {
            extractionFailures++;
            const reason = e.reason ?? "unknown";
            extractionFailureReasons[reason] =
              (extractionFailureReasons[reason] ?? 0) + 1;
          }
          break;

        case "quick_score":
          if (e.action === "filtered") quickScoreFiltered++;
          break;

        case "deep_score":
          if (e.action === "scored") deepScored++;
          break;

        case "bundle":
          if (e.action === "evaluated") bundlesEvaluated++;
          if (e.action === "selected") finalProducts++;
          break;
      }
    }

    return {
      searchQueries,
      rawUrls,
      afterScreen,
      extractionSuccesses,
      extractionFailures,
      extractionFailureReasons,
      quickScoreFiltered,
      deepScored,
      finalProducts,
      bundlesEvaluated,
    };
  }

  /** Return the full trace including the computed summary. */
  getTrace(): PipelineTrace {
    return {
      sessionId: this.sessionId,
      roomId: this.roomId,
      startedAt: this.startedAt,
      events: [...this.events],
      summary: this.getSummary(),
    };
  }

  /** Return every event that references a specific product. */
  getProductJourney(productId: string): TraceEvent[] {
    return this.events.filter((e) => e.productId === productId);
  }

  /** Return a compact list of every failure across the pipeline. */
  getFailureReport(): { phase: string; url: string; reason: string }[] {
    return this.events
      .filter((e) => e.action === "failed")
      .map((e) => ({
        phase: e.phase,
        url: e.url ?? "",
        reason: e.reason ?? "unknown",
      }));
  }
}
