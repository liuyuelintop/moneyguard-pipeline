import { describe, expect, it } from "vitest";
import { computeMetrics, toWeekly, weeklySumByTag, WEEKS_PER_MONTH } from "./metrics.js";
import type { Finance, LineItem } from "./schemas.js";

const items: LineItem[] = [
  { name: "rent", amount: 1300, cadence: "monthly", tags: ["essential", "liability"] },
  { name: "claude", amount: 34, cadence: "monthly", tags: ["strategic_weapon", "subscription"] },
  { name: "fun", amount: 26, cadence: "monthly", tags: ["discretionary"] },
  { name: "food", amount: 100, cadence: "weekly", tags: ["essential", "variable"] },
];

const finance: Finance = {
  hourlyRate: 25,
  currency: "AUD",
  lineItems: items as Finance["lineItems"],
  context: { marketCondition: "neutral", financialIndependence: false, currentRole: "tester" },
};

describe("metrics — cadence normalization", () => {
  it("converts monthly to weekly via WEEKS_PER_MONTH and passes weekly through", () => {
    expect(
      toWeekly({ name: "m", amount: 52, cadence: "monthly", tags: ["essential"] }),
    ).toBeCloseTo(52 * WEEKS_PER_MONTH);
    expect(toWeekly({ name: "w", amount: 80, cadence: "weekly", tags: ["essential"] })).toBe(80);
  });
});

describe("metrics — tag subtotals", () => {
  it("sums only items carrying the tag, normalized to weekly", () => {
    expect(weeklySumByTag(items, "strategic_weapon")).toBeCloseTo(34 * WEEKS_PER_MONTH);
    expect(weeklySumByTag(items, "discretionary")).toBeCloseTo(26 * WEEKS_PER_MONTH);
    // essential = rent (monthly) + food (weekly)
    expect(weeklySumByTag(items, "essential")).toBeCloseTo(1300 * WEEKS_PER_MONTH + 100);
  });
});

describe("metrics — computeMetrics", () => {
  // weeklyBurn = 1300*12/52 + 34*12/52 + 26*12/52 + 100 = 400 hourly-independent
  const weeklyBurn = 1300 * WEEKS_PER_MONTH + 34 * WEEKS_PER_MONTH + 26 * WEEKS_PER_MONTH + 100;

  it("computes gross, burn, surplus and hours-for-$150", () => {
    const m = computeMetrics(finance, 40);
    expect(m.weeklyGross).toBe(1000);
    expect(m.weeklyBurn).toBeCloseTo(weeklyBurn);
    expect(m.netSurplus).toBeCloseTo(1000 - weeklyBurn);
    expect(m.hoursFor150).toBe("6.0"); // 150 / 25
  });

  it("classifies tiers across the boundaries", () => {
    expect(computeMetrics(finance, 40).tier).toBe("THRIVING"); // surplus ~586 > 500
    expect(computeMetrics(finance, 25).tier).toBe("STABLE"); // gross 625, surplus ~211 (>200)
    expect(computeMetrics(finance, 20).tier).toBe("TIGHT"); // gross 500, surplus ~86 (>0)
    expect(computeMetrics(finance, 16).tier).toBe("CRITICAL_CRISIS"); // gross 400, surplus <0
  });
});
