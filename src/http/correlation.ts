import { timecardExtractionContract } from "./internal-contract.js";

export const TIMECARD_CORRELATION_HEADER =
  timecardExtractionContract.correlationHeaderName;
export const TIMECARD_CORRELATION_ID_FORMAT =
  timecardExtractionContract.correlationIdFormat;
export const TIMECARD_CORRELATION_ID_MAX_LENGTH =
  timecardExtractionContract.correlationIdMaximumLength;
export const TIMECARD_CORRELATION_ID_PATTERN =
  timecardExtractionContract.correlationIdPattern;

const uuidV4Pattern = new RegExp(TIMECARD_CORRELATION_ID_PATTERN);

export type CorrelationValidation =
  | { result: "valid"; correlationId: string }
  | { result: "missing" | "invalid" };

export function isValidTimecardCorrelationId(value: string): boolean {
  return (
    value.length <= TIMECARD_CORRELATION_ID_MAX_LENGTH &&
    uuidV4Pattern.test(value)
  );
}

export function validateTimecardCorrelationId(
  value: string | null,
): CorrelationValidation {
  if (value === null || value.length === 0) return { result: "missing" };
  if (!isValidTimecardCorrelationId(value)) return { result: "invalid" };
  return { result: "valid", correlationId: value };
}
