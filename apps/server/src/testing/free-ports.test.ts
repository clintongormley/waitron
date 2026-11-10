import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, Server, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freePort, freePorts } from "./free-ports.js";

function listenOn(port: number): Promise<Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function bindAndRelease(port: number): Promise<void> {
  const server = await listenOn(port);
  expect((server.address() as AddressInfo).port).toBe(port);
  await close(server);
}

function automaticRangeFirstPort(): number {
  const text =
    process.platform === "linux"
      ? readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8")
      : execFileSync("sysctl", ["-n", "net.inet.ip.portrange.first"], { encoding: "utf8" });
  const first = Number(text.trim().split(/\s+/)[0]);
  expect(Number.isInteger(first)).toBe(true);
  return first;
}

async function freshModule(poolId: string): Promise<typeof import("./free-ports.js")> {
  vi.stubEnv("VITEST_POOL_ID", poolId);
  vi.resetModules();
  return import("./free-ports.js");
}

describe("freePorts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("draws every port below the system's automatic range, where no port-0 bind can land", async () => {
    const first = automaticRangeFirstPort();

    const ports = await freePorts(8);

    for (const port of ports) expect(port).toBeLessThan(first);
  });

  it.each([
    ["1", 20500],
    ["2", 21000],
    ["27", 21000],
  ])(
    "with VITEST_POOL_ID %s, draws only inside the slice starting at %i",
    async (poolId, start) => {
      const { freePorts: draw } = await freshModule(poolId);

      const ports = [...(await draw(6)), ...(await draw(6))];

      for (const port of ports) {
        expect(port).toBeGreaterThanOrEqual(start);
        expect(port).toBeLessThan(start + 500);
      }
    },
  );

  it("skips a port another listener already holds", async () => {
    const { freePorts: draw } = await freshModule("3");
    const start = 21500;
    const [p] = (await draw(1)) as [number];
    const next = (offset: number) => start + ((p - start + offset) % 500);
    const held = [await listenOn(next(1)), await listenOn(next(2))];
    try {
      const [q] = (await draw(1)) as [number];

      expect(q).not.toBe(next(1));
      expect(q).not.toBe(next(2));
      await bindAndRelease(q);
    } finally {
      await Promise.all(held.map(close));
    }
  });

  it("returns distinct ports within one call and across calls, each free to bind once returned", async () => {
    const ports = [...(await freePorts(4)), ...(await freePorts(4))];

    expect(new Set(ports).size).toBe(8);
    for (const port of ports) await bindAndRelease(port);
  });

  it("a bind error other than the port being in use rejects the draw with that error", async () => {
    const { freePorts: draw } = await freshModule("4");
    const bindError = Object.assign(new Error("bind refused"), { code: "EACCES" });
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      process.nextTick(() => this.emit("error", bindError));
      return this;
    });

    await expect(draw(1)).rejects.toBe(bindError);
  });

  it("a slice with every port in use rejects with an error naming its bounds", async () => {
    const { freePorts: draw } = await freshModule("5");
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      process.nextTick(() =>
        this.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" })),
      );
      return this;
    });

    await expect(draw(1)).rejects.toThrow(/22500.*22999/);
  });

  it("a release that fails rejects the draw", async () => {
    const releaseError = new Error("release refused");
    const original = Server.prototype.close;
    vi.spyOn(Server.prototype, "close").mockImplementation(function (
      this: Server,
      callback?: (error?: Error) => void,
    ) {
      return original.call(this, () => callback?.(releaseError));
    });

    await expect(freePorts(2)).rejects.toBe(releaseError);
  });

  it("freePort returns one port free to bind", async () => {
    await bindAndRelease(await freePort());
  });
});
