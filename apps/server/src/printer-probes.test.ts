import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrinterProbes } from "./printer-probes.js";

describe("printer address requests", () => {
  afterEach(() => vi.restoreAllMocks());
  it("normalizes addresses, defaults the port and expires requests independently", () => {
    let now = 1000;
    const probes = createPrinterProbes(
      () => now,
      () => now,
    );
    const first = probes.add({ host: " 192.168.20.247 " });
    expect(first).toEqual({
      host: "192.168.20.247",
      port: 9100,
      requestedAt: 1000,
      expiresAt: 31000,
    });
    now = 2000;
    expect(probes.current()).toEqual([{ host: "192.168.20.247", port: 9100, expiresInMs: 29000 }]);
    expect(probes.add({ host: "2001:0db8::1", port: 9200 }).host).toBe("2001:db8::1");
    now = 31000;
    expect(probes.current()).toEqual([{ host: "2001:db8::1", port: 9200, expiresInMs: 1000 }]);
    now = 32000;
    expect(probes.current()).toEqual([]);
  });
  it("bounds concurrent targets, allows retry of the same address, and reclaims expired slots", () => {
    let now = 0;
    const probes = createPrinterProbes(
      () => now,
      () => now,
    );
    for (let i = 1; i <= 8; i++) probes.add({ host: `10.0.0.${i}` });
    expect(() => probes.add({ host: "10.0.0.9" })).toThrowError(
      expect.objectContaining({ code: "printer.probe_busy" }),
    );
    now = 1000;
    probes.add({ host: "10.0.0.1" });
    expect(probes.current()).toHaveLength(8);
    now = 30000;
    probes.add({ host: "10.0.0.9" });
    expect(probes.current()).toHaveLength(2);
  });
  it("answers with wall-clock times but holds each request for 30 seconds of elapsed time on the default clocks", () => {
    const day = 86_400_000;
    let steady = 1_000;
    let wall = 400 * day;
    vi.spyOn(performance, "now").mockImplementation(() => steady);
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    const probes = createPrinterProbes();
    expect(probes.add({ host: "10.0.0.1" })).toEqual({
      host: "10.0.0.1",
      port: 9100,
      requestedAt: 400 * day,
      expiresAt: 400 * day + 30_000,
    });
    for (let i = 2; i <= 8; i++) probes.add({ host: `10.0.0.${i}` });
    for (const stepped of [0, 800 * day]) {
      wall = stepped;
      expect(probes.current()).toHaveLength(8);
      expect(probes.current()[0]).toEqual({ host: "10.0.0.1", port: 9100, expiresInMs: 30_000 });
      expect(() => probes.add({ host: "10.0.0.9" })).toThrowError(
        expect.objectContaining({ code: "printer.probe_busy" }),
      );
    }
    steady += 29_999;
    wall = 0;
    expect(probes.current()[0]).toEqual({ host: "10.0.0.1", port: 9100, expiresInMs: 1 });
    steady += 1;
    expect(probes.current()).toEqual([]);
    expect(probes.add({ host: "10.0.0.9" })).toMatchObject({ requestedAt: 0, expiresAt: 30_000 });
  });
  it("hands out whole milliseconds left, rounded up, from a fractional steady clock", () => {
    let steady = 0.25;
    const probes = createPrinterProbes(
      () => 1000,
      () => steady,
    );
    probes.add({ host: "10.0.0.1" });
    steady = 1000.5;
    expect(probes.current()).toEqual([{ host: "10.0.0.1", port: 9100, expiresInMs: 29_000 }]);
  });
  it("never hands out more than 30 seconds when a fractional steady clock reads the same twice", () => {
    // 2768.05 + 30000 - 2768.05 is 30000.000000000004 in floating point.
    const probes = createPrinterProbes(
      () => 1000,
      () => 2768.05,
    );
    probes.add({ host: "10.0.0.1" });
    expect(probes.current()).toEqual([{ host: "10.0.0.1", port: 9100, expiresInMs: 30_000 }]);
  });
  it.each([null, undefined, [], "bad"])("refuses malformed request %s", (input) => {
    expect(() => createPrinterProbes().add(input)).toThrowError(
      expect.objectContaining({ code: "management.request_invalid" }),
    );
  });
  it.each([
    undefined,
    "",
    "printer.local",
    "http://10.0.0.1",
    "10.0.0.1:9100",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "ff02::1",
    "::ffff:224.0.0.1",
    "fe80::1%en0",
  ])("refuses invalid/unusable address %s", (host) => {
    expect(() => createPrinterProbes().add({ host })).toThrowError(
      expect.objectContaining({ code: "management.request_invalid", params: { field: "host" } }),
    );
  });
  it.each([null, "9100", 0, 65536, 1.5, NaN])("refuses invalid port %s", (port) => {
    expect(() => createPrinterProbes().add({ host: "10.0.0.1", port })).toThrowError(
      expect.objectContaining({ code: "management.request_invalid", params: { field: "port" } }),
    );
  });
});
