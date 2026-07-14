import fs from "fs";
import { ZodError } from "zod";
import { loadConfig, type MoneyGuardConfig } from "./config.js";
import { DEFAULT_IMAGE_MIME_TYPE, detectImageMimeType, type SupportedImageMimeType } from "./image.js";
import { computeMetrics } from "./metrics.js";
import { VISION_PROMPT } from "./prompts.js";
import { selectProviders } from "./providers/index.js";
import type { VisionProvider } from "./providers/types.js";
import {
  toUserMessage,
  visionRetryPolicyForMaxAttempts,
  withRetry,
} from "./resilience.js";
import { logSafeError, providerFailureCategory, summarizeConfigError } from "./safe-log.js";
import { type Finance, FinanceSchema, VisionResultSchema } from "./schemas.js";

export type ExtractionFailureKind = "config" | "provider" | "invalid-ocr";

export interface TotalsExtraction {
  totalHours: number;
  hourlyRate: number;
  grossWage: number;
  currency: "AUD";
  confidence: number;
  warnings: string[];
}

export type TotalsExtractionResult =
  | { ok: true; extraction: TotalsExtraction }
  | { ok: false; kind: ExtractionFailureKind; message: string };

export interface TotalsExtractionOptions {
  /** Vision provider. Defaults to env-selected live/mock provider. */
  vision?: VisionProvider;
  /** Override for testing/embedding. Defaults to env-derived config. */
  config?: MoneyGuardConfig;
  /** Validated upload MIME type. Defaults to image signature detection. */
  mimeType?: SupportedImageMimeType;
  /** Safe lifecycle callback for provider attempt observability. */
  onProviderAttempt?: (event: ProviderAttemptEvent) => void;
}

export interface ProviderAttemptEvent {
  ordinal: number;
  result: "starting" | "completed" | "failed";
  failureCategory?: string;
}

function notifyProviderAttempt(
  callback: TotalsExtractionOptions["onProviderAttempt"],
  event: ProviderAttemptEvent,
): void {
  try {
    callback?.(event);
  } catch {
    logSafeError("provider_milestone_failed");
  }
}

function confidenceToNumber(confidence: "high" | "low"): number {
  return confidence === "high" ? 0.9 : 0.55;
}

async function loadFinance(financePath: string): Promise<Finance> {
  const raw = await fs.promises.readFile(financePath, "utf-8");
  return FinanceSchema.parse(JSON.parse(raw));
}

/**
 * Totals-only OCR path for private HTTP integrations.
 *
 * This deliberately stops after the vision + local finance math layers. It does
 * not call the audit/text provider, and it never returns raw OCR text or image
 * metadata to the caller.
 */
export async function extractMoneyGuardTotals(
  imageBuffer: Buffer,
  options: TotalsExtractionOptions = {},
): Promise<TotalsExtractionResult> {
  const config = options.config ?? loadConfig();
  if (!config.providerAttemptPolicy.valid) {
    logSafeError(config.providerAttemptPolicy.failureCategory);
    return {
      ok: false,
      kind: "config",
      message: "System Error: provider attempt policy is invalid.",
    };
  }
  const vision = options.vision ?? selectProviders(config).vision;

  let rawOcr: unknown;
  let finance: Finance;
  let providerAttempt = 0;
  try {
    [rawOcr, finance] = await Promise.all([
      withRetry(
        async () => {
          providerAttempt += 1;
          const ordinal = providerAttempt;
          notifyProviderAttempt(options.onProviderAttempt, {
            ordinal,
            result: "starting",
          });
          try {
            const result = await vision.vision(
              imageBuffer,
              VISION_PROMPT,
              config.visionModel,
              options.mimeType ??
                detectImageMimeType(imageBuffer) ??
                DEFAULT_IMAGE_MIME_TYPE,
            );
            notifyProviderAttempt(options.onProviderAttempt, {
              ordinal,
              result: "completed",
            });
            return result;
          } catch (error) {
            notifyProviderAttempt(options.onProviderAttempt, {
              ordinal,
              result: "failed",
              failureCategory: providerFailureCategory(error),
            });
            throw error;
          }
        },
        visionRetryPolicyForMaxAttempts(
          config.providerAttemptPolicy.maxAttempts,
        ),
      ),
      loadFinance(config.financePath),
    ]);
  } catch (err) {
    if (err instanceof ZodError || err instanceof SyntaxError) {
      logSafeError("finance_config_invalid", summarizeConfigError(err));
      return {
        ok: false,
        kind: "config",
        message: "System Error: finance.json is missing or invalid.",
      };
    }
    logSafeError(providerFailureCategory(err));
    return { ok: false, kind: "provider", message: toUserMessage(err) };
  }

  const parsed = VisionResultSchema.safeParse(rawOcr);
  if (!parsed.success) {
    if (config.debug) logSafeError("provider_invalid_response");
    return {
      ok: false,
      kind: "invalid-ocr",
      message: "Vision Error: Could not extract a valid total.",
    };
  }

  const ocr = parsed.data;
  const metrics = computeMetrics(finance, ocr.totalHours);
  const warnings =
    ocr.confidence === "low" ? ["Low OCR confidence. Review extracted totals before relying on them."] : [];

  return {
    ok: true,
    extraction: {
      totalHours: ocr.totalHours,
      hourlyRate: finance.hourlyRate,
      grossWage: metrics.weeklyGross,
      currency: "AUD",
      confidence: confidenceToNumber(ocr.confidence),
      warnings,
    },
  };
}
