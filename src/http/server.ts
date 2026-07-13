#!/usr/bin/env node
import type http from "http";
import { startExtractServer } from "./server-core.js";

export {
  createExtractServer,
  listenExtractServer,
  resolveExtractListenOptions,
  startExtractServer,
  type ExtractListenOptions,
  type ExtractServerOptions,
} from "./server-core.js";

function formatFatalDiagnostic(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (error instanceof Error) return error.name;
  }
  return "unknown_failure";
}

export async function main(): Promise<http.Server> {
  const server = await startExtractServer();
  server.on("error", (error: Error) => {
    console.error(`[moneyGuard] extract endpoint server error: ${formatFatalDiagnostic(error)}`);
    process.exit(1);
  });
  return server;
}

main().catch((error: unknown) => {
  console.error(`[moneyGuard] extract endpoint startup failed: ${formatFatalDiagnostic(error)}`);
  process.exit(1);
});
