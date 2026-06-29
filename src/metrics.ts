import type { CostTag, Finance, LineItem, Metrics, Tier } from "./schemas.js";

export const WEEKS_PER_MONTH = 12 / 52;

export const toWeekly = (item: LineItem): number =>
  item.cadence === "monthly" ? item.amount * WEEKS_PER_MONTH : item.amount;

export const weeklyTotal = (items: LineItem[]): number =>
  items.reduce((sum, item) => sum + toWeekly(item), 0);

export const weeklySumByTag = (items: LineItem[], tag: CostTag): number =>
  items.filter((item) => item.tags.includes(tag)).reduce((sum, item) => sum + toWeekly(item), 0);

// Pure, deterministic finance math: no I/O, no env, no model calls.
export function computeMetrics(finance: Finance, totalHours: number): Metrics {
  const weeklyGross = totalHours * finance.hourlyRate;
  const weeklyBurn = weeklyTotal(finance.lineItems);
  const essentialBurn = weeklySumByTag(finance.lineItems, "essential");
  const strategicBurn = weeklySumByTag(finance.lineItems, "strategic_weapon");
  const discretionaryBurn = weeklySumByTag(finance.lineItems, "discretionary");
  const netSurplus = weeklyGross - weeklyBurn;
  const tier: Tier =
    netSurplus > 500
      ? "THRIVING"
      : netSurplus > 200
        ? "STABLE"
        : netSurplus > 0
          ? "TIGHT"
          : "CRITICAL_CRISIS";
  return {
    weeklyGross,
    weeklyBurn,
    essentialBurn,
    strategicBurn,
    discretionaryBurn,
    netSurplus,
    tier,
    hoursFor150: (150 / finance.hourlyRate).toFixed(1),
  };
}
