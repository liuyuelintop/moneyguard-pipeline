import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type MoneyGuardConfig } from "./config.js";
import { runMoneyGuardPipeline } from "./pipeline.js";
import type { AuditProvider, MoneyGuardProviders, VisionProvider } from "./providers/types.js";

// Sentinel values chosen so they do NOT appear in any computed output string.
// hourlyRate=99.99 → weeklyGross "3999.60" (no "99.99" substring)
// rent=7777.77     → weeklyBurn ~"1897.18" (no "7777" substring)
const SENTINEL_FINANCE = {
  hourlyRate: 99.99,
  currency: "AUD",
  lineItems: [
    { name: "rent", amount: 7777.77, cadence: "monthly", tags: ["essential", "liability"] },
    { name: "sub_a", amount: 10, cadence: "monthly", tags: ["strategic_weapon", "subscription"] },
    { name: "food_max", amount: 100, cadence: "weekly", tags: ["essential", "variable"] },
  ],
  context: {
    marketCondition: "hostile_to_intl_grads",
    financialIndependence: true,
    currentRole: "Hourly Worker",
  },
};

// --- DI test doubles: no module mocking, just inject providers + config. ---

class StubVision implements VisionProvider {
  constructor(private readonly result: unknown) {}
  async vision(): Promise<unknown> {
    return this.result;
  }
}

class CapturingAudit implements AuditProvider {
  public calls: Array<{ userPrompt: string; systemPrompt: string }> = [];
  async *streamAudit(userPrompt: string, systemPrompt: string): AsyncGenerator<string> {
    this.calls.push({ userPrompt, systemPrompt });
    yield "audit chunk";
  }
}

