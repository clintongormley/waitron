import { describe, expect, it, vi } from "vitest";
import { runBluetoothctl } from "./bluetooth-command.js";
import { createLinuxDevices } from "./linux-devices.js";

// A file of its own, because the module mock below replaces bluetoothctl for every case in it.
vi.mock(import("./bluetooth-command.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  runBluetoothctl: vi.fn(async () => "Device 66:55:44:33:22:11 CI Printer\n"),
}));

describe("the default device source's paired listing", () => {
  it("kills bluetoothctl after three seconds when no deadline is given", async () => {
    const d = createLinuxDevices({ now: () => 1_000_000 });
    await d.checkBluetooth();
    expect(vi.mocked(runBluetoothctl).mock.calls).toEqual([
      [["devices", "Paired"], { timeoutMs: 3_000 }],
    ]);
    expect(d.bluetoothAvailability()).toEqual({ available: true });
  });
});
