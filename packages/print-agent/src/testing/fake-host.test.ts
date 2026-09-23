import { describe, expect, it } from "vitest";
import type { WireJob } from "../client.js";
import { FakeSink } from "../transport.js";
import { fakeHost } from "./fake-host.js";

// Pins the fake's defaults and the behaviour other suites (apps/server's print-agent e2e among
// them) rely on without restating them.
describe("fakeHost", () => {
  it("starts unconfigured and without a token when given no overrides", async () => {
    const host = fakeHost();
    expect(await host.config()).toBeNull();
    expect(await host.token()).toBeNull();
    expect(host.markPagePrinters).toBeUndefined();
    expect(host.transport).toBeInstanceOf(FakeSink);
  });

  it("keeps an explicit null config and a given config as passed", async () => {
    expect(await fakeHost({ config: null }).config()).toBeNull();
    const config = { serverUrl: "http://a.test", name: "kitchen-pi" };
    expect(await fakeHost({ config }).config()).toEqual(config);
  });

  it("the default fetch rejects with ECONNREFUSED, so nothing is reachable", async () => {
    await expect(fakeHost().fetch("http://a.test/api/node")).rejects.toThrow("ECONNREFUSED");
  });

  it("the default device seam is an empty box and pairing is refused", async () => {
    const host = fakeHost();
    expect(await host.visibleDevices()).toEqual([]);
    expect(await host.scan()).toEqual([]);
    expect(await host.probeNetwork([{ host: "10.0.0.1", port: 9100, expiresInMs: 1000 }])).toEqual(
      [],
    );
    expect(await host.pair("AA:BB:CC:DD:EE:FF")).toEqual({
      ok: false,
      error: "not implemented in fake host",
    });
  });

  it("the default resolve maps a job's connection facts straight to a target", async () => {
    const job: WireJob = {
      id: "j1",
      printerId: "p1",
      transport: "usb",
      host: null,
      port: null,
      localKey: "/dev/usb/lp0",
      payload: new Uint8Array([1]),
    };
    expect(await fakeHost().resolve(job)).toEqual({
      id: "p1",
      transport: "usb",
      host: null,
      port: null,
      devicePath: "/dev/usb/lp0",
    });
  });

  it("saves config and token, advances the clock on every read, and records sleeps and statuses", async () => {
    const host = fakeHost();
    const config = { serverUrl: "http://a.test", name: "bar" };
    await host.saveConfig(config);
    await host.saveToken("a1.s");
    expect(await host.config()).toEqual(config);
    expect(await host.token()).toBe("a1.s");
    const first = host.now();
    expect(host.now()).toBeGreaterThan(first);
    await host.sleep(25);
    expect(host.sleeps).toEqual([25]);
    host.status({ phase: "running", serverUrl: "http://a.test", current: null });
    expect(host.statuses).toEqual([
      { phase: "running", serverUrl: "http://a.test", current: null },
    ]);
  });

  it("captures a log line with its level, and appends the fields as JSON only when given", () => {
    const host = fakeHost();
    host.log.info("phase");
    host.log.warn("scan failed", { error: "boom" });
    host.log.error("tick failed", { error: "bug" });
    expect(host.logs).toEqual([
      "info phase",
      'warn scan failed {"error":"boom"}',
      'error tick failed {"error":"bug"}',
    ]);
  });
});
