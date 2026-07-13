export const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export interface UploadedImage {
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
}

export const DEFAULT_IMAGE_MIME_TYPE: SupportedImageMimeType = "image/jpeg";

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType);
}

export function normalizeDeclaredImageMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function detectImageMimeType(bytes: Buffer): SupportedImageMimeType | undefined {
  const hasPngSignature =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (hasPngSignature) return "image/png";

  const hasJpegSignature = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (hasJpegSignature) return "image/jpeg";

  const hasWebpSignature =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (hasWebpSignature) return "image/webp";

  return undefined;
}

export function resolveUploadedImageMimeType(bytes: Buffer, declaredType: string): SupportedImageMimeType | undefined {
  const detectedType = detectImageMimeType(bytes);
  if (!detectedType) return undefined;

  const normalizedDeclaredType = normalizeDeclaredImageMimeType(declaredType);
  if (normalizedDeclaredType === "") return detectedType;
  if (!isSupportedImageMimeType(normalizedDeclaredType)) return undefined;

  return normalizedDeclaredType === detectedType ? detectedType : undefined;
}
