import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type MoneyGuardConfig } from "../config.js";
import { handleExtractRequest } from "./extract.js";
import type { VisionProvider } from "../providers/types.js";

const CREDENTIAL = "test-private-token";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

const FINANCE = {
  hourlyRate: 30,
  currency: "AUD",
  lineItems: [{ name: "rent", amount: 100, cadence: "weekly", tags: ["essential"] }],
  context: {
    marketCondition: "neutral",
    financialIndependence: false,
    currentRole: "Hourly Worker",
  },
};

class StubVision implements VisionProvider {
  public calls = 0;
  constructor(private readonly result: unknown, private readonly failure?: Error) {}

  async vision(): Promise<unknown> {
    this.calls++;
    if (this.failure) throw this.failure;
    return this.result;
  }
}

const tmpFiles: string[] = [];

function writeFinance(obj: unknown): string {
  const file = path.join(os.tmpdir(), `mg-extract-finance-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  tmpFiles.push(file);
  return file;
}

function makeConfig(financePath = writeFinance(FINANCE)): MoneyGuardConfig {
  return { ...loadConfig(), financePath, mock: false, debug: false };
}

function makeRequest(form: FormData, token = CREDENTIAL): Request {
  return new Request("http://127.0.0.1/extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

function makeForm(image: Blob = new Blob([PNG_BYTES], { type: "image/png" })): FormData {
  const form = new FormData();
  form.set("mode", "real-ocr");
  form.set("image", image, "timecard.png");
  return form;
}

async function parse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  for (const file of tmpFiles.splice(0)) fs.rmSync(file, { force: true });
  vi.restoreAllMocks();
});

describe("POST /extract", () => {
  it("rejects missing bearer auth before calling the provider", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const request = new Request("http://127.0.0.1/extract", {
      method: "POST",
      body: makeForm(),
    });

    const response = await handleExtractRequest(request, {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(401);
    expect(await parse(response)).toEqual({ error: "Unauthorized." });
    expect(vision.calls).toBe(0);
  });

  it("rejects invalid multipart payloads before calling the provider", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([Buffer.from("not an image")], { type: "text/plain" }));

    const response = await handleExtractRequest(makeRequest(form), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(415);
    expect(await parse(response)).toEqual({ error: "Unsupported image type." });
    expect(vision.calls).toBe(0);
  });

  it("returns a generic provider failure without leaking provider details", async () => {
    const vision = new StubVision(null, new Error("raw OCR text and vendor secret"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    const body = await parse(response);
    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "OCR provider failed." });
    expect(JSON.stringify(body)).not.toContain("raw OCR text");
    expect(consoleError).toHaveBeenCalledWith("[moneyGuard] vision call failed");
  });

  it("rejects invalid OCR output", async () => {
    const vision = new StubVision({ totalHours: 0, period: "2026-W27", confidence: "high" });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(422);
    expect(await parse(response)).toEqual({ error: "OCR output was invalid." });
  });

  it("returns only the approved totals-only response shape", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    const body = await parse(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      source: "real-ocr",
      extraction: {
        totalHours: 40,
        hourlyRate: 30,
        grossWage: 1200,
        currency: "AUD",
        confidence: 0.9,
        warnings: [],
      },
    });
    expect(Object.keys(body)).toEqual(["source", "extraction"]);
    expect(Object.keys(body.extraction as Record<string, unknown>)).toEqual([
      "totalHours",
      "hourlyRate",
      "grossWage",
      "currency",
      "confidence",
      "warnings",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/workerName|employer|fileName|mimeType|sizeBytes/i);
  });
});
