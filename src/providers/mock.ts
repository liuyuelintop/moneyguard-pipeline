import type { AuditProvider, VisionProvider } from "./types.js";

// Deterministic, offline providers. No network, no keys. Used by `--mock` (so a
// reviewer can run the full pipeline in seconds) and by the test suite (so behavior
// is reproducible). The audit streams in several chunks with a small delay so the
// transport's 1000ms throttle path is genuinely exercised, not bypassed.

export interface MockOptions {
  /** OCR result the mock vision returns. */
  ocr?: { totalHours: number; period: string; confidence: "high" | "low" };
  /** Per-chunk delay in ms for the audit stream (default 120ms; 0 in tests). */
  chunkDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const DEFAULT_AUDIT_CHUNKS = [
  "先停下来给自己一个肯定——",
  "一周四十多个小时的体力活扛下来，",
  "还能自费把学习和 AI 工具一个个续上，",
  "这份狠劲本身就值钱。\n\n",
  "本周的盈余还算稳：那笔 strategic_weapon 的投入，",
  "本质上是你通向技术行业的“买路钱”，不是浪费。\n\n",
  "下一步很具体：把每天多出来的 1–2 小时，",
  "全部砸进一个能上线的小项目——",
  "让作品集替你说话，比刷一百道题都管用。",
];

export class MockVisionProvider implements VisionProvider {
  constructor(private readonly opts: MockOptions = {}) {}

  async vision(): Promise<unknown> {
    return (
      this.opts.ocr ?? {
        totalHours: 38,
        period: "2026-W26",
        confidence: "high",
      }
    );
  }
}

export class MockAuditProvider implements AuditProvider {
  constructor(private readonly opts: MockOptions = {}) {}

  async *streamAudit(): AsyncGenerator<string> {
    const delay = this.opts.chunkDelayMs ?? 120;
    for (const chunk of DEFAULT_AUDIT_CHUNKS) {
      if (delay > 0) await sleep(delay);
      yield chunk;
    }
  }
}
