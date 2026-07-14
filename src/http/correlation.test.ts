import { describe, expect, it } from "vitest";
import {
  isValidTimecardCorrelationId,
  TIMECARD_CORRELATION_HEADER,
  TIMECARD_CORRELATION_ID_FORMAT,
  TIMECARD_CORRELATION_ID_MAX_LENGTH,
  TIMECARD_CORRELATION_ID_PATTERN,
  validateTimecardCorrelationId,
} from "./correlation.js";

describe("timecard correlation contract", () => {
  it("matches the web header, UUID v4 format, and maximum length", () => {
    const valid = "123e4567-e89b-42d3-a456-426614174000";

    expect(TIMECARD_CORRELATION_HEADER).toBe(
      "X-MoneyGuard-Correlation-Id",
    );
    expect(TIMECARD_CORRELATION_ID_MAX_LENGTH).toBe(36);
    expect(TIMECARD_CORRELATION_ID_FORMAT).toBe("uuid-v4");
    expect(TIMECARD_CORRELATION_ID_PATTERN).toBe(
      "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$",
    );
    expect(isValidTimecardCorrelationId(valid)).toBe(true);
    expect(validateTimecardCorrelationId(valid)).toEqual({
      result: "valid",
      correlationId: valid,
    });
    expect(validateTimecardCorrelationId(null)).toEqual({ result: "missing" });
    expect(validateTimecardCorrelationId("")).toEqual({ result: "missing" });
    expect(
      validateTimecardCorrelationId(
        "123e4567-e89b-12d3-a456-426614174000",
      ),
    ).toEqual({ result: "invalid" });
    expect(validateTimecardCorrelationId("x".repeat(37))).toEqual({
      result: "invalid",
    });
  });
});
