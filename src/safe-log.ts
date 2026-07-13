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

export function logSafeError(category: string, detail?: string): void {
  console.error(`[moneyGuard] ${category}${detail ? `: ${detail}` : ""}`);
}
