import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type MoneyGuardConfig } from "../config.js";
import type { VisionProvider } from "../providers/types.js";
import type { SupportedImageMimeType } from "../image.js";
import { TIMECARD_CORRELATION_HEADER } from "./correlation.js";
import { handleExtractRequest } from "./extract.js";

const CREDENTIAL = "test-private-token";
const CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const BOUNDARY = "moneyguard-boundary";

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length, 0);
  return Buffer.concat([Buffer.from(type, "ascii"), size, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function webpFile(...chunks: Buffer[]): Buffer {
  const payload = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), riffSize, payload]);
}

const PNG_BYTES = Buffer.concat([
  PNG_SIGNATURE,
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
  pngChunk("IDAT", Buffer.from([0])),
  pngChunk("IEND"),
]);
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
  Buffer.from([0xff, 0xda, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x00, 0xff, 0xd9]),
]);
const VP8L_BYTES = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);
const WEBP_BYTES = webpFile(webpChunk("VP8L", VP8L_BYTES));
const VP8X_ONLY_WEBP_BYTES = webpFile(webpChunk("VP8X", Buffer.alloc(10)));
const ANMF_ONLY_WEBP_BYTES = webpFile(webpChunk("ANMF", Buffer.concat([Buffer.alloc(16), webpChunk("VP8L", VP8L_BYTES)])));
const METADATA_FIRST_WEBP_BYTES = webpFile(webpChunk("EXIF", Buffer.from([0x00, 0x01])), webpChunk("VP8L", VP8L_BYTES));

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

function makeConfig(
  financePath = writeFinance(FINANCE),
  providerMaxAttempts = 1,
): MoneyGuardConfig {
  return {
    ...loadConfig(),
    financePath,
    mock: false,
    debug: false,
    providerAttemptPolicy: {
      valid: true,
      strict: providerMaxAttempts === 1,
      maxAttempts: providerMaxAttempts as 1 | 2 | 3,
    },
  };
}

function makeRequest(form: FormData, token = CREDENTIAL): Request {
  return new Request("http://127.0.0.1/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      [TIMECARD_CORRELATION_HEADER]: CORRELATION_ID,
    },
    body: form,
  });
}

function makeForm(image: Blob = new Blob([PNG_BYTES], { type: "image/png" })): FormData {
  const form = new FormData();
  form.set("mode", "real-ocr");
  form.set("image", image, "timecard.png");
  return form;
}

function makeRawMultipartBody(parts: Array<{ name: string; value: string } | {
  name: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}>): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(part.bytes);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

