import { ZodError } from "zod";

function zodPath(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "<root>";
  return issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
}

export function summarizeConfigError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return `schema_validation_failed path=${zodPath(error)} code=${issue?.code ?? "unknown"}`;
  }
  if (error instanceof SyntaxError) return "invalid_json";
  return "invalid_config";
}

export function summarizeValidationError(error: ZodError): string {
  const issue = error.issues[0];
  return `schema_validation_failed path=${zodPath(error)} code=${issue?.code ?? "unknown"}`;
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" ? status : undefined;
}

function codeFromError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

export function providerFailureCategory(error: unknown): string {
  const status = statusFromError(error);
  const code = codeFromError(error);
  const name = error instanceof Error ? error.name : undefined;

  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status === 408 || name === "AbortError" || code === "ETIMEDOUT") return "provider_timeout";
  if (status === 429) return "provider_rate_limited";
  if (status !== undefined && status >= 500) return "provider_unavailable";
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ENOTFOUND") return "provider_unavailable";
  if (error instanceof SyntaxError) return "provider_invalid_response";
  return "provider_unknown_failure";
}

export function logSafeError(category: string, detail?: string): void {
  console.error(`[moneyGuard] ${category}${detail ? `: ${detail}` : ""}`);
}

export function logSafeDiagnostic(category: string): void {
  console.warn(`[moneyGuard] ${category}`);
}
