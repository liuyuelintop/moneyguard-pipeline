import crypto from "crypto";
import type { MoneyGuardConfig } from "../config.js";
import { extractMoneyGuardTotals } from "../extract.js";
import {
  resolveUploadedImageMimeType,
  type SupportedImageMimeType,
  type UploadedImage,
} from "../image.js";
import type { VisionProvider } from "../providers/types.js";

export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ExtractEndpointOptions {
  credential?: string;
  maxImageBytes?: number;
  config?: MoneyGuardConfig;
  vision?: VisionProvider;
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

async function readMultipartImage(request: Request, maxImageBytes: number): Promise<UploadedImage | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json(400, { error: "Expected multipart/form-data." });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxImageBytes + 64 * 1024) {
    return json(413, { error: "Image is too large." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Invalid multipart payload." });
  }

  if (form.get("mode") !== "real-ocr") {
    return json(400, { error: "Invalid extraction mode." });
  }

  const image = form.get("image");
  if (!(image instanceof Blob)) {
    return json(400, { error: "Missing image upload." });
  }
  if (image.size <= 0 || image.size > maxImageBytes) {
    return json(413, { error: "Image is too large." });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  const mimeType: SupportedImageMimeType | undefined = resolveUploadedImageMimeType(bytes, image.type);
  if (!mimeType) {
    return json(415, { error: "Unsupported image type." });
  }

  return { bytes, mimeType };
}

export async function handleExtractRequest(
  request: Request,
  options: ExtractEndpointOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/extract") return json(404, { error: "Not found." });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const credential = options.credential ?? process.env.MONEYGUARD_PIPELINE_CREDENTIAL;
  if (!credential) return json(503, { error: "Pipeline credential is not configured." });
  if (!isAuthorized(request.headers.get("authorization"), credential)) {
    return json(401, { error: "Unauthorized." });
  }

  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const uploadedImage = await readMultipartImage(request, maxImageBytes);
  if (uploadedImage instanceof Response) return uploadedImage;

  const result = await extractMoneyGuardTotals(uploadedImage.bytes, {
    config: options.config,
    mimeType: uploadedImage.mimeType,
    vision: options.vision,
  });

  if (!result.ok) {
    if (result.kind === "provider") return json(502, { error: "OCR provider failed." });
    if (result.kind === "invalid-ocr") return json(422, { error: "OCR output was invalid." });
    return json(500, { error: "Pipeline configuration failed." });
  }

  return json(200, {
    source: "real-ocr",
    extraction: result.extraction,
  });
}