const tmpFiles: string[] = [];
function writeFinance(obj: unknown): string {
  const file = path.join(os.tmpdir(), `mg-finance-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  tmpFiles.push(file);
  return file;
}

function makeConfig(financePath: string): MoneyGuardConfig {
  return { ...loadConfig(), financePath, mock: false, debug: false };
}

function makeProviders(visionResult: unknown): {
  providers: MoneyGuardProviders;
  audit: CapturingAudit;
} {
  const audit = new CapturingAudit();
  return { providers: { vision: new StubVision(visionResult), audit }, audit };
}

const goodOcr = { totalHours: 40, period: "2026-W21", confidence: "high" };
const noop = async () => {};

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
  vi.restoreAllMocks();
});

describe("pipeline — de-identification (privacy boundary REDLINE)", () => {
  it("never sends raw hourly rate, raw cost values, or item names to the cloud text API", async () => {
    const { providers, audit } = makeProviders(goodOcr);
    const config = makeConfig(writeFinance(SENTINEL_FINANCE));

    const result = await runMoneyGuardPipeline(Buffer.from("img"), {
      providers,
      config,
      onReportUpdate: noop,
    });

    expect(result.ok).toBe(true);
    expect(audit.calls).toHaveLength(1);
    const { userPrompt } = audit.calls[0]!;

    // Raw sentinel values and item names must be absent from the cloud payload.
    expect(userPrompt).not.toContain("99.99");
    expect(userPrompt).not.toContain("7777.77");
    expect(userPrompt).not.toContain("7777");
    expect(userPrompt).not.toContain("hourlyRate");
    expect(userPrompt).not.toContain("rent");
    expect(userPrompt).not.toContain("food_max");
    expect(userPrompt).not.toContain("sub_a");

    // Structured sections + tag breakdown must be present.
    expect(userPrompt).toContain("[OBSERVATION]");
    expect(userPrompt).toContain("[FINANCIAL_STATE]");
    expect(userPrompt).toContain("[CONTEXT_FLAGS]");
    expect(userPrompt).toContain("[TASK]");
    expect(userPrompt).toContain("Hours worked this period:");
    expect(userPrompt).toContain("Weekly gross income:");
    expect(userPrompt).toContain("Financial health tier:");
    expect(userPrompt).toContain("Essential:");
    expect(userPrompt).toContain("Strategic investment:");

    // Derived tone directives must be present.
    expect(userPrompt).toContain("DIRECTIVE:");
  });
});

describe("pipeline — streaming + final render", () => {
  it("streams a cursor frame per chunk and a clean final frame", async () => {
    const { providers } = makeProviders(goodOcr);
    const config = makeConfig(writeFinance(SENTINEL_FINANCE));
    const frames: Array<{ text: string; final: boolean }> = [];

    const result = await runMoneyGuardPipeline(Buffer.from("img"), {
      providers,
      config,
      onReportUpdate: async (text, final) => {
        frames.push({ text, final });
      },
    });

    expect(result.ok).toBe(true);
    // One streamed frame (with cursor) + one final frame (without cursor).
    expect(frames.at(-1)!.final).toBe(true);
    expect(frames.at(-1)!.text).not.toContain("▌");
    expect(frames.some((f) => !f.final && f.text.includes("▌"))).toBe(true);
    expect(frames.at(-1)!.text).toContain("Wage Audit");
  });
});

describe("pipeline — OCR failure path", () => {
  it("returns a vision error and skips the audit when OCR returns null", async () => {
    const { providers, audit } = makeProviders(null);
    const config = makeConfig(writeFinance(SENTINEL_FINANCE));

    const result = await runMoneyGuardPipeline(Buffer.from("blurry"), {
      providers,
      config,
      onReportUpdate: noop,
    });

    expect(result).toMatchObject({ ok: false, kind: "vision" });
    expect(audit.calls).toHaveLength(0);
  });

  it("returns a vision error when OCR reports zero hours", async () => {
    const { providers, audit } = makeProviders({ totalHours: 0, period: "W", confidence: "low" });
    const config = makeConfig(writeFinance(SENTINEL_FINANCE));

    const result = await runMoneyGuardPipeline(Buffer.from("blurry"), {
      providers,
      config,
      onReportUpdate: noop,
    });

    expect(result).toMatchObject({ ok: false, kind: "vision" });
    expect(audit.calls).toHaveLength(0);
  });
});

describe("pipeline — finance.json schema validation", () => {
  const badConfigs: Array<[string, unknown]> = [
    ["missing required fields", { bad: "data" }],
    ["non-positive hourlyRate", { ...SENTINEL_FINANCE, hourlyRate: -5 }],
    ["empty lineItems", { ...SENTINEL_FINANCE, lineItems: [] }],
    [
      "unknown tag",
      {
        ...SENTINEL_FINANCE,
        lineItems: [{ name: "rent", amount: 100, cadence: "monthly", tags: ["bogus_tag"] }],
      },
    ],
    [
      "invalid cadence",
      {
        ...SENTINEL_FINANCE,
        lineItems: [{ name: "rent", amount: 100, cadence: "daily", tags: ["essential"] }],
      },
    ],
  ];

  it.each(badConfigs)("returns a config error for %s and skips the audit", async (_label, bad) => {
    const { providers, audit } = makeProviders(goodOcr);
    const config = makeConfig(writeFinance(bad));

    const result = await runMoneyGuardPipeline(Buffer.from("img"), {
      providers,
      config,
      onReportUpdate: noop,
    });

    expect(result).toMatchObject({ ok: false, kind: "config" });
    expect(audit.calls).toHaveLength(0);
  });

  it("normalizes unknown marketCondition values without forwarding the raw value", async () => {
    const privateMarketMarker = "private-market-condition-marker";
    const { providers, audit } = makeProviders(goodOcr);
    const config = makeConfig(
      writeFinance({
        ...SENTINEL_FINANCE,
        context: { ...SENTINEL_FINANCE.context, marketCondition: privateMarketMarker },
      }),
    );

    const result = await runMoneyGuardPipeline(Buffer.from("img"), {
      providers,
      config,
      onReportUpdate: noop,
    });

    expect(result.ok).toBe(true);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]!.userPrompt).not.toContain(privateMarketMarker);
  });
});
