import { z } from "zod";

// Closed code sets keep aggregation type-safe and the config contract explicit.
export const CADENCES = ["monthly", "weekly"] as const;
export const COST_TAGS = [
  "essential",
  "strategic_weapon",
  "liability",
  "discretionary",
  "subscription",
  "variable",
] as const;
export const MARKET_CONDITIONS = ["hostile_to_intl_grads", "neutral", "favorable"] as const;

export type CostTag = (typeof COST_TAGS)[number];
type MarketCondition = (typeof MARKET_CONDITIONS)[number];

function normalizeMarketCondition(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if ((MARKET_CONDITIONS as readonly string[]).includes(normalized)) return normalized as MarketCondition;
  return "neutral" satisfies MarketCondition;
}

export const LineItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  cadence: z.enum(CADENCES),
  tags: z.array(z.enum(COST_TAGS)).nonempty(),
});

export const ContextSchema = z.object({
  // Legacy/private configs should not break totals extraction just because this
  // contextual hint drifted. Unknown strings become neutral and are never
  // forwarded raw to provider prompts.
  marketCondition: z.preprocess(normalizeMarketCondition, z.enum(MARKET_CONDITIONS)),
  financialIndependence: z.boolean(),
  currentRole: z.string().min(1),
});

export const FinanceSchema = z.object({
  hourlyRate: z.number().positive(),
  currency: z.string().default("AUD"),
  lineItems: z.array(LineItemSchema).nonempty(),
  context: ContextSchema,
});

// OCR output is untrusted model output — validate at the boundary, never cast.
// `coerce` tolerates a stringified number; 0 hrs / >168 is not a valid successful read.
// `confidence` defaults only when MISSING and rejects an unexpected value (e.g. "medium").
export const VisionResultSchema = z.object({
  totalHours: z.coerce.number().positive().max(168),
  period: z.string().min(1),
  confidence: z.enum(["high", "low"]).default("low"),
});

export type LineItem = z.infer<typeof LineItemSchema>;
export type FinanceContext = z.infer<typeof ContextSchema>;
export type Finance = z.infer<typeof FinanceSchema>;
export type OcrResult = z.infer<typeof VisionResultSchema>;

export type Tier = "THRIVING" | "STABLE" | "TIGHT" | "CRITICAL_CRISIS";

export interface Metrics {
  weeklyGross: number;
  weeklyBurn: number;
  essentialBurn: number;
  strategicBurn: number;
  discretionaryBurn: number;
  netSurplus: number;
  tier: Tier;
  hoursFor150: string;
}
