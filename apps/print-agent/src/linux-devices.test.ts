import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BluetoothHost } from "./bluetooth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredDevice, WireJob } from "@waitron/print-agent";
import { buildPdlQuery, createLinuxDevices } from "./linux-devices.js";

// A one-printer usblp sysfs tree (the real box's identity), so USB discovery is real in these
// composition tests while Bluetooth/network are injected fakes.
async function writeUsbFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-agent-linux-"));
  const bus = "1-lp0";
  const deviceDir = join(root, "devices", "pci0000:00", "0000:00:14.0", "usb1", bus);
  await mkdir(join(deviceDir, `${bus}:1.0`, "usbmisc", "lp0"), { recursive: true });
  await writeFile(join(deviceDir, "serial"), "B120300001\n");
  await writeFile(join(deviceDir, "manufacturer"), "YICHIP3121\n");
  await writeFile(join(deviceDir, "product"), "USB Portable Printer\n");
  const classDir = join(root, "class", "usbmisc");
  await mkdir(classDir, { recursive: true });
  await symlink(
    join(
      "..",
      "..",
      "devices",
      "pci0000:00",
      "0000:00:14.0",
      "usb1",
      bus,
      `${bus}:1.0`,
      "usbmisc",
      "lp0",
    ),
    join(classDir, "lp0"),
  );
  return root;
}

function fakeBluetooth(over: Partial<BluetoothHost> = {}): BluetoothHost {
  return {
    scan: async () => [],
    pair: async () => ({ ok: false, error: "no fake" }),
    paired: async () => [],
    forget: async () => ({ ok: false, error: "no fake" }),
    ...over,
  };
}

let root: string;
beforeEach(async () => {
  root = await writeUsbFixture();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function wireJob(over: Partial<WireJob>): WireJob {
  return {
    id: "job1",
    printerId: "p1",
    transport: "usb",
    host: null,
    port: null,
    localKey: null,
    payload: new Uint8Array(),
    ...over,
  };
}

describe("buildPdlQuery", () => {
  it("encodes the exact mDNS PTR query bytes for _pdl-datastream._tcp.local", () => {
    const q = buildPdlQuery();
    // Header: 12 bytes, one question, everything else zero.
    expect(q.readUInt16BE(4)).toBe(1); // qdcount
    expect([...q.subarray(0, 12)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    // QNAME: length-prefixed labels then a zero root.
    expect(q[12]).toBe(15);
    expect(q.toString("ascii", 13, 28)).toBe("_pdl-datastream");
    expect(q[28]).toBe(4);
    expect(q.toString("ascii", 29, 33)).toBe("_tcp");
    expect(q[33]).toBe(5);
    expect(q.toString("ascii", 34, 39)).toBe("local");
    expect(q[39]).toBe(0); // root label
    // QTYPE=PTR(12), QCLASS=IN(1), and nothing after.
    expect(q.readUInt16BE(40)).toBe(12);
    expect(q.readUInt16BE(42)).toBe(1);
    expect(q.length).toBe(44);
  });
});

describe("createLinuxDevices — visibleDevices()", () => {
  it("reports USB printers plus paired Bluetooth, without device paths", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      bluetooth: fakeBluetooth({
        paired: async () => [{ mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" }],
      }),
      btDevicePath: () => "/dev/rfcomm0",
    });
    expect(await devices.visibleDevices()).toEqual([
      {
        transport: "usb",
        localKey: "B120300001",
        make: "YICHIP3121",
        model: "USB Portable Printer",
      },
      { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF", model: "Star TSP100" },
    ]);
  });

  it("still reports USB when the Bluetooth adapter fails — BT absence must not break the pull", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      bluetooth: fakeBluetooth({
        paired: async () => {
          throw new Error("No default controller available");
        },
      }),
      btDevicePath: () => "/dev/rfcomm0",
    });
    expect(await devices.visibleDevices()).toEqual([
      {
        transport: "usb",
        localKey: "B120300001",
        make: "YICHIP3121",
        model: "USB Portable Printer",
      },
    ]);
  });
});

describe("createLinuxDevices — a paired printer with no device path", () => {
  it("leaves it out of the inventory while the radio still reads available", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      bluetooth: fakeBluetooth({ paired: async () => [{ mac: "AA:BB:CC:DD:EE:FF" }] }),
    });
    expect(await devices.visibleDevices()).toEqual([
      {
        transport: "usb",
        localKey: "B120300001",
        make: "YICHIP3121",
        model: "USB Portable Printer",
      },
    ]);
    expect(devices.bluetoothAvailability()).toEqual({ available: true });
  });
});

