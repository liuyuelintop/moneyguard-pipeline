import { ZodError } from "zod";

// Local retry/backoff + transient-error detection + user-facing error mapping.
// Self-contained: no framework or network-client coupling, so it ports cleanly
// across any transport.

export interface RetryPolicy {
  /** Maximum retry attempts (excluding the initial attempt). */
  maxRetries: number;
  /** Base delay in milliseconds. */
  baseDelayMs: number;
  /** Backoff strategy. */
  backoff: "exponential" | "fixed";
  /**
   * Decide whether an error is retryable. Defaults to {@link isTransientModelError}.
   * Return `false` to rethrow immediately.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/** True for transient model/network errors worth retrying (429 + 5xx, overload, rate limit). */
export function isTransientModelError(err: unknown): boolean {
  if (err == null) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && TRANSIENT_STATUS.has(status)) return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "number" && TRANSIENT_STATUS.has(code)) return true;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /\b(429|500|502|503|504)\b/.test(msg) || /overload|rate.?limit|unavailable/i.test(msg);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Equal jitter: half the backoff window is fixed, half is random — spreads retries
// without ever waiting near-zero.
function backoffDelay(policy: RetryPolicy, attempt: number): number {
  const base =
    policy.backoff === "exponential" ? policy.baseDelayMs * 2 ** attempt : policy.baseDelayMs;
  return base / 2 + Math.random() * (base / 2);
}

/** Retry an atomic async operation with backoff. Safe only for non-streaming calls. */
export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = policy.shouldRetry
        ? policy.shouldRetry(err, attempt)
        : isTransientModelError(err);
      if (!retryable || attempt >= policy.maxRetries) throw err;
      await sleep(backoffDelay(policy, attempt));
    }
  }
  throw lastError;
}

/**
 * Stream with retry limited to CONNECTION establishment. We retry only while the
 * underlying iterable throws BEFORE yielding its first chunk; once any chunk has been
 * emitted we never retry, because re-running the stream would replay already-sent tokens.
 */
export async function* streamWithConnectRetry<T>(
  makeStream: () => AsyncIterable<T>,
  policy: RetryPolicy,
): AsyncGenerator<T> {
  for (let attempt = 0; ; attempt++) {
    const iterator = makeStream()[Symbol.asyncIterator]();
    let first: IteratorResult<T>;
    try {
      first = await iterator.next();
    } catch (err) {
      const retryable = policy.shouldRetry
        ? policy.shouldRetry(err, attempt)
        : isTransientModelError(err);
      if (!retryable || attempt >= policy.maxRetries) throw err;
      await sleep(backoffDelay(policy, attempt));
      continue;
    }
    // Connected. From here, propagate chunks and errors without retrying.
    if (first.done) return;
    yield first.value;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      yield next.value;
    }
    return;
  }
}

/** Map a technical error into a clear, non-leaky user-facing message. */
export function toUserMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return "System Error: internal validation failed. Please try again.";
  }
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : "";
  if (status === 503 || /overload|unavailable|\b503\b/i.test(msg)) {
    return "The vision model is overloaded right now. Give it a moment and resend your timecard.";
  }
  if (status === 429 || /rate.?limit|\b429\b/i.test(msg)) {
    return "Hitting rate limits right now. Wait a few seconds and resend your timecard.";
  }
  return "System Error: Perception-Reasoning pipeline disconnected.";
}

export const VISION_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 800,
  backoff: "exponential",
};

export const AUDIT_CONNECT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 800,
  backoff: "exponential",
};
