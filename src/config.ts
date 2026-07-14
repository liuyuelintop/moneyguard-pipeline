import path from "path";

// Single source of truth for environment-driven configuration. Keeping these reads
// here (instead of scattered `process.env.X ?? default` across modules) keeps the
// config contract auditable and the rest of the code env-free and pure.

export const DEFAULT_VISION_MODEL = "gemini-2.5-flash";
export const DEFAULT_TEXT_MODEL = "deepseek-v4-flash";
export const DEFAULT_PROVIDER_MAX_ATTEMPTS = 3;
export const MIN_PROVIDER_MAX_ATTEMPTS = 1;
export const MAX_PROVIDER_MAX_ATTEMPTS = 3;
export const INVALID_PROVIDER_ATTEMPT_POLICY_CATEGORY =
  "protected_rehearsal_attempt_policy_invalid" as const;

export type ProviderMaxAttempts = 1 | 2 | 3;
export type ProviderAttemptPolicy =
  | { valid: true; strict: boolean; maxAttempts: ProviderMaxAttempts }
  | {
      valid: false;
      strict: true;
      failureCategory: typeof INVALID_PROVIDER_ATTEMPT_POLICY_CATEGORY;
    };

export interface MoneyGuardConfig {
  visionModel: string;
  textModel: string;
  /** When true, enable safe diagnostics without payloads, secrets, or environment values. */
  debug: boolean;
  /** When true, force the deterministic offline mock providers. */
  mock: boolean;
  /** Server-derived provider-attempt policy. Request data must never alter it. */
  providerAttemptPolicy: ProviderAttemptPolicy;
  /** Absolute path to the local finance ledger. */
  financePath: string;
}

const truthy = (v: string | undefined): boolean => v === "true" || v === "1";

export function resolveProviderMaxAttempts(value: unknown): ProviderMaxAttempts {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_PROVIDER_MAX_ATTEMPTS &&
    parsed <= MAX_PROVIDER_MAX_ATTEMPTS
  ) {
    return parsed as ProviderMaxAttempts;
  }
  return DEFAULT_PROVIDER_MAX_ATTEMPTS;
}

export function resolveProviderAttemptPolicy(
  env: NodeJS.ProcessEnv,
): ProviderAttemptPolicy {
  const strictValue = env.MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT;
  const normalizedStrict = strictValue?.trim().toLowerCase();
  const strict = normalizedStrict === "true" || normalizedStrict === "1";
  const nonStrict =
    strictValue === undefined ||
    normalizedStrict === "" ||
    normalizedStrict === "false" ||
    normalizedStrict === "0";

  if (!strict && !nonStrict) {
    return {
      valid: false,
      strict: true,
      failureCategory: INVALID_PROVIDER_ATTEMPT_POLICY_CATEGORY,
    };
  }

  if (strict) {
    if (env.MONEYGUARD_PROVIDER_MAX_ATTEMPTS !== "1") {
      return {
        valid: false,
        strict: true,
        failureCategory: INVALID_PROVIDER_ATTEMPT_POLICY_CATEGORY,
      };
    }
    return { valid: true, strict: true, maxAttempts: 1 };
  }

  return {
    valid: true,
    strict: false,
    maxAttempts: resolveProviderMaxAttempts(
      env.MONEYGUARD_PROVIDER_MAX_ATTEMPTS,
    ),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MoneyGuardConfig {
  return {
    visionModel: env.MONEY_GUARD_VISION_MODEL ?? DEFAULT_VISION_MODEL,
    textModel: env.MONEY_GUARD_TEXT_MODEL ?? DEFAULT_TEXT_MODEL,
    debug: truthy(env.MONEY_GUARD_DEBUG),
    mock: truthy(env.MONEYGUARD_MOCK),
    providerAttemptPolicy: resolveProviderAttemptPolicy(env),
    // The ledger lives wherever the process is launched from, by convention.
    financePath: path.resolve(process.cwd(), "finance.json"),
  };
}
