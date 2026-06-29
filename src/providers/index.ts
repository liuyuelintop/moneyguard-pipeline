import { loadConfig, type MoneyGuardConfig } from "../config.js";
import { DeepSeekAuditProvider } from "./deepseek.js";
import { GeminiVisionProvider } from "./gemini.js";
import { MockAuditProvider, MockVisionProvider, type MockOptions } from "./mock.js";
import type { MoneyGuardProviders } from "./types.js";

export type { AuditProvider, VisionProvider, MoneyGuardProviders } from "./types.js";
export { GeminiVisionProvider } from "./gemini.js";
export { DeepSeekAuditProvider } from "./deepseek.js";
export { MockAuditProvider, MockVisionProvider, type MockOptions } from "./mock.js";

/** Deterministic offline pair (no keys, no network). */
export function mockProviders(opts: MockOptions = {}): MoneyGuardProviders {
  return { vision: new MockVisionProvider(opts), audit: new MockAuditProvider(opts) };
}

/** Live Gemini + DeepSeek pair. */
export function liveProviders(): MoneyGuardProviders {
  return { vision: new GeminiVisionProvider(), audit: new DeepSeekAuditProvider() };
}

/**
 * Resolve the provider pair from configuration. `MONEYGUARD_MOCK` (or `--mock`,
 * which sets it) selects the offline mock; otherwise the live Gemini/DeepSeek pair.
 */
export function selectProviders(config: MoneyGuardConfig = loadConfig()): MoneyGuardProviders {
  return config.mock ? mockProviders() : liveProviders();
}
