// Public API barrel.

export {
  runMoneyGuardPipeline,
  type PipelineCallbacks,
  type PipelineOptions,
  type PipelineResult,
} from "./pipeline.js";
export {
  extractMoneyGuardTotals,
  type ExtractionFailureKind,
  type TotalsExtraction,
  type TotalsExtractionOptions,
  type TotalsExtractionResult,
} from "./extract.js";
export {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  handleExtractRequest,
  type ExtractEndpointOptions,
} from "./http/extract.js";
export {
  createExtractServer,
  listenExtractServer,
  resolveExtractListenOptions,
  startExtractServer,
  type ExtractListenOptions,
  type ExtractServerOptions,
} from "./http/server-core.js";

export { loadConfig, type MoneyGuardConfig } from "./config.js";
export {
  DEFAULT_IMAGE_MIME_TYPE,
  SUPPORTED_IMAGE_MIME_TYPES,
  detectImageMimeType,
  isSupportedImageMimeType,
  normalizeDeclaredImageMimeType,
  resolveUploadedImageMimeType,
  type SupportedImageMimeType,
  type UploadedImage,
} from "./image.js";

export {
  selectProviders,
  liveProviders,
  mockProviders,
  GeminiVisionProvider,
  DeepSeekAuditProvider,
  MockVisionProvider,
  MockAuditProvider,
  type MockOptions,
  type VisionProvider,
  type AuditProvider,
  type MoneyGuardProviders,
} from "./providers/index.js";

// Domain building blocks — exported so embedders can reuse the de-identification
// and math layers directly, or build their own transports.
export { computeMetrics } from "./metrics.js";
export { buildAuditPayload } from "./payload.js";
export { buildReport } from "./report.js";
export { AUDIT_SYSTEM_PROMPT, VISION_PROMPT } from "./prompts.js";
export {
  withRetry,
  streamWithConnectRetry,
  isTransientModelError,
  toUserMessage,
  type RetryPolicy,
} from "./resilience.js";
export {
  FinanceSchema,
  VisionResultSchema,
  CADENCES,
  COST_TAGS,
  MARKET_CONDITIONS,
  type Finance,
  type FinanceContext,
  type LineItem,
  type OcrResult,
  type Metrics,
  type Tier,
  type CostTag,
} from "./schemas.js";
