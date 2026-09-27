import { createServer, Server, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freePort, freePorts } from "./free-ports.js";

async function bindAndRelease(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  expect((server.address() as AddressInfo).port).toBe(port);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("freePorts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds every probe until the last port is drawn, so the OS cannot hand one back twice", async () => {
    const events: string[] = [];
    const address = Server.prototype.address;
    const close = Server.prototype.close;
    vi.spyOn(Server.prototype, "address").mockImplementation(function (this: Server) {
      events.push("drawn");
      return address.call(this);
    });
    vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: Server,
      callback?: (error?: Error) => void,
    ) {
      events.push("released");
      return close.call(this, callback);
    });

    await freePorts(3);

    expect(events.filter((e) => e === "drawn")).toHaveLength(3);
    expect(events.lastIndexOf("drawn")).toBeLessThan(events.indexOf("released"));
  });

  it("returns distinct ports, each free to bind once returned", async () => {
    const ports = await freePorts(4);

    expect(new Set(ports).size).toBe(4);
    for (const port of ports) await bindAndRelease(port);
  });

  it("a failed draw releases every probe already bound and rejects with the bind error, not a release error", async () => {
    const bindError = new Error("bind refused");
    const releaseError = new Error("release refused");
    const listen = Server.prototype.listen;
    const close = Server.prototype.close;
    const bound: Server[] = [];
    let released = 0;
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (
      this: Server,
      ...args: unknown[]
    ) {
      if (bound.length === 2) {
        process.nextTick(() => this.emit("error", bindError));
        return this;
      }
      bound.push(this);
      return (listen as (...a: unknown[]) => Server).apply(this, args);
    });
    vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: Server,
      callback?: (error?: Error) => void,
    ) {
      return close.call(this, () => {
        released += 1;
        callback?.(releaseError);
      });
    });

    await expect(freePorts(3)).rejects.toBe(bindError);

    expect(bound).toHaveLength(2);
    expect(released).toBe(2);
  });

  it("a release that fails after every port is drawn rejects the draw", async () => {
    const releaseError = new Error("release refused");
    const close = Server.prototype.close;
    vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: Server,
      callback?: (error?: Error) => void,
    ) {
      return close.call(this, () => callback?.(releaseError));
    });

    await expect(freePorts(2)).rejects.toBe(releaseError);
  });

  it("freePort returns one port free to bind", async () => {
    await bindAndRelease(await freePort());
  });
});
