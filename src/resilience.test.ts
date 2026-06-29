import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  isTransientModelError,
  streamWithConnectRetry,
  toUserMessage,
  withRetry,
  type RetryPolicy,
} from "./resilience.js";

// baseDelayMs: 0 → backoff resolves on the next tick, so tests don't actually wait.
const FAST: RetryPolicy = { maxRetries: 2, baseDelayMs: 0, backoff: "fixed" };

function transient(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("isTransientModelError", () => {
  it("is true for 429 and 5xx by status or message, false for 4xx", () => {
    expect(isTransientModelError(transient(429))).toBe(true);
    expect(isTransientModelError(transient(503))).toBe(true);
    expect(isTransientModelError(new Error("model overloaded"))).toBe(true);
    expect(isTransientModelError(transient(400))).toBe(false);
    expect(isTransientModelError(null)).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries a transient error then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      if (calls++ < 2) throw transient(503);
      return "ok";
    });
    await expect(withRetry(fn, FAST)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-transient error immediately without retrying", async () => {
    const err = transient(400);
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, FAST)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("streamWithConnectRetry", () => {
  it("retries while the stream fails BEFORE the first chunk", async () => {
    let attempts = 0;
    async function* failFirst(): AsyncGenerator<string> {
      throw transient(503);
    }
    async function* good(): AsyncGenerator<string> {
      yield "a";
      yield "b";
    }
    const make = () => (attempts++ < 1 ? failFirst() : good());

    const out: string[] = [];
    for await (const c of streamWithConnectRetry(make, FAST)) out.push(c);
    expect(out).toEqual(["a", "b"]);
    expect(attempts).toBe(2);
  });

  it("does NOT retry once a chunk has been emitted (no double-emit)", async () => {
    let calls = 0;
    async function* failMid(): AsyncGenerator<string> {
      yield "a";
      throw transient(503);
    }
    const make = () => {
      calls++;
      return failMid();
    };

    const out: string[] = [];
    await expect(
      (async () => {
        for await (const c of streamWithConnectRetry(make, FAST)) out.push(c);
      })(),
    ).rejects.toBeTruthy();
    expect(out).toEqual(["a"]);
    expect(calls).toBe(1);
  });
});

describe("toUserMessage", () => {
  it("maps 503, 429, ZodError and unknown errors", () => {
    expect(toUserMessage(transient(503))).toMatch(/overloaded/i);
    expect(toUserMessage(transient(429))).toMatch(/rate limit/i);
    expect(toUserMessage(new ZodError([]))).toContain("System Error");
    expect(toUserMessage(new Error("boom"))).toContain("System Error");
  });
});
