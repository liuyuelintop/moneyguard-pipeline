import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type MoneyGuardConfig } from "../config.js";
import type { SupportedImageMimeType } from "../image.js";
import type { VisionProvider } from "../providers/types.js";
import { handleExtractRequest } from "./extract.js";

const credential = "synthetic-test-token";
const boundary = "no-store-boundary";

function chunk(type: string, data = Buffer.alloc(0)) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  return Buffer.concat([size, Buffer.from(type), data, Buffer.alloc(4)]);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
  chunk("IDAT", Buffer.from([0])),
  chunk("IEND"),
]);

class Vision implements VisionProvider {
  constructor(
    private readonly output: unknown,
    private readonly failure?: Error,
  ) {}
  async vision(
    _image: Buffer,
    _prompt: string,
    _model?: string,
    _mime?: SupportedImageMimeType,
  ) {
    if (this.failure) throw this.failure;
    return this.output;
  }
}

function config(): MoneyGuardConfig {
  return {
    ...loadConfig({
      MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
      MONEYGUARD_PROVIDER_MAX_ATTEMPTS: "1",
    }),
    financePath: path.resolve("finance.example.json"),
    mock: false,
  };
}

function form({
  mode = "real-ocr",
  image = new Blob([png], { type: "image/png" }),
  includeMode = true,
  includeImage = true,
} = {}) {
  const value = new FormData();
  if (includeMode) value.set("mode", mode);
  if (includeImage) value.set("image", image, "synthetic");
  return value;
}

type LocalRequestBody =
  | FormData
  | string
  | Buffer
  | ReadableStream<Uint8Array>
  | null;

function request(body: LocalRequestBody = form(), init: RequestInit = {}) {
  return new Request("http://127.0.0.1/extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, ...init.headers },
    body,
    ...init,
  });
}

function rawRequest(body: Exclude<LocalRequestBody, FormData | null>, headers: Record<string, string> = {}) {
  return request(body, {
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      ...headers,
    },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

const validVision = () => new Vision({
  totalHours: 40,
  period: "2026-W27",
  confidence: "high",
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /extract application responses", () => {
  const cases: Array<[string, () => Promise<Response>, number]> = [
    ["unsupported path", () => handleExtractRequest(new Request("http://127.0.0.1/other")), 404],
    ["unsupported method", () => handleExtractRequest(new Request("http://127.0.0.1/extract")), 405],
    ["missing credential configuration", () => handleExtractRequest(request(), { config: config() }), 503],
    ["authentication rejection", () => handleExtractRequest(request(form(), { headers: { Authorization: "Bearer wrong" } }), { credential, config: config() }), 401],
    ["non-multipart request", () => handleExtractRequest(request("plain"), { credential, config: config() }), 400],
    ["declared request-size rejection", () => handleExtractRequest(rawRequest(Buffer.from("x"), { "Content-Length": "2" }), { credential, config: config(), maxRequestBytes: 1 }), 413],
    ["streamed request-size rejection", () => handleExtractRequest(rawRequest(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2)); controller.close(); } })), { credential, config: config(), maxRequestBytes: 1 }), 413],
    ["request-reading failure", () => handleExtractRequest(rawRequest(new ReadableStream({ start(controller) { controller.error(new Error("synthetic read failure")); } })), { credential, config: config() }), 500],
    ["malformed multipart", () => handleExtractRequest(rawRequest(Buffer.from("malformed")), { credential, config: config() }), 400],
    ["missing mode", () => handleExtractRequest(request(form({ includeMode: false })), { credential, config: config() }), 400],
    ["invalid mode", () => handleExtractRequest(request(form({ mode: "other" })), { credential, config: config() }), 400],
    ["missing image", () => handleExtractRequest(request(form({ includeImage: false })), { credential, config: config() }), 400],
    ["empty image", () => handleExtractRequest(request(form({ image: new Blob([], { type: "image/png" }) })), { credential, config: config() }), 400],
    ["image-size rejection", () => handleExtractRequest(request(), { credential, config: config(), maxImageBytes: png.length - 1 }), 413],
    ["invalid image MIME", () => handleExtractRequest(request(form({ image: new Blob([png], { type: "image/webp" }) })), { credential, config: config() }), 415],
    ["invalid image signature", () => handleExtractRequest(request(form({ image: new Blob([Buffer.from("invalid")], { type: "image/png" }) })), { credential, config: config() }), 415],
    ["strict configuration rejection", () => handleExtractRequest(request(), { credential, config: { ...config(), providerAttemptPolicy: { valid: false, strict: true, failureCategory: "protected_rehearsal_attempt_policy_invalid" } }, vision: validVision() }), 500],
    ["provider transient failure", () => handleExtractRequest(request(), { credential, config: config(), vision: new Vision(null, Object.assign(new Error("synthetic"), { status: 503 })) }), 502],
    ["provider non-transient failure", () => handleExtractRequest(request(), { credential, config: config(), vision: new Vision(null, Object.assign(new Error("synthetic"), { status: 400 })) }), 502],
    ["provider output validation failure", () => handleExtractRequest(request(), { credential, config: config(), vision: new Vision({ totalHours: 0, period: "2026-W27", confidence: "high" }) }), 422],
    ["finance configuration failure", () => handleExtractRequest(request(), { credential, config: { ...config(), financePath: path.resolve("package.json") }, vision: validVision() }), 500],
    ["unexpected internal failure", () => {
      const options = { config: config() } as { credential?: string; config: MoneyGuardConfig };
      Object.defineProperty(options, "credential", { get() { throw new Error("synthetic internal failure"); } });
      return handleExtractRequest(request(), options);
    }, 500],
    ["successful extraction", () => handleExtractRequest(request(), { credential, config: config(), vision: validVision() }), 200],
  ];

  it.each(cases)("adds no-store for %s", async (_name, run, status) => {
    const response = await run();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