// `toStrictEqual`, because `toEqual` would also accept a `make: undefined` key.
describe("createLinuxDevices — devices that report no make or model", () => {
  beforeEach(async () => {
    const deviceDir = join(root, "devices", "pci0000:00", "0000:00:14.0", "usb1", "1-lp0");
    await rm(join(deviceDir, "manufacturer"));
    await rm(join(deviceDir, "product"));
  });

  it("lists a USB printer with no manufacturer or product, and a paired printer with no name, by key alone", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      // The Bluetooth entry does not fully pin `toLocal`'s no-name path: were it to set
      // `model: undefined`, `dropPath` would drop the key again and this would still pass.
      bluetooth: fakeBluetooth({ paired: async () => [{ mac: "AA:BB:CC:DD:EE:FF" }] }),
      btDevicePath: () => "/dev/rfcomm0",
    });
    expect(await devices.visibleDevices()).toStrictEqual([
      { transport: "usb", localKey: "B120300001" },
      { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" },
    ]);
  });

  it("scans a USB printer with no manufacturer or product by key alone", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth(),
      scanNetwork: async () => [],
    });
    expect(await devices.scan(["usb"])).toStrictEqual([
      { transport: "usb", localKey: "B120300001" },
    ]);
  });
});

describe("createLinuxDevices — scan()", () => {
  const netHit: DiscoveredDevice = {
    transport: "network_tcp",
    host: "192.168.1.50",
    port: 9100,
    name: "HP",
  };
  const btHit: DiscoveredDevice = {
    transport: "bluetooth",
    localKey: "AA:BB:CC:DD:EE:FF",
    name: "Star",
  };

  it("scans only the requested kind (bluetooth)", async () => {
    const scanNetwork = vi.fn(async () => [netHit]);
    const btScan = vi.fn(async () => [btHit]);
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth({ scan: btScan }),
      scanNetwork,
    });
    expect(await devices.scan(["bluetooth"])).toEqual([btHit]);
    expect(scanNetwork).not.toHaveBeenCalled();
  });

  it("scans only network_tcp when asked", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth({ scan: async () => [btHit] }),
      scanNetwork: async () => [netHit],
    });
    expect(await devices.scan(["network_tcp"])).toEqual([netHit]);
  });

  it("with no kinds given, scans USB + network + Bluetooth", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      bluetooth: fakeBluetooth({ scan: async () => [btHit] }),
      scanNetwork: async () => [netHit],
    });
    expect(await devices.scan()).toEqual([
      {
        transport: "usb",
        localKey: "B120300001",
        make: "YICHIP3121",
        model: "USB Portable Printer",
      },
      netHit,
      btHit,
    ]);
  });
});

describe("createLinuxDevices — pair()", () => {
  it("delegates to the Bluetooth host, with the operator's PIN", async () => {
    const pair = vi.fn(async () => ({ ok: true, localKey: "AA:BB:CC:DD:EE:FF" }));
    const devices = createLinuxDevices({ sysfsRoot: root, bluetooth: fakeBluetooth({ pair }) });
    expect(await devices.pair("AA:BB:CC:DD:EE:FF", "1234")).toEqual({
      ok: true,
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    expect(pair).toHaveBeenCalledWith("AA:BB:CC:DD:EE:FF", "1234");
  });
});

describe("createLinuxDevices — pairedBluetooth()", () => {
  it("lists every paired device, without asking for a device path, which would throw", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth({
        paired: async () => [
          { mac: "5A:4A:45:D4:FB:BB", name: "BlueTooth Printer" },
          { mac: "11:22:33:44:55:66" },
        ],
      }),
    });
    expect(await devices.pairedBluetooth()).toStrictEqual([
      { localKey: "5A:4A:45:D4:FB:BB", name: "BlueTooth Printer" },
      { localKey: "11:22:33:44:55:66" },
    ]);
  });

  it("throws when the listing fails, and records the Bluetooth side as unavailable", async () => {
    const warn = vi.fn();
    const devices = createLinuxDevices({
      sysfsRoot: root,
      log: { info: vi.fn(), warn, error: vi.fn() },
      bluetooth: fakeBluetooth({
        paired: async () => {
          throw new Error("No default controller available");
        },
      }),
    });
    await expect(devices.pairedBluetooth()).rejects.toThrow("No default controller available");
    expect(devices.bluetoothAvailability()).toMatchObject({
      available: false,
      reason: "no_controller",
    });
    expect(warn).toHaveBeenCalledWith("bluetooth unavailable", {
      reason: "no_controller",
      error: "No default controller available",
    });
  });

  it("throws without listing again while an unavailable side is not yet due a recheck", async () => {
    let clock = 0;
    const paired = vi.fn(async () => {
      throw new Error("No default controller available");
    });
    const devices = createLinuxDevices({
      sysfsRoot: root,
      now: () => clock,
      bluetooth: fakeBluetooth({ paired }),
    });
    await devices.checkBluetooth();
    clock += 1_000;
    await expect(devices.pairedBluetooth()).rejects.toThrow("No default controller available");
    expect(paired).toHaveBeenCalledTimes(1);
  });

  it("joins a listing already running rather than starting a second", async () => {
    let release!: (v: { mac: string }[]) => void;
    const paired = vi.fn(
      () =>
        new Promise<{ mac: string }[]>((resolve) => {
          release = resolve;
        }),
    );
    const devices = createLinuxDevices({ sysfsRoot: root, bluetooth: fakeBluetooth({ paired }) });
    const checked = devices.checkBluetooth();
    const listed = devices.pairedBluetooth();
    release([{ mac: "5A:4A:45:D4:FB:BB" }]);
    await checked;
    expect(await listed).toStrictEqual([{ localKey: "5A:4A:45:D4:FB:BB" }]);
    expect(paired).toHaveBeenCalledTimes(1);
  });

  it("shares one listing with visibleDevices() started beside it, however fast the listing ends", async () => {
    const paired = vi.fn(async () => [{ mac: "5A:4A:45:D4:FB:BB" }]);
    const devices = createLinuxDevices({
      sysfsRoot: root,
      devRoot: "/dev",
      bluetooth: fakeBluetooth({ paired }),
      btDevicePath: () => "/dev/rfcomm0",
    });
    // The agent's order: the paired listing first, then the visible read, both in one turn.
    const listed = devices.pairedBluetooth();
    const visible = await devices.visibleDevices();
    expect(await listed).toStrictEqual([{ localKey: "5A:4A:45:D4:FB:BB" }]);
    expect(visible.map((d) => d.localKey)).toStrictEqual(["B120300001", "5A:4A:45:D4:FB:BB"]);
    expect(paired).toHaveBeenCalledTimes(1);
  });
});

