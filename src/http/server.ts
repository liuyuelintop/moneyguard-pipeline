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

function formatError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export async function main(): Promise<http.Server> {
  const server = await startExtractServer();
  server.on("error", (error: Error) => {
    console.error(`[moneyGuard] extract endpoint server error: ${formatError(error)}`);
    process.exit(1);
  });
  return server;
}

main().catch((error: unknown) => {
  console.error(`[moneyGuard] extract endpoint startup failed: ${formatError(error)}`);
  process.exit(1);
});
