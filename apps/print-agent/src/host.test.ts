import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentStatus } from "@waitron/print-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvConfig } from "./config.js";
import { createContainerHost } from "./host.js";
import { FileState } from "./state.js";

let dir: string;
const baseEnv: EnvConfig = {
  serverUrl: undefined,
  name: undefined,
  stateDir: "/unused",
  setupPort: 9110,
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "print-agent-host-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createContainerHost — config()", () => {
  it("reports the machine hostname", () => {
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: () => {},
    });
    expect(host.hostname?.()).toBe(hostname());
  });

  it("returns the file config verbatim when env pins no server url", async () => {
    const state = new FileState(dir);
    await state.writeConfig({
      serverUrl: "https://saved",
      name: "saved",
      environment: "production",
    });
    const host = createContainerHost({ env: baseEnv, state, onStatus: () => {} });
    expect(await host.config()).toEqual({
      serverUrl: "https://saved",
      name: "saved",
      environment: "production",
    });
  });

  it("returns null when env pins nothing and no config was saved", async () => {
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: () => {},
    });
    expect(await host.config()).toBeNull();
  });

  it("lets env win over the file for the url, keeping the saved name and environment", async () => {
    const state = new FileState(dir);
    await state.writeConfig({ serverUrl: "https://old", name: "saved", environment: "production" });
    const host = createContainerHost({
      env: { ...baseEnv, serverUrl: "https://env" },
      state,
      onStatus: () => {},
    });
    expect(await host.config()).toEqual({
      serverUrl: "https://env",
      name: "saved",
      environment: "production",
    });
  });

  it("prefers the env name over the saved name, and falls back to a default when neither exists", async () => {
    const withEnvName = createContainerHost({
      env: { ...baseEnv, serverUrl: "https://env", name: "envname" },
      state: new FileState(dir),
      onStatus: () => {},
    });
    expect((await withEnvName.config())?.name).toBe("envname");

    const noName = createContainerHost({
      env: { ...baseEnv, serverUrl: "https://env" },
      state: new FileState(dir),
      onStatus: () => {},
    });
    expect(await noName.config()).toEqual({
      serverUrl: "https://env",
      name: "print-agent",
      environment: undefined,
    });
  });
});

describe("createContainerHost — the rest of the seam", () => {
  it("saveConfig and the token round-trip through the state directory", async () => {
    const state = new FileState(dir);
    const host = createContainerHost({ env: baseEnv, state, onStatus: () => {} });
    await host.saveConfig({ serverUrl: "https://a", name: "n" });
    expect(await new FileState(dir).readConfig()).toEqual({ serverUrl: "https://a", name: "n" });

    expect(await host.token()).toBeNull();
    await host.saveToken("a1.secret");
    expect(await new FileState(dir).readToken()).toBe("a1.secret");
    await host.saveToken(null);
    expect(await host.token()).toBeNull();
  });

  it("forwards the status callback and defaults fetch to the global", () => {
    const seen: AgentStatus[] = [];
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: (s) => seen.push(s),
    });
    const status: AgentStatus = { phase: "running", serverUrl: "https://a", current: "https://a" };
    host.status(status);
    expect(seen).toEqual([status]);
    expect(host.fetch).toBe(fetch);
  });

  it("uses an injected fetch when given one", () => {
    const injected: typeof fetch = async () => new Response();
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      fetch: injected,
      onStatus: () => {},
    });
    expect(host.fetch).toBe(injected);
  });

  it("now() is a millisecond clock and sleep() resolves after the delay", async () => {
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: () => {},
    });
    const before = Date.now();
    expect(host.now()).toBeGreaterThanOrEqual(before);
    vi.useFakeTimers();
    try {
      let done = false;
      const slept = host.sleep(1000).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(1000);
      await slept;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a network_tcp job through the real TCP adapter (rejects a host-less target)", async () => {
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: () => {},
    });
    await expect(
      host.transport.send(
        { id: "p1", transport: "network_tcp", host: null, port: null, devicePath: null },
        new Uint8Array([1]),
      ),
    ).rejects.toThrow(/no host/);
  });

  it("exposes the injected device seam as its visibleDevices/scan/pair/resolve", async () => {
    const devices = {
      visibleDevices: vi.fn(async () => [
        { transport: "usb" as const, localKey: "SN-1", make: "Epson", model: "TM-T20" },
      ]),
      scan: vi.fn(async () => [
        { transport: "bluetooth" as const, localKey: "AA:BB:CC:DD:EE:FF", name: "Star" },
      ]),
      pair: vi.fn(async () => ({ ok: true, localKey: "AA:BB:CC:DD:EE:FF" })),
      resolve: vi.fn(async () => ({
        id: "p1",
        transport: "usb" as const,
        host: null,
        port: null,
        devicePath: "/dev/usb/lp0",
      })),
    };
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      onStatus: () => {},
      devices,
    });
    expect(await host.visibleDevices()).toEqual([
      { transport: "usb", localKey: "SN-1", make: "Epson", model: "TM-T20" },
    ]);
    expect(await host.scan(["bluetooth"])).toEqual([
      { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF", name: "Star" },
    ]);
    expect(devices.scan).toHaveBeenCalledWith(["bluetooth"]);
    expect(await host.pair("AA:BB:CC:DD:EE:FF")).toEqual({
      ok: true,
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    const job = {
      id: "j1",
      printerId: "p1",
      transport: "usb" as const,
      host: null,
      port: null,
      localKey: "SN-1",
      payload: new Uint8Array(),
    };
    expect(await host.resolve(job)).toEqual({
      id: "p1",
      transport: "usb",
      host: null,
      port: null,
      devicePath: "/dev/usb/lp0",
    });
    expect(devices.resolve).toHaveBeenCalledWith(job);
  });

  it("logs one structured JSON line per call, carrying the level, message and fields", () => {
    const lines: string[] = [];
    const sink = {
      info: (line: string) => lines.push(line),
      warn: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    };
    const host = createContainerHost({
      env: baseEnv,
      state: new FileState(dir),
      log: sink,
      onStatus: () => {},
    });
    host.log.info("phase", { phase: "running" });
    host.log.warn("report dropped", { job: "j1" });
    host.log.error("tick failed", { error: "boom" });
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", msg: "phase", phase: "running" });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      level: "warn",
      msg: "report dropped",
      job: "j1",
    });
    expect(JSON.parse(lines[2]!)).toMatchObject({
      level: "error",
      msg: "tick failed",
      error: "boom",
    });
  });
});
