import pLimit from "p-limit";

/**
 * THE single gate on concurrent image fetches against our own storage.
 *
 * Two distinct code paths pull image bytes before a vision call — `gemini.ts`
 * inlining a `url` block during `convertMessages`, and `resolve-image.ts`
 * uploading through the Files API — and both need bounding for the same reason:
 * a message carrying many photos must not open one socket per photo.
 *
 * They previously each built their OWN `pLimit(Number(process.env
 * .GEMINI_IMAGE_FETCH_CONCURRENCY) || 6)`. Sharing the env var made that LOOK
 * like one budget, but two independent limiter instances mean the same image can
 * be gated by both at once, so real concurrent sockets against storage could
 * reach 2x the configured value — the opposite of what a single named ceiling
 * implies. One instance, imported by both, is the fix.
 *
 * Deliberately NOT the model-call limiter in `gemini.ts`: that one exists to
 * hold a per-minute API quota, and running plain HTTP GETs through it would make
 * a prefetch compete with in-flight model calls for the same slots — turning a
 * prefetch into a stall. Same reasoning, separate budget.
 */
export const IMAGE_FETCH_CONCURRENCY =
  Number(process.env.GEMINI_IMAGE_FETCH_CONCURRENCY) || 6;

export const imageFetchLimit = pLimit(IMAGE_FETCH_CONCURRENCY);
