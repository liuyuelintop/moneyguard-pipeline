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
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function isPng(bytes: Buffer): boolean {
  if (
    bytes.length < 45 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return false;
  }

  let offset = 8;
  let sawIhdr = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const nextOffset = offset + 12 + chunkLength;
    if (chunkLength > bytes.length - offset - 12) return false;

    if (!sawIhdr) {
      if (chunkType !== "IHDR" || chunkLength !== 13) return false;
      sawIhdr = true;
    }

    if (chunkType === "IEND") return sawIhdr && chunkLength === 0 && nextOffset === bytes.length;
    offset = nextOffset;
  }

  return false;
}

function markerHasLength(marker: number): boolean {
  return marker !== 0x01 && !(marker >= 0xd0 && marker <= 0xd9);
}

function isJpeg(bytes: Buffer): boolean {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;

  let offset = 2;
  let sawSegment = false;
  let sawScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length - 2 && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length - 2) return false;

    const marker = bytes[offset];
    if (marker === undefined) return false;
    offset++;
    if (marker === 0xd9) return offset === bytes.length;
    if (!markerHasLength(marker)) continue;
    if (offset + 2 > bytes.length - 2) return false;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || segmentLength > bytes.length - offset) return false;
    const nextOffset = offset + segmentLength;
    if (nextOffset > bytes.length - 2) return false;

    sawSegment = true;
    if (marker === 0xda) {
      sawScan = true;
      break;
    }
    offset = nextOffset;
  }

  return sawSegment && sawScan;
}

function isWebp(bytes: Buffer): boolean {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return false;
  }

  const riffSize = bytes.readUInt32LE(4);
  if (riffSize !== bytes.length - 8) return false;

  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (chunkType !== "VP8 " && chunkType !== "VP8L" && chunkType !== "VP8X") return false;

  const chunkSize = bytes.readUInt32LE(16);
  const paddedChunkSize = chunkSize + (chunkSize % 2);
  return 20 + paddedChunkSize === bytes.length;
}

export function detectImageMimeType(bytes: Buffer): SupportedImageMimeType | undefined {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
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
