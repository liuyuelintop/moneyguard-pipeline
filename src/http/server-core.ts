import http from "http";
import { handleExtractRequest, type ExtractEndpointOptions } from "./extract.js";

export interface ExtractServerOptions extends ExtractEndpointOptions {
  port?: number;
  host?: string;
}

export interface ExtractListenOptions {
  port: number;
  host: string;
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

function requestUrl(req: http.IncomingMessage): URL {
  const host = req.headers.host ?? "127.0.0.1";
  return new URL(req.url ?? "/", `http://${host}`);
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

function parsePort(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  return port;
}

export function resolveExtractListenOptions(
  options: ExtractServerOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ExtractListenOptions {
  return {
    port: parsePort(options.port) ?? parsePort(env.PORT) ?? 10_000,
    host: options.host ?? "0.0.0.0",
  };
}

export function createExtractServer(options: ExtractEndpointOptions = {}): http.Server {
  return http.createServer((req, res) => {
    const url = requestUrl(req);
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/healthz") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok: true }));
      return;
    }

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

export async function listenExtractServer(server: http.Server, listenOptions: ExtractListenOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenOptions.port, listenOptions.host);
  });
}

export async function startExtractServer(options: ExtractServerOptions = {}): Promise<http.Server> {
  const listenOptions = resolveExtractListenOptions(options);
  const { port: _port, host: _host, ...endpointOptions } = options;
  const server = createExtractServer(endpointOptions);

  await listenExtractServer(server, listenOptions);

  console.error(
    `[moneyGuard] extract endpoint listening on http://${listenOptions.host}:${listenOptions.port}/extract`,
  );
  return server;
}
