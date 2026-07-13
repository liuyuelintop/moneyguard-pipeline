import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type MoneyGuardConfig } from "../config.js";
import { handleExtractRequest } from "./extract.js";
import type { VisionProvider } from "../providers/types.js";
import type { SupportedImageMimeType } from "../image.js";

const CREDENTIAL = "test-private-token";
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

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
  public calls: Array<{ mimeType: SupportedImageMimeType | undefined }> = [];
  constructor(private readonly result: unknown, private readonly failure?: Error) {}

  async vision(
    _imageBuffer: Buffer,
    _prompt: string,
    _model: string | undefined,
    mimeType: SupportedImageMimeType | undefined,
  ): Promise<unknown> {
    this.calls.push({ mimeType });
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
    expect(vision.calls).toHaveLength(0);
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
    expect(vision.calls).toHaveLength(0);
  });

  it("rejects declared MIME types that do not match the image signature", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([PNG_BYTES], { type: "image/jpeg" }));

    const response = await handleExtractRequest(makeRequest(form), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(415);
    expect(await parse(response)).toEqual({ error: "Unsupported image type." });
    expect(vision.calls).toHaveLength(0);
  });

  it("passes the validated PNG MIME type to the vision provider", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(200);
    expect(vision.calls).toEqual([{ mimeType: "image/png" }]);
  });

  it("passes the validated JPEG MIME type to the vision provider", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([JPEG_BYTES], { type: "image/jpeg" }));

    const response = await handleExtractRequest(makeRequest(form), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    expect(response.status).toBe(200);
    expect(vision.calls).toEqual([{ mimeType: "image/jpeg" }]);
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
    expect(consoleError).toHaveBeenCalledWith("[moneyGuard] vision_provider_failed");
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

  it("normalizes unknown marketCondition values without exposing the raw value", async () => {
    const privateMarketMarker = "private-market-condition-marker";
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(
        writeFinance({
          ...FINANCE,
          context: { ...FINANCE.context, marketCondition: privateMarketMarker },
        }),
      ),
      vision,
    });

    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(privateMarketMarker);
  });

  it("logs finance config failures without dumping raw Zod objects or config values", async () => {
    const privateConfigMarker = "private-config-marker";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(
        writeFinance({
          ...FINANCE,
          hourlyRate: -1,
          context: { ...FINANCE.context, currentRole: privateConfigMarker },
        }),
      ),
      vision,
    });

    const logged = consoleError.mock.calls.flat().join(" ");
    expect(response.status).toBe(500);
    expect(logged).toContain("[moneyGuard] finance_config_invalid:");
    expect(logged).toContain("schema_validation_failed");
    expect(logged).not.toContain(privateConfigMarker);
    expect(logged).not.toContain("ZodError");
    expect(logged).not.toContain("stack");
  });
});
