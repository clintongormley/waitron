import { describe, expect, it, vi } from "vitest";
import { createBluetoothctlHost, parseBluetoothctlDevices, parsePairResult } from "./bluetooth.js";

// Captured `bluetoothctl` output shapes (ANSI colour codes and \r included, as the tool emits them),
// so the parsers are proven against the real text, not a cleaned-up ideal.
const DEVICES_OUTPUT =
  "[0;94m[NEW][0m Device AA:BB:CC:DD:EE:FF Star TSP100\r\n" +
  "[NEW] Device 11:22:33:44:55:66 HP Printer\r\n" +
  "[NEW] Device 99:88:77:66:55:44 99-88-77-66-55-44\r\n";

describe("parseBluetoothctlDevices", () => {
  it("extracts MAC + name from Device lines, ignoring ANSI codes and CRs", () => {
    expect(parseBluetoothctlDevices(DEVICES_OUTPUT)).toEqual([
      { mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
      { mac: "11:22:33:44:55:66", name: "HP Printer" },
      // A device whose "name" is just its MAC in dashes has no real name — reported without one.
      { mac: "99:88:77:66:55:44" },
    ]);
  });

  it("dedupes by MAC, keeping the most recent name", () => {
    const text =
      "[NEW] Device AA:BB:CC:DD:EE:FF Unknown\r\n[CHG] Device AA:BB:CC:DD:EE:FF Star TSP100\r\n";
    expect(parseBluetoothctlDevices(text)).toEqual([
      { mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
    ]);
  });

  it("returns nothing for output with no Device lines", () => {
    expect(parseBluetoothctlDevices("Agent registered\r\nDiscovery started\r\n")).toEqual([]);
  });
});

describe("parsePairResult", () => {
  it("reports success on 'Pairing successful'", () => {
    const text = "Attempting to pair with AA:BB:CC:DD:EE:FF\r\nPairing successful\r\n";
    expect(parsePairResult(text, "AA:BB:CC:DD:EE:FF")).toEqual({
      ok: true,
      localKey: "AA:BB:CC:DD:EE:FF",
    });
  });

  it("reports the failure reason on 'Failed to pair'", () => {
    const text =
      "Attempting to pair with AA:BB:CC:DD:EE:FF\r\nFailed to pair: org.bluez.Error.AuthenticationFailed\r\n";
    expect(parsePairResult(text, "AA:BB:CC:DD:EE:FF")).toEqual({
      ok: false,
      error: "org.bluez.Error.AuthenticationFailed",
    });
  });

  it("reports a generic failure when neither marker is present", () => {
    expect(
      parsePairResult("Device AA:BB:CC:DD:EE:FF not available\r\n", "AA:BB:CC:DD:EE:FF"),
    ).toEqual({ ok: false, error: "pairing did not complete" });
  });
});

describe("createBluetoothctlHost", () => {
  it("scan() runs an inquiry then lists devices, mapped to DiscoveredDevice", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(async (args) =>
      args.includes("scan") ? "Discovery started\r\n" : DEVICES_OUTPUT,
    );
    const host = createBluetoothctlHost({ run, scanSeconds: 4 });
    const found = await host.scan();
    expect(run).toHaveBeenNthCalledWith(1, ["--timeout", "4", "scan", "on"]);
    expect(run).toHaveBeenNthCalledWith(2, ["devices"]);
    expect(found).toEqual([
      { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
      { transport: "bluetooth", localKey: "11:22:33:44:55:66", name: "HP Printer" },
      { transport: "bluetooth", localKey: "99:88:77:66:55:44" },
    ]);
  });

  it("pair() bonds via bluetoothctl and decodes the result", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(async () => "Pairing successful\r\n");
    const host = createBluetoothctlHost({ run });
    expect(await host.pair("AA:BB:CC:DD:EE:FF")).toEqual({
      ok: true,
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    expect(run).toHaveBeenCalledWith(["pair", "AA:BB:CC:DD:EE:FF"]);
  });

  it("paired() lists only bonded devices", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(
      async () => "[NEW] Device AA:BB:CC:DD:EE:FF Star TSP100\r\n",
    );
    const host = createBluetoothctlHost({ run });
    expect(await host.paired()).toEqual([{ mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" }]);
    expect(run).toHaveBeenCalledWith(["devices", "Paired"]);
  });
});
