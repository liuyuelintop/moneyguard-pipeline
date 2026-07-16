import rawContract from "../../contracts/timecard-extraction.json" with { type: "json" };

export type ContractImageMimeType = "image/jpeg" | "image/png";

type TimecardExtractionContract = {
  acceptedMimeTypes: readonly ContractImageMimeType[];
  correlationHeaderName: "X-MoneyGuard-Correlation-Id";
  correlationIdFormat: "uuid-v4";
  correlationIdMaximumLength: 36;
  correlationIdPattern: string;
};

function parseContract(value: unknown): TimecardExtractionContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid timecard extraction contract");
  }
  const contract = value as Record<string, unknown>;
  const expectedKeys = [
    "acceptedMimeTypes",
    "correlationHeaderName",
    "correlationIdFormat",
    "correlationIdMaximumLength",
    "correlationIdPattern",
  ];
  const acceptedMimeTypes = contract.acceptedMimeTypes;
  if (
    Object.keys(contract).sort().join(",") !== expectedKeys.sort().join(",") ||
    !Array.isArray(acceptedMimeTypes) ||
    acceptedMimeTypes.join(",") !== "image/jpeg,image/png" ||
    contract.correlationHeaderName !== "X-MoneyGuard-Correlation-Id" ||
    contract.correlationIdFormat !== "uuid-v4" ||
    contract.correlationIdMaximumLength !== 36 ||
    typeof contract.correlationIdPattern !== "string"
  ) {
    throw new Error("Invalid timecard extraction contract");
  }
  new RegExp(contract.correlationIdPattern);
  return contract as TimecardExtractionContract;
}

export const timecardExtractionContract = parseContract(rawContract);
