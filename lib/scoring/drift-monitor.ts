/**
 * Score distribution monitoring and drift detection.
 *
 * Tracks score distributions per dimension across product evaluations
 * and warns when scores cluster too tightly (the model is ignoring
 * calibration anchors) or drift above acceptable medians.
 *
 * Usage: call `recordScores()` after each scoring call, and
 * `checkForDrift()` periodically (e.g., at the end of an orchestration run).
 */

interface ScoreRecord {
  dimension: string;
  value: number;
  timestamp: number;
}

interface DriftWarning {
  dimension: string;
  issue: "clustering" | "high_median" | "low_spread";
  message: string;
  median: number;
  stddev: number;
  sampleSize: number;
}

/** Compute proper median with interpolation for even-length sorted arrays. */
function computeMedian(sorted: number[]): number {
  const len = sorted.length;
  if (len === 0) return 0;
  if (len % 2 === 1) return sorted[Math.floor(len / 2)];
  return (sorted[len / 2 - 1] + sorted[len / 2]) / 2;
}

// In-memory buffer — resets per process. For persistent monitoring,
// write these to the DB or an observability service.
const scoreBuffer: ScoreRecord[] = [];

/** Max records to keep in memory to prevent unbounded growth. */
const MAX_BUFFER_SIZE = 5000;

/** Minimum sample size before we run drift checks. */
const MIN_SAMPLE_SIZE = 10;

/**
 * Record a set of product scores for drift monitoring.
 */
export function recordProductScores(scores: Record<string, number>): void {
  const now = Date.now();
  for (const [dimension, value] of Object.entries(scores)) {
    if (typeof value !== "number" || isNaN(value)) continue;
    scoreBuffer.push({ dimension, value, timestamp: now });
  }

  // Evict oldest records if buffer is full
  if (scoreBuffer.length > MAX_BUFFER_SIZE) {
    scoreBuffer.splice(0, scoreBuffer.length - MAX_BUFFER_SIZE);
  }
}

/**
 * Record a set of bundle scores for drift monitoring.
 */
export function recordBundleScores(scores: Record<string, number>): void {
  recordProductScores(scores); // Same logic, different caller
}

/**
 * Check for score drift and return any warnings.
 *
 * Thresholds:
 * - Clustering: std dev < 1.2 with sample size >= 10 → model not using full range
 * - High median: median > 7.5 → model is inflating scores
 * - Low spread: max - min < 3 → model giving everything similar scores
 */
export function checkForDrift(): DriftWarning[] {
  const warnings: DriftWarning[] = [];

  // Group by dimension
  const byDimension = new Map<string, number[]>();
  for (const record of scoreBuffer) {
    const values = byDimension.get(record.dimension) || [];
    values.push(record.value);
    byDimension.set(record.dimension, values);
  }

  for (const [dimension, values] of byDimension.entries()) {
    if (values.length < MIN_SAMPLE_SIZE) continue;

    // Skip confidence_score — it's data-quality, not a design judgment
    if (dimension === "confidence_score") continue;

    const sorted = [...values].sort((a, b) => a - b);
    const median = computeMedian(sorted);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    const range = sorted[sorted.length - 1] - sorted[0];

    // Check: clustering (std dev too low)
    if (stddev < 1.2) {
      warnings.push({
        dimension,
        issue: "clustering",
        message: `${dimension}: scores clustering (stddev=${stddev.toFixed(2)}, median=${median.toFixed(1)}). Model may not be using full 0-10 range.`,
        median,
        stddev,
        sampleSize: values.length,
      });
    }

    // Check: median too high (score inflation)
    if (median > 7.5) {
      warnings.push({
        dimension,
        issue: "high_median",
        message: `${dimension}: median score ${median.toFixed(1)} is above 7.5. Possible score inflation — calibration anchors may need reinforcement.`,
        median,
        stddev,
        sampleSize: values.length,
      });
    }

    // Check: range too narrow
    if (range < 3 && values.length >= MIN_SAMPLE_SIZE) {
      warnings.push({
        dimension,
        issue: "low_spread",
        message: `${dimension}: score range is only ${range.toFixed(1)} (${sorted[0].toFixed(1)}-${sorted[sorted.length - 1].toFixed(1)}). Model giving everything similar scores.`,
        median,
        stddev,
        sampleSize: values.length,
      });
    }
  }

  return warnings;
}

/**
 * Get a summary of current score distributions for logging.
 */
export function getScoreDistributionSummary(): Record<string, { count: number; median: number; mean: number; stddev: number; min: number; max: number }> {
  const summary: Record<string, { count: number; median: number; mean: number; stddev: number; min: number; max: number }> = {};

  const byDimension = new Map<string, number[]>();
  for (const record of scoreBuffer) {
    const values = byDimension.get(record.dimension) || [];
    values.push(record.value);
    byDimension.set(record.dimension, values);
  }

  for (const [dimension, values] of byDimension.entries()) {
    // Require minimum sample size for reliable statistics
    if (values.length < 3) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    summary[dimension] = {
      count: values.length,
      median: computeMedian(sorted),
      mean: Math.round(mean * 100) / 100,
      stddev: Math.round(Math.sqrt(variance) * 100) / 100,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  return summary;
}

/**
 * Reset the score buffer (useful for tests).
 */
export function resetScoreBuffer(): void {
  scoreBuffer.length = 0;
}
