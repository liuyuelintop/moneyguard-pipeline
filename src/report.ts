import type { Metrics, OcrResult } from "./schemas.js";

// Deterministic Markdown report. The LLM generates only `auditText`; the code
// owns the report skeleton so the structure can never be hijacked by the model.
export function buildReport(ocr: OcrResult, metrics: Metrics, auditText: string): string {
  return `📊 **Wage Audit (${ocr.period})**
---
🕒 **Labor:** ${ocr.totalHours} hrs
💰 **Gross:** $${metrics.weeklyGross.toFixed(2)} AUD
📉 **Burn:** $${metrics.weeklyBurn.toFixed(2)} AUD
💎 **Surplus:** $${metrics.netSurplus.toFixed(2)} AUD | ${metrics.tier}

---
🧠 **Audit:**
${auditText}`;
}