function makeRawRequest(body: Buffer | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CREDENTIAL}`,
      "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
      [TIMECARD_CORRELATION_HEADER]: CORRELATION_ID,
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function validRawBody(image = PNG_BYTES, contentType = "image/png"): Buffer {
  return makeRawMultipartBody([
    { name: "mode", value: "real-ocr" },
    { name: "image", filename: "timecard", contentType, bytes: image },
  ]);
}

async function parse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  for (const file of tmpFiles.splice(0)) fs.rmSync(file, { force: true });
  vi.restoreAllMocks();
});

describe("POST /extract", () => {
  it("logs request receipt before correlation and authorization without reproducing invalid input", async () => {
    const invalidCorrelation = "private-invalid-correlation-value";
    const request = new Request("http://127.0.0.1/extract", {
      method: "POST",
      headers: {
        [TIMECARD_CORRELATION_HEADER]: invalidCorrelation,
      },
      body: makeForm(),
    });

    const response = await handleExtractRequest(request, {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      vision: new StubVision({
        totalHours: 40,
        period: "2026-W27",
        confidence: "high",
      }),
    });
    const events = vi.mocked(console.info).mock.calls.map(([event]) =>
      event as Record<string, unknown>,
    );

    expect(response.status).toBe(401);
    expect(events.map((event) => [event.stage, event.result])).toEqual([
      ["request", "received"],
      ["correlation_validation", "invalid"],
      ["authorization", "rejected"],
      ["final_response", "completed"],
    ]);
    expect(JSON.stringify(events)).not.toContain(invalidCorrelation);
    expect(events.every((event) => event.correlationId === undefined)).toBe(true);
  });

  it("rejects missing bearer auth before calling the provider", async () => {
    const formData = vi.spyOn(Request.prototype, "formData");
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const request = new Request("http://127.0.0.1/extract", {
      method: "POST",
      body: makeForm(),
    });

    const response = await handleExtractRequest(request, {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      vision,
    });

    expect(response.status).toBe(401);
    expect(await parse(response)).toEqual({ error: "Unauthorized." });
    expect(vision.calls).toHaveLength(0);
    expect(formData).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "invalid", "1.5", "0", "-1", "2", "3", "4"])(
    "fails closed before body/provider work for strict cap %j",
    async (cap) => {
      const env: NodeJS.ProcessEnv = {
        MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
      };
      if (cap !== undefined) env.MONEYGUARD_PROVIDER_MAX_ATTEMPTS = cap;
      const config = {
        ...loadConfig(env),
        financePath: "/finance-should-not-be-read.json",
      };
      const vision = new StubVision({
        totalHours: 40,
        period: "2026-W27",
        confidence: "high",
      });
      const form = makeForm();

      const response = await handleExtractRequest(makeRequest(form), {
        credential: CREDENTIAL,
        config,
        vision,
      });
      const events = vi.mocked(console.info).mock.calls.map(([event]) =>
        event as Record<string, unknown>,
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(vision.calls).toHaveLength(0);
      expect(events).toContainEqual(
        expect.objectContaining({
          stage: "configuration",
          result: "protected_rehearsal_attempt_policy_invalid",
        }),
      );
      expect(events.some((event) => event.stage === "provider_invocation")).toBe(false);
      expect(events.some((event) => event.stage === "body_read")).toBe(false);
    },
  );

  it.each([
    [
      "query parameters",
      "http://127.0.0.1/extract?attemptLimit=1&strictMode=false",
      {},
      "query-policy-marker",
    ],
    [
      "arbitrary request headers",
      "http://127.0.0.1/extract",
      {
        "X-Test-Attempt-Limit": "1",
        "X-Test-Strict-Mode": "false",
      },
      "header-policy-marker",
    ],
    [
      "filename and multipart metadata",
      "http://127.0.0.1/extract",
      {},
      "multipart-policy-marker",
    ],
  ])(
    "does not let %s override an invalid strict cap",
    async (_name, url, extraHeaders, privateMarker) => {
      const config = {
        ...loadConfig({
          MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
          MONEYGUARD_PROVIDER_MAX_ATTEMPTS: "4",
        }),
        financePath: "/finance-should-not-be-read.json",
      };
      const vision = new StubVision({
        totalHours: 40,
        period: "2026-W27",
        confidence: "high",
      });
      const transport = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("unexpected transport"));
      const form = new FormData();
      form.set("mode", "real-ocr");
      form.set(
        "image",
        new Blob([PNG_BYTES], {
          type:
            _name === "filename and multipart metadata"
              ? `image/png; note=${privateMarker}`
              : "image/png",
        }),
        `${privateMarker}.png`,
      );
      const request = new Request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CREDENTIAL}`,
          [TIMECARD_CORRELATION_HEADER]: CORRELATION_ID,
          ...extraHeaders,
        },
        body: form,
      });

      const response = await handleExtractRequest(request, {
        credential: CREDENTIAL,
        config,
        vision,
      });
      const events = vi.mocked(console.info).mock.calls.map(([event]) =>
        event as Record<string, unknown>,
      );

      expect(config.providerAttemptPolicy).toMatchObject({ valid: false });
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(vision.calls).toHaveLength(0);
      expect(transport).not.toHaveBeenCalled();
      expect(events.some((event) => event.stage === "body_read")).toBe(false);
      expect(events.some((event) => event.stage === "provider_invocation")).toBe(false);
      expect(JSON.stringify(events)).not.toContain(privateMarker);
    },
  );

  it("retains the non-strict default of three total provider attempts", async () => {
    const config = {
      ...loadConfig({}),
      financePath: writeFinance(FINANCE),
    };
    const vision = new StubVision(
      null,
      Object.assign(new Error("private transient detail"), { status: 503 }),
    );

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config,
      vision,
    });

    expect(response.status).toBe(502);
    expect(vision.calls).toHaveLength(3);
  });

  it("rejects excessive declared Content-Length before parsing or loading finance", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const body = validRawBody();

    const response = await handleExtractRequest(makeRawRequest(body, { "Content-Length": String(body.length + 1) }), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      maxRequestBytes: body.length,
      vision,
    });

    expect(response.status).toBe(413);
    expect(await parse(response)).toEqual({ error: "Request is too large." });
    expect(vision.calls).toHaveLength(0);
  });

  it("rejects missing Content-Length streamed bodies that exceed the request cap", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(33));
        controller.close();
      },
    });

    const response = await handleExtractRequest(makeRawRequest(stream), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      maxRequestBytes: 32,
      vision,
    });

    expect(response.status).toBe(413);
    expect(await parse(response)).toEqual({ error: "Request is too large." });
    expect(vision.calls).toHaveLength(0);
  });

  it("rejects oversized non-image form fields at the total request boundary", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const body = makeRawMultipartBody([
      { name: "mode", value: "real-ocr" },
      { name: "notes", value: "x".repeat(128) },
      { name: "image", filename: "timecard", contentType: "image/png", bytes: PNG_BYTES },
    ]);

    const response = await handleExtractRequest(makeRawRequest(body), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      maxRequestBytes: body.length - 1,
      vision,
    });

    expect(response.status).toBe(413);
    expect(await parse(response)).toEqual({ error: "Request is too large." });
    expect(vision.calls).toHaveLength(0);
  });

  it("accepts a request exactly at the total request cap", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const body = validRawBody();

    const response = await handleExtractRequest(makeRawRequest(body, { "Content-Length": String(body.length) }), {
      credential: CREDENTIAL,
      config: makeConfig(),
      maxImageBytes: PNG_BYTES.length,
      maxRequestBytes: body.length,
      vision,
    });

    expect(response.status).toBe(200);
    expect(vision.calls).toEqual([{ mimeType: "image/png" }]);
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

  it.each([
    ["empty input", Buffer.alloc(0), "image/png", 400, { error: "Invalid image upload." }],
    ["truncated PNG", PNG_BYTES.subarray(0, PNG_BYTES.length - 1), "image/png", 415, { error: "Unsupported image type." }],
    ["signature-only PNG", PNG_SIGNATURE, "image/png", 415, { error: "Unsupported image type." }],
    ["signature-only JPEG", JPEG_SIGNATURE, "image/jpeg", 415, { error: "Unsupported image type." }],
    [
      "signature-only WebP",
      Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]),
      "image/webp",
      415,
      { error: "Unsupported image type." },
    ],
    ["malformed PNG structure", Buffer.concat([PNG_SIGNATURE, pngChunk("IEND")]), "image/png", 415, { error: "Unsupported image type." }],
    ["malformed JPEG structure", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]), "image/jpeg", 415, { error: "Unsupported image type." }],
    [
      "PNG without IDAT",
      Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
        pngChunk("IEND"),
      ]),
      "image/png",
      415,
      { error: "Unsupported image type." },
    ],
  ])("rejects %s before finance/provider work", async (_label, bytes, mimeType, status, body) => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const response = await handleExtractRequest(makeRequest(makeForm(new Blob([bytes], { type: mimeType }))), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      vision,
    });

    expect(response.status).toBe(status);
    expect(await parse(response)).toEqual(body);
    expect(vision.calls).toHaveLength(0);
  });

  it.each([
    ["valid-looking WebP", WEBP_BYTES, "image/webp"],
    ["VP8X-only WebP", VP8X_ONLY_WEBP_BYTES, "image/webp"],
    ["ANMF-only WebP", ANMF_ONLY_WEBP_BYTES, "image/webp"],
    ["metadata-first WebP", METADATA_FIRST_WEBP_BYTES, "image/webp"],
    ["declared WebP with non-WebP bytes", PNG_BYTES, "image/webp"],
    ["WebP bytes declared as PNG", WEBP_BYTES, "image/png"],
  ])("rejects unsupported %s before finance/provider work", async (_label, bytes, mimeType) => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const response = await handleExtractRequest(makeRequest(makeForm(new Blob([bytes], { type: mimeType }))), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
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

  it("rejects declared PNG when the bytes are JPEG", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([JPEG_BYTES], { type: "image/png" }));

    const response = await handleExtractRequest(makeRequest(form), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      vision,
    });

    expect(response.status).toBe(415);
    expect(await parse(response)).toEqual({ error: "Unsupported image type." });
    expect(vision.calls).toHaveLength(0);
  });

  it("rejects unsupported declared MIME types", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([PNG_BYTES], { type: "application/octet-stream" }));

    const response = await handleExtractRequest(makeRequest(form), {
      credential: CREDENTIAL,
      config: makeConfig("/finance-should-not-be-read.json"),
      vision,
    });

    expect(response.status).toBe(415);
    expect(await parse(response)).toEqual({ error: "Unsupported image type." });
    expect(vision.calls).toHaveLength(0);
  });

  it("passes the validated PNG MIME type for a PNG containing an IDAT chunk", async () => {
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

  it("normalizes image/jpg to the canonical JPEG MIME type", async () => {
    const vision = new StubVision({ totalHours: 40, period: "2026-W27", confidence: "high" });
    const form = makeForm(new Blob([JPEG_BYTES], { type: "image/jpg" }));

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
    expect(consoleError).toHaveBeenCalledWith("[moneyGuard] provider_unknown_failure");
  });

  it.each([429, 503])(
    "makes exactly one provider call in server-controlled single-attempt mode after %s",
    async (status) => {
      const privateFailureMarker = `private-provider-${status}-payload`;
      const failure = Object.assign(new Error(privateFailureMarker), { status });
      const vision = new StubVision(null, failure);
      const form = makeForm();
      form.set("providerMaxAttempts", "3");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handleExtractRequest(makeRequest(form), {
        credential: CREDENTIAL,
        config: makeConfig(undefined, 1),
        vision,
      });
      const events = vi.mocked(console.info).mock.calls.map(([event]) =>
        event as Record<string, unknown>,
      );
      const providerEvents = events.filter(
        (event) => event.stage === "provider_invocation",
      );
      const serializedLogs = JSON.stringify({
        milestones: events,
        errors: consoleError.mock.calls,
      });

      expect(response.status).toBe(502);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(vision.calls).toHaveLength(1);
      expect(providerEvents).toEqual([
        expect.objectContaining({
          result: "starting",
          providerAttempt: 1,
        }),
        expect.objectContaining({
          result:
            status === 429 ? "provider_rate_limited" : "provider_unavailable",
          providerAttempt: 1,
        }),
      ]);
      expect(
        providerEvents.some((event) => event.providerAttempt === 2),
      ).toBe(false);
      expect(serializedLogs).not.toContain(privateFailureMarker);
      expect(serializedLogs).not.toContain("timecard.png");
      expect(serializedLogs).not.toContain("providerMaxAttempts");
    },
  );

  it("emits ordered payload-free milestones for a successful request", async () => {
    const vision = new StubVision({
      totalHours: 40,
      period: "2026-W27",
      confidence: "high",
    });

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });
    const events = vi.mocked(console.info).mock.calls.map(([event]) =>
      event as Record<string, unknown>,
    );
    const stages = events.map((event) => event.stage);
    const allowedKeys = new Set([
      "correlationId",
      "stage",
      "result",
      "elapsedMs",
      "providerAttempt",
      "responseCategory",
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(stages).toEqual([
      "request",
      "correlation_validation",
      "authorization",
      "body_read",
      "multipart_validation",
      "provider_invocation",
      "provider_invocation",
      "final_response",
    ]);
    expect(events[1]).toMatchObject({
      correlationId: CORRELATION_ID,
      result: "valid",
    });
    expect(events.at(-1)).toMatchObject({ responseCategory: "success" });
    for (const event of events) {
      expect(Object.keys(event).every((key) => allowedKeys.has(key))).toBe(true);
    }
    expect(JSON.stringify(events)).not.toMatch(
      /timecard\.png|worker|employer|rawOcrText|credential|image\/png/,
    );
  });

  it("logs provider rate-limit failures as a fixed safe category", async () => {
    const error = Object.assign(new Error("vendor raw response body"), { status: 429 });
    const vision = new StubVision(null, error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleExtractRequest(makeRequest(makeForm()), {
      credential: CREDENTIAL,
      config: makeConfig(),
      vision,
    });

    const logged = consoleError.mock.calls.flat().join(" ");
    expect(response.status).toBe(502);
    expect(logged).toContain("[moneyGuard] provider_rate_limited");
    expect(logged).not.toContain("vendor raw response body");
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
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(consoleWarn).toHaveBeenCalledWith("[moneyGuard] market_condition_normalized");
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
