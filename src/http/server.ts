#!/usr/bin/env node
import http from "http";
import { pathToFileURL } from "url";
import { handleExtractRequest, type ExtractEndpointOptions } from "./extract.js";

export interface ExtractServerOptions extends ExtractEndpointOptions {
  port?: number;
  host?: string;
}

function toRequest(req: http.IncomingMessage): Request {
  const host = req.headers.host ?? "127.0.0.1";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`http://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? null : req,
    duplex: "half",
  });
}

async function writeResponse(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body === null) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export function createExtractServer(options: ExtractEndpointOptions = {}): http.Server {
  return http.createServer((req, res) => {
    handleExtractRequest(toRequest(req), options)
      .then((response) => writeResponse(res, response))
      .catch(() => {
        console.error("[moneyGuard] extract endpoint failed");
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error: "Internal server error." }));
      });
  });
}

export async function startExtractServer(options: ExtractServerOptions = {}): Promise<http.Server> {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const server = createExtractServer(options);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  console.error(`[moneyGuard] extract endpoint listening on http://${host}:${port}/extract`);
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  startExtractServer().catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  });
}
