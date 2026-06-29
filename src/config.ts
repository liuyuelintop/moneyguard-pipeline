import path from "path";

// Single source of truth for environment-driven configuration. Keeping these reads
// here (instead of scattered `process.env.X ?? default` across modules) keeps the
// config contract auditable and the rest of the code env-free and pure.

export const DEFAULT_VISION_MODEL = "gemini-2.5-flash";
export const DEFAULT_TEXT_MODEL = "deepseek-v4-flash";

export interface MoneyGuardConfig {
  visionModel: string;
  textModel: string;
  /** When true, log the de-identified payload + extra diagnostics. */
  debug: boolean;
  /** When true, force the deterministic offline mock providers. */
  mock: boolean;
  /** Absolute path to the local finance ledger. */
  financePath: string;
}

const truthy = (v: string | undefined): boolean => v === "true" || v === "1";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MoneyGuardConfig {
  return {
    visionModel: env.MONEY_GUARD_VISION_MODEL ?? DEFAULT_VISION_MODEL,
    textModel: env.MONEY_GUARD_TEXT_MODEL ?? DEFAULT_TEXT_MODEL,
    debug: truthy(env.MONEY_GUARD_DEBUG),
    mock: truthy(env.MONEYGUARD_MOCK),
    // The ledger lives wherever the process is launched from, by convention.
    financePath: path.resolve(process.cwd(), "finance.json"),
  };
}
