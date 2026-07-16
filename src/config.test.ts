import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_MAX_ATTEMPTS,
  loadConfig,
  MAX_PROVIDER_MAX_ATTEMPTS,
  MIN_PROVIDER_MAX_ATTEMPTS,
  resolveProviderAttemptPolicy,
  resolveProviderMaxAttempts,
} from "./config.js";

describe("provider maximum-attempt configuration", () => {
  it("preserves three total attempts by default", () => {
    expect(DEFAULT_PROVIDER_MAX_ATTEMPTS).toBe(3);
    expect(loadConfig({}).providerAttemptPolicy).toEqual({
      valid: true,
      strict: false,
      maxAttempts: 3,
    });
  });

  it("accepts only bounded integer values and safely falls back", () => {
    expect(MIN_PROVIDER_MAX_ATTEMPTS).toBe(1);
    expect(MAX_PROVIDER_MAX_ATTEMPTS).toBe(3);
    expect(resolveProviderMaxAttempts("1")).toBe(1);
    expect(resolveProviderMaxAttempts("2")).toBe(2);
    expect(resolveProviderMaxAttempts("3")).toBe(3);

    for (const value of [undefined, "", "0", "4", "1.5", "invalid"]) {
      expect(resolveProviderMaxAttempts(value)).toBe(3);
    }
  });

  it.each([undefined, "", "invalid", "1.5", "0", "-1", "2", "3", "4"])(
    "fails closed in strict mode for cap %j",
    (cap) => {
      const env: NodeJS.ProcessEnv = {
        MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
      };
      if (cap !== undefined) env.MONEYGUARD_PROVIDER_MAX_ATTEMPTS = cap;
      expect(resolveProviderAttemptPolicy(env)).toMatchObject({
        valid: false,
        strict: true,
        failureCategory: "protected_rehearsal_attempt_policy_invalid",
      });
    },
  );

  it("permits exactly one attempt only when strict mode has the canonical cap", () => {
    expect(resolveProviderAttemptPolicy({
      MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "true",
      MONEYGUARD_PROVIDER_MAX_ATTEMPTS: "1",
    })).toEqual({ valid: true, strict: true, maxAttempts: 1 });
  });

  it("fails closed for a malformed strict-mode invariant", () => {
    expect(resolveProviderAttemptPolicy({
      MONEYGUARD_REQUIRE_SINGLE_PROVIDER_ATTEMPT: "maybe",
      MONEYGUARD_PROVIDER_MAX_ATTEMPTS: "1",
    })).toMatchObject({ valid: false });
  });
});
