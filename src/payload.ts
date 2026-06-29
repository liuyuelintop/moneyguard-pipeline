import type { FinanceContext, Metrics, OcrResult } from "./schemas.js";

// Dynamic context engine: only tag-aggregated sums and derived tone directives
// leave the machine. Raw per-item amounts, names, and the hourly rate are never
// emitted. Structured sections keep the model payload high-signal and ordered.
export function buildAuditPayload(
  metrics: Metrics,
  ocr: OcrResult,
  context: FinanceContext,
): string {
  const observation = [
    "[OBSERVATION]",
    `Hours worked this period: ${ocr.totalHours}`,
    `Pay period: ${ocr.period}`,
  ];

  const financialState = [
    "[FINANCIAL_STATE]",
    `Weekly gross income: $${metrics.weeklyGross.toFixed(2)} AUD`,
    `Weekly mandatory burn: $${metrics.weeklyBurn.toFixed(2)} AUD`,
    `  - Essential: $${metrics.essentialBurn.toFixed(2)} AUD`,
    `  - Strategic investment: $${metrics.strategicBurn.toFixed(2)} AUD`,
    `  - Discretionary: $${metrics.discretionaryBurn.toFixed(2)} AUD`,
    `Net weekly surplus: $${metrics.netSurplus.toFixed(2)} AUD`,
    `Financial health tier: ${metrics.tier}`,
    `Hours of labor to fund a $150 night out: ${metrics.hoursFor150} hrs`,
  ];

  const directives: string[] = [];
  if (context.marketCondition === "hostile_to_intl_grads") {
    directives.push(
      "DIRECTIVE: The job market is tough for people breaking into tech without a network. Validate persistence; never imply they should 'just land a tech job faster.'",
    );
  }
  if (context.financialIndependence) {
    directives.push(
      "DIRECTIVE: They are self-funding with no financial safety net — every dollar is self-earned. Respect that weight; never suggest leaning on others.",
    );
  }
  directives.push(
    `DIRECTIVE: Mentee works 40+ hrs as a ${context.currentRole} to self-fund. Frame strategic_weapon learning/AI spend as the bridge INTO tech — not waste.`,
  );
  if (metrics.tier === "CRITICAL_CRISIS") {
    directives.push(
      "DIRECTIVE: Surplus is negative. Give calm, concrete, warm triage — practical, never alarmist or scolding.",
    );
  }

  const task = [
    "[TASK]",
    "Audit this week's numbers and respond per your persona and the directives above.",
  ];

  return [
    ...observation,
    "",
    ...financialState,
    "",
    "[CONTEXT_FLAGS]",
    ...directives,
    "",
    ...task,
  ].join("\n");
}
