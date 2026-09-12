import { describe, expect, it } from "vitest";
import { createPrinterProbes } from "./printer-probes.js";

describe("printer address requests", () => {
  it("normalizes addresses, defaults the port and expires requests independently", () => {
    let now = 1000;
    const probes = createPrinterProbes(() => now);
    const first = probes.add({ host: " 192.168.20.247 " });
    expect(first).toEqual({
      host: "192.168.20.247",
      port: 9100,
      requestedAt: 1000,
      expiresAt: 31000,
    });
    now = 2000;
    expect(probes.add({ host: "2001:0db8::1", port: 9200 }).host).toBe("2001:db8::1");
    now = 31000;
    expect(probes.current()).toEqual([
      { host: "2001:db8::1", port: 9200, requestedAt: 2000, expiresAt: 32000 },
    ]);
    now = 32000;
    expect(probes.current()).toEqual([]);
  });
  it("bounds concurrent targets, allows retry of the same address, and reclaims expired slots", () => {
    let now = 0;
    const probes = createPrinterProbes(() => now);
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
