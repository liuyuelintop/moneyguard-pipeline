// Provider seams. The pipeline depends only on these two interfaces, never on a
// concrete SDK. Gemini, DeepSeek, and the offline mock all implement them, which
// is what makes the pipeline transport- and vendor-agnostic and trivially testable.

/** Vision / OCR stage: image in, untrusted JSON out (Zod-validated downstream). */
export interface VisionProvider {
  /**
   * Run OCR on an image. Returns the model's raw parsed JSON (`unknown` — the
   * caller validates with Zod) or `null` when nothing parseable came back.
   * Transient API errors (429/5xx) MUST propagate so the caller's retry can act.
   */
  vision(imageBuffer: Buffer, prompt: string, model?: string): Promise<unknown>;
}

/** Audit / copywriting stage: streams the human-readable report token by token. */
export interface AuditProvider {
  /** Stream the audit text. Throwing BEFORE the first chunk is a retryable connect failure. */
  streamAudit(userPrompt: string, systemPrompt: string): AsyncGenerator<string>;
}

export interface MoneyGuardProviders {
  vision: VisionProvider;
  audit: AuditProvider;
}
