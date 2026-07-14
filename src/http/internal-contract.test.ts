import { describe, expect, it } from "vitest";
import { SUPPORTED_IMAGE_MIME_TYPES } from "../image.js";
import {
  TIMECARD_CORRELATION_HEADER,
  TIMECARD_CORRELATION_ID_FORMAT,
  TIMECARD_CORRELATION_ID_MAX_LENGTH,
  TIMECARD_CORRELATION_ID_PATTERN,
} from "./correlation.js";
import { timecardExtractionContract } from "./internal-contract.js";

describe("pipeline machine-readable extraction contract", () => {
  it("self-validates every runtime contract field", () => {
    expect(SUPPORTED_IMAGE_MIME_TYPES).toEqual(
      timecardExtractionContract.acceptedMimeTypes,
    );
    expect(TIMECARD_CORRELATION_HEADER).toBe(
      timecardExtractionContract.correlationHeaderName,
    );
    expect(TIMECARD_CORRELATION_ID_FORMAT).toBe("uuid-v4");
    expect(TIMECARD_CORRELATION_ID_MAX_LENGTH).toBe(36);
    expect(TIMECARD_CORRELATION_ID_PATTERN).toBe(
      timecardExtractionContract.correlationIdPattern,
    );
  });
});