describe("createLinuxDevices — forgetBluetooth()", () => {
  it("hands the address to the Bluetooth host and returns its outcome", async () => {
    const forget = vi.fn(async () => ({ ok: false, error: "org.bluez.Error.NotReady" }));
    const devices = createLinuxDevices({ sysfsRoot: root, bluetooth: fakeBluetooth({ forget }) });
    expect(await devices.forgetBluetooth("5A:4A:45:D4:FB:BB")).toStrictEqual({
      ok: false,
      error: "org.bluez.Error.NotReady",
    });
    expect(forget).toHaveBeenCalledWith("5A:4A:45:D4:FB:BB");
  });
});

describe("createLinuxDevices — resolve()", () => {
  it("maps a USB job's localKey to its current device path", async () => {
    const devices = createLinuxDevices({ sysfsRoot: root, devRoot: "/dev" });
    expect(await devices.resolve(wireJob({ transport: "usb", localKey: "B120300001" }))).toEqual({
      id: "p1",
      transport: "usb",
      host: null,
      port: null,
      devicePath: "/dev/usb/lp0",
    });
  });

  it("resolves a USB job to the production /dev node when no devRoot is given (sibling, not nested under /sys)", async () => {
    // devRoot must fall back to `/dev` (a sibling of `/sys`), NOT `<sysfs>/dev`.
    const devices = createLinuxDevices({ sysfsRoot: root });
    expect(
      await devices.resolve(wireJob({ transport: "usb", localKey: "B120300001" })),
    ).toMatchObject({ devicePath: "/dev/usb/lp0" });
  });

  it("maps a paired Bluetooth job's MAC to its RFCOMM node", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth({
        paired: async () => [{ mac: "AA:BB:CC:DD:EE:FF", name: "Star" }],
      }),
      btDevicePath: (mac) => `/dev/rfcomm-${mac}`,
    });
    expect(
      await devices.resolve(wireJob({ transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" })),
    ).toEqual({
      id: "p1",
      transport: "bluetooth",
      host: null,
      port: null,
      devicePath: "/dev/rfcomm-AA:BB:CC:DD:EE:FF",
    });
  });

  it("throws for a bluetooth job when the live per-MAC binding is not implemented (default btDevicePath)", async () => {
    const devices = createLinuxDevices({
      sysfsRoot: root,
      bluetooth: fakeBluetooth({
        paired: async () => [{ mac: "AA:BB:CC:DD:EE:FF", name: "Star" }],
      }),
    });
    await expect(
      devices.resolve(wireJob({ transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" })),
    ).rejects.toThrow(/not implemented/);
  });

  it("passes a network_tcp job's host/port through, with no device path", async () => {
    const devices = createLinuxDevices({ sysfsRoot: root });
    expect(
      await devices.resolve(
        wireJob({ transport: "network_tcp", host: "192.168.1.50", port: 9100, localKey: null }),
      ),
    ).toEqual({
      id: "p1",
      transport: "network_tcp",
      host: "192.168.1.50",
      port: 9100,
      devicePath: null,
    });
  });

  it("throws 'device <key> not attached' when the local device is gone", async () => {
    const devices = createLinuxDevices({ sysfsRoot: root, devRoot: "/dev" });
    await expect(
      devices.resolve(wireJob({ transport: "usb", localKey: "SN-GONE" })),
    ).rejects.toThrow("device SN-GONE not attached");
  });
});
