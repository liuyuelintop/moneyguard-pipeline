import fs from "fs";
import { ZodError } from "zod";
import { loadConfig, type MoneyGuardConfig } from "./config.js";
import { computeMetrics } from "./metrics.js";
import { buildAuditPayload } from "./payload.js";
import { AUDIT_SYSTEM_PROMPT, VISION_PROMPT } from "./prompts.js";
import { selectProviders } from "./providers/index.js";
import type { MoneyGuardProviders } from "./providers/types.js";
import { buildReport } from "./report.js";
import {
  AUDIT_CONNECT_RETRY_POLICY,
  streamWithConnectRetry,
  toUserMessage,
  VISION_RETRY_POLICY,
  withRetry,
} from "./resilience.js";
import { DEFAULT_IMAGE_MIME_TYPE, detectImageMimeType, type SupportedImageMimeType } from "./image.js";
import { logSafeError, summarizeConfigError, summarizeValidationError } from "./safe-log.js";
import { type Finance, FinanceSchema, VisionResultSchema } from "./schemas.js";

export interface PipelineCallbacks {
  /** Called on each streamed chunk (`final=false`) and once at the end (`final=true`). */
  onReportUpdate: (reportText: string, final: boolean) => Promise<void>;
}

export interface PipelineOptions extends PipelineCallbacks {
  /** Vision + audit providers. Defaults to env-selected (live, or mock when MONEYGUARD_MOCK). */
  providers?: MoneyGuardProviders;
  /** Override for testing/embedding. Defaults to env-derived config. */
  config?: MoneyGuardConfig;
  /** MIME type for the supplied image. Defaults to image signature detection. */
  imageMimeType?: SupportedImageMimeType;
}

export type PipelineResult =
  | { ok: true }
  | { ok: false; kind: "config" | "vision" | "model"; message: string };

/**
 * Orchestrates the MoneyGuard pipeline end-to-end. Channel-agnostic: streaming is
 * surfaced through `onReportUpdate` so the adapter owns throttling/transport. Providers
 * are injected (defaulting to env selection) so vision/audit backends are swappable and
 * testable. Returns a discriminated result; only genuinely unexpected errors escape as throws.
 */
export async function runMoneyGuardPipeline(
  imageBuffer: Buffer,
  { onReportUpdate, providers, config, imageMimeType }: PipelineOptions,
): Promise<PipelineResult> {
  const cfg = config ?? loadConfig();
  const { vision, audit } = providers ?? selectProviders(cfg);
  const { visionModel, textModel, financePath } = cfg;
  const isDebug = (): boolean => cfg.debug;

  // Step 1: parallel I/O — OCR (with retry) and the local finance ledger are independent.
  let rawOcr: unknown;
  let finance: Finance;
  try {
    [rawOcr, finance] = await Promise.all([
      withRetry(
        () =>
          vision.vision(
            imageBuffer,
            VISION_PROMPT,
            visionModel,
            imageMimeType ?? detectImageMimeType(imageBuffer) ?? DEFAULT_IMAGE_MIME_TYPE,
          ),
        VISION_RETRY_POLICY,
      ),
      fs.promises.readFile(financePath, "utf-8").then((s) => FinanceSchema.parse(JSON.parse(s))),
    ]);
  } catch (err) {
    // Local config errors (bad JSON / failed schema) are distinct from vision/network errors.
    if (err instanceof ZodError || err instanceof SyntaxError) {
      logSafeError("finance_config_invalid", summarizeConfigError(err));
      return {
        ok: false,
        kind: "config",
        message: "System Error: finance.json is missing or invalid.",
      };
    }
    logSafeError("vision_provider_failed");
    return { ok: false, kind: "vision", message: toUserMessage(err) };
  }

  // Step 2: validate untrusted OCR output — never trust a cast.
  const parsed = VisionResultSchema.safeParse(rawOcr);
  if (!parsed.success) {
    if (isDebug()) logSafeError("ocr_validation_failed", summarizeValidationError(parsed.error));
    return {
      ok: false,
      kind: "vision",
      message: "Vision Error: Could not pinpoint the 'Running Total'. Try a clearer shot.",
    };
  }
  const ocr = parsed.data;

  // Step 3: local de-identification — dynamic tag aggregation, nothing raw sent to cloud.
  const metrics = computeMetrics(finance, ocr.totalHours);
  const payload = buildAuditPayload(metrics, ocr, finance.context);

  // Safe metadata only — never provider payloads, OCR text, ledger values, or env values.
  console.log(`[moneyGuard] ok period=${ocr.period} confidence=${ocr.confidence} tier=${metrics.tier}`);

  // Step 4: stream the audit. Retry only covers connection establishment (see resilience.ts).
  try {
    let accumulated = "";
    const stream = streamWithConnectRetry(
      () => audit.streamAudit(payload, AUDIT_SYSTEM_PROMPT),
      AUDIT_CONNECT_RETRY_POLICY,
    );
    for await (const chunk of stream) {
      accumulated += chunk;
      await onReportUpdate(buildReport(ocr, metrics, `${accumulated} ▌`), false);
    }
    await onReportUpdate(buildReport(ocr, metrics, accumulated), true);
    return { ok: true };
  } catch (err) {
    logSafeError("audit_stream_failed");
    return { ok: false, kind: "model", message: toUserMessage(err) };
  }
}
