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
    bytes.length < 57 ||
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
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const nextOffset = offset + 12 + chunkLength;
    if (chunkLength > bytes.length - offset - 12) return false;

    if (!sawIhdr) {
      if (chunkType !== "IHDR" || chunkLength !== 13) return false;
      sawIhdr = true;
    } else if (chunkType === "IHDR") {
      return false;
    }

    if (chunkType === "IDAT") sawIdat = true;
    if (chunkType === "IEND") {
      return sawIhdr && sawIdat && chunkLength === 0 && nextOffset === bytes.length;
    }
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

interface WebpChunkScan {
  valid: boolean;
  hasImageData: boolean;
}

function isVp8ImageData(data: Buffer): boolean {
  return (
    data.length >= 10 &&
    (data[0]! & 0x01) === 0 &&
    data[3] === 0x9d &&
    data[4] === 0x01 &&
    data[5] === 0x2a
  );
}

function isVp8lImageData(data: Buffer): boolean {
  return data.length >= 5 && data[0] === 0x2f && (data[4]! >> 5) === 0;
}

function scanWebpChunks(bytes: Buffer, start: number, end: number, allowVp8x: boolean): WebpChunkScan {
  let offset = start;
  let chunkIndex = 0;
  let sawVp8x = false;
  let hasImageData = false;

  while (offset < end) {
    if (offset + 8 > end) return { valid: false, hasImageData: false };

    const chunkType = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd > end || paddedEnd > end) return { valid: false, hasImageData: false };

    const data = bytes.subarray(dataStart, dataEnd);
    if (chunkType === "VP8X") {
      if (!allowVp8x || chunkIndex !== 0 || sawVp8x || chunkSize !== 10) {
        return { valid: false, hasImageData: false };
      }
      sawVp8x = true;
    } else if (chunkType === "VP8 ") {
      if (!isVp8ImageData(data)) return { valid: false, hasImageData: false };
      hasImageData = true;
    } else if (chunkType === "VP8L") {
      if (!isVp8lImageData(data)) return { valid: false, hasImageData: false };
      hasImageData = true;
    } else if (chunkType === "ANMF") {
      if (data.length < 16) return { valid: false, hasImageData: false };
      const frameChunks = scanWebpChunks(bytes, dataStart + 16, dataEnd, false);
      if (!frameChunks.valid || !frameChunks.hasImageData) {
        return { valid: false, hasImageData: false };
      }
      hasImageData = true;
    } else if (!isKnownWebpMetadataChunk(chunkType)) {
      return { valid: false, hasImageData: false };
    }

    offset = paddedEnd;
    chunkIndex++;
  }

  return { valid: offset === end, hasImageData };
}

function isKnownWebpMetadataChunk(chunkType: string): boolean {
  return (
    chunkType === "ALPH" ||
    chunkType === "ANIM" ||
    chunkType === "ICCP" ||
    chunkType === "EXIF" ||
    chunkType === "XMP "
  );
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

  const chunks = scanWebpChunks(bytes, 12, bytes.length, true);
  return chunks.valid && chunks.hasImageData;
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
