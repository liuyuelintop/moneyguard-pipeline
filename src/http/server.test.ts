import { EventEmitter } from "events";
import type http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listenExtractServer, resolveExtractListenOptions } from "./server-core.js";

class FakeServer extends EventEmitter {
  public listen = vi.fn((port: number, host: string) => {
    queueMicrotask(() => this.emit("listening"));
    return this;
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("./server-core.js");
  vi.doUnmock("../http/server-core.js");
});

describe("extract HTTP server", () => {
  it("uses Render-safe bind defaults and PORT override", () => {
    expect(resolveExtractListenOptions({}, {})).toEqual({ host: "0.0.0.0", port: 10_000 });
    expect(resolveExtractListenOptions({}, { PORT: "4567" })).toEqual({ host: "0.0.0.0", port: 4567 });
    expect(resolveExtractListenOptions({ host: "127.0.0.1", port: 9876 }, { PORT: "4567" })).toEqual({
      host: "127.0.0.1",
      port: 9876,
    });
  });

  it("passes the configured host and port to the Node listener", async () => {
    const server = new FakeServer();

    await listenExtractServer(server as unknown as http.Server, { host: "127.0.0.1", port: 9876 });
    expect(server.listen).toHaveBeenCalledWith(9876, "127.0.0.1");
  });

  it("starts the executable Render entry point at module execution", async () => {
    const fakeServer = new EventEmitter();
    const startExtractServerMock = vi.fn().mockResolvedValue(fakeServer);
    vi.doMock("./server-core.js", () => ({
      createExtractServer: vi.fn(),
      listenExtractServer: vi.fn(),
      resolveExtractListenOptions: vi.fn(),
      startExtractServer: startExtractServerMock,
    }));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await import("./server.js");
    await vi.waitFor(() => expect(startExtractServerMock).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();
  });

  it("does not start a listener from the public library entry point", async () => {
    const startExtractServerMock = vi.fn();
    vi.doMock("../http/server-core.js", () => ({
      createExtractServer: vi.fn(),
      listenExtractServer: vi.fn(),
      resolveExtractListenOptions: vi.fn(),
      startExtractServer: startExtractServerMock,
    }));

    await import("../index.js");
    expect(startExtractServerMock).not.toHaveBeenCalled();
  });
});
