import http from "node:http";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { extractMoneyGuardTotals, type ProviderAttemptEvent } from "../extract.js";
import { GeminiVisionProvider } from "./gemini.js";

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
  vi.restoreAllMocks();
});

async function listenWithSyntheticFailure(status: 429 | 503) {
  let received = 0;
  const server = http.createServer((request, response) => {
    received += 1;
    request.resume();
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: { code: status, message: "synthetic failure", status: "UNAVAILABLE" },
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback unavailable");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    received: () => received,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  };
}

describe("installed Gemini SDK transport", () => {
  it.each([429, 503] as const)(
    "uses one loopback transport and one wrapper ordinal for synthetic %s",
    async (status) => {
      const loopback = await listenWithSyntheticFailure(status);
      let transportAttempts = 0;
      const events: ProviderAttemptEvent[] = [];
      try {
        globalThis.fetch = vi.fn(async (input, init) => {
          const url = new URL(
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          );
          if (url.origin !== loopback.origin) {
            throw new Error("unexpected non-loopback transport blocked");
          }
          transportAttempts += 1;
          return nativeFetch(input, { ...init, redirect: "manual" });
        });
        const sdk = new GoogleGenAI({
          apiKey: "synthetic-test-key",
          httpOptions: { baseUrl: loopback.origin, apiVersion: "" },
        });
        const vision = new GeminiVisionProvider(
          "synthetic-test-key",
          sdk as never,
        );
        const config = {
          ...loadConfig({
            MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
            MONEYGUARD_PROVIDER_MAX_ATTEMPTS: "1",
          }),
          financePath: path.resolve("finance.example.json"),
          visionModel: "gemini-test",
        };

        const result = await extractMoneyGuardTotals(
          Buffer.from("synthetic image"),
          {
            config,
            mimeType: "image/png",
            vision,
            onProviderAttempt: (event) => events.push(event),
          },
        );

        expect(result).toMatchObject({ ok: false, kind: "provider" });
        expect(transportAttempts).toBe(1);
        expect(loopback.received()).toBe(1);
        expect(events.map((event) => [event.ordinal, event.result])).toEqual([
          [1, "starting"],
          [1, "failed"],
        ]);
        expect(events.some((event) => event.ordinal === 2)).toBe(false);
      } finally {
        await loopback.close();
      }
    },
  );
});
