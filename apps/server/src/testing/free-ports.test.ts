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

/**
 * A draw under a stubbed pool id binds real ports in that id's slice, so the ids used here (11 to 16,
 * and 37, which wraps to 12) must belong to no live worker: apps/server's `maxWorkers`
 * is 4, and Vitest numbers workers from 1 to `maxWorkers`. The check below sees only this worker's
 * own id.
 */
async function freshModule(poolId: string): Promise<typeof import("./free-ports.js")> {
  expect(Number(process.env.VITEST_POOL_ID ?? 0)).toBeLessThan(11);
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
    ["11", 25500],
    ["12", 26000],
    ["37", 26000],
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
    const { freePorts: draw } = await freshModule("13");
    const start = 26500;
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

  it("never returns one port twice in a call, refusing a call that asks for more than its slice holds", async () => {
    const { freePorts: draw } = await freshModule("16");

    await expect(draw(501)).rejects.toThrow(/28000.*28499/);
  });

  it("a bind error other than the port being in use rejects the draw with that error", async () => {
    const { freePorts: draw } = await freshModule("14");
    const bindError = Object.assign(new Error("bind refused"), { code: "EACCES" });
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      process.nextTick(() => this.emit("error", bindError));
      return this;
    });

    await expect(draw(1)).rejects.toBe(bindError);
  });

  it("a slice with every port in use rejects with an error naming its bounds", async () => {
    const { freePorts: draw } = await freshModule("15");
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      process.nextTick(() =>
        this.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" })),
      );
      return this;
    });

    await expect(draw(1)).rejects.toThrow(/27500.*27999/);
  });

  it.each(["", "not-a-number"])(
    "with VITEST_POOL_ID %j, draws from the slice the process id picks",
    async (poolId) => {
      const { freePorts: draw } = await freshModule(poolId);
      const start = 20000 + (process.pid % 25) * 500;
      vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
        process.nextTick(() =>
          this.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" })),
        );
        return this;
      });

      await expect(draw(1)).rejects.toThrow(`from ${start} to ${start + 499}`);
    },
  );

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
