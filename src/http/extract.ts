import crypto from "crypto";
import { loadConfig, type MoneyGuardConfig } from "../config.js";
import { extractMoneyGuardTotals } from "../extract.js";
import {
  resolveUploadedImageMimeType,
  type SupportedImageMimeType,
  type UploadedImage,
} from "../image.js";
import type { VisionProvider } from "../providers/types.js";
import {
  TIMECARD_CORRELATION_HEADER,
  validateTimecardCorrelationId,
} from "./correlation.js";
import { logExtractMilestone } from "./extract-log.js";

export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_REQUEST_BYTES = DEFAULT_MAX_IMAGE_BYTES + 256 * 1024;

export interface ExtractEndpointOptions {
  credential?: string;
  maxImageBytes?: number;
  maxRequestBytes?: number;
  config?: MoneyGuardConfig;
  vision?: VisionProvider;
}

interface UploadMilestones {
  bodyRead(result: "accepted" | "rejected"): void;
  multipartValidation(result: "accepted" | "rejected"): void;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAuthorized(header: string | null, credential: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), credential);
}

async function readBoundedRequestBody(
  request: Request,
  maxRequestBytes: number,
  milestones: UploadMilestones,
): Promise<Buffer | Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
      milestones.bodyRead("rejected");
      return json(413, { error: "Request is too large." });
    }
  }

  if (!request.body) {
    milestones.bodyRead("accepted");
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel().catch(() => {});
        milestones.bodyRead("rejected");
        return json(413, { error: "Request is too large." });
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    milestones.bodyRead("rejected");
    throw error;
  } finally {
    reader.releaseLock();
  }

  milestones.bodyRead("accepted");
  return Buffer.concat(chunks, totalBytes);
}

async function parseBoundedMultipartForm(
  request: Request,
  maxRequestBytes: number,
  milestones: UploadMilestones,
): Promise<FormData | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    milestones.multipartValidation("rejected");
    return json(400, { error: "Expected multipart/form-data." });
  }

  const body = await readBoundedRequestBody(
    request,
    maxRequestBytes,
    milestones,
  );
  if (body instanceof Response) return body;

  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });

  try {
    return await boundedRequest.formData();
  } catch {
    milestones.multipartValidation("rejected");
    return json(400, { error: "Invalid multipart payload." });
  }
}

async function readMultipartImage(
  request: Request,
  maxImageBytes: number,
  maxRequestBytes: number,
  milestones: UploadMilestones,
): Promise<UploadedImage | Response> {
  const parsed = await parseBoundedMultipartForm(
    request,
    maxRequestBytes,
    milestones,
  );
  if (parsed instanceof Response) return parsed;

  if (parsed.get("mode") !== "real-ocr") {
    milestones.multipartValidation("rejected");
    return json(400, { error: "Invalid extraction mode." });
  }

  const image = parsed.get("image");
  if (!(image instanceof Blob)) {
    milestones.multipartValidation("rejected");
    return json(400, { error: "Missing image upload." });
  }
  if (image.size <= 0) {
    milestones.multipartValidation("rejected");
    return json(400, { error: "Invalid image upload." });
  }
  if (image.size > maxImageBytes) {
    milestones.multipartValidation("rejected");
    return json(413, { error: "Image is too large." });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  const mimeType: SupportedImageMimeType | undefined =
    resolveUploadedImageMimeType(bytes, image.type);
  if (!mimeType) {
    milestones.multipartValidation("rejected");
    return json(415, { error: "Unsupported image type." });
  }

  milestones.multipartValidation("accepted");
  return { bytes, mimeType };
}

export async function handleExtractRequest(
  request: Request,
  options: ExtractEndpointOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/extract") return json(404, { error: "Not found." });
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const startedAt = performance.now();
  logExtractMilestone({
    stage: "request",
    result: "received",
    elapsedMs: 0,
  });

  const correlation = validateTimecardCorrelationId(
    request.headers.get(TIMECARD_CORRELATION_HEADER),
  );
  const correlationId =
    correlation.result === "valid" ? correlation.correlationId : undefined;

  const milestone = (
    stage: string,
    result: string,
    extra: { providerAttempt?: number; responseCategory?: string } = {},
  ) => {
    logExtractMilestone({
      ...(correlationId === undefined ? {} : { correlationId }),
      stage,
      result,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...extra,
    });
  };

  milestone("correlation_validation", correlation.result);

  const finish = (response: Response, responseCategory: string): Response => {
    milestone("final_response", "completed", { responseCategory });
    return response;
  };

  try {
    const credential =
      options.credential ?? process.env.MONEYGUARD_PIPELINE_CREDENTIAL;
    if (!credential) {
      milestone("authorization", "rejected");
      return finish(
        json(503, { error: "Pipeline credential is not configured." }),
        "credential_unavailable",
      );
    }
    if (!isAuthorized(request.headers.get("authorization"), credential)) {
      milestone("authorization", "rejected");
      return finish(json(401, { error: "Unauthorized." }), "unauthorized");
    }
    milestone("authorization", "accepted");

    const config = options.config ?? loadConfig();
    if (!config.providerAttemptPolicy.valid) {
      milestone("configuration", config.providerAttemptPolicy.failureCategory);
      return finish(
        json(500, { error: "Pipeline configuration failed." }),
        "configuration_failure",
      );
    }

    const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    const maxRequestBytes =
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    const uploadedImage = await readMultipartImage(
      request,
      maxImageBytes,
      maxRequestBytes,
      {
        bodyRead: (result) => milestone("body_read", result),
        multipartValidation: (result) =>
          milestone("multipart_validation", result),
      },
    );
    if (uploadedImage instanceof Response) {
      return finish(uploadedImage, "request_rejected");
    }

    const result = await extractMoneyGuardTotals(uploadedImage.bytes, {
      config,
      mimeType: uploadedImage.mimeType,
      vision: options.vision,
      onProviderAttempt: (event) => {
        milestone(
          "provider_invocation",
          event.result === "failed"
            ? (event.failureCategory ?? "provider_unknown_failure")
            : event.result,
          { providerAttempt: event.ordinal },
        );
      },
    });

    if (!result.ok) {
      if (result.kind === "provider") {
        return finish(
          json(502, { error: "OCR provider failed." }),
          "provider_failure",
        );
      }
      if (result.kind === "invalid-ocr") {
        return finish(
          json(422, { error: "OCR output was invalid." }),
          "invalid_ocr",
        );
      }
      return finish(
        json(500, { error: "Pipeline configuration failed." }),
        "configuration_failure",
      );
    }

    return finish(
      json(200, {
        source: "real-ocr",
        extraction: result.extraction,
      }),
      "success",
    );
  } catch {
    milestone("request", "unexpected_failure");
    return finish(
      json(500, { error: "Internal server error." }),
      "unexpected_failure",
    );
  }
}
