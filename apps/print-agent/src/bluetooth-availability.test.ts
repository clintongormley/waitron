import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostLog } from "@waitron/print-agent";
import { createLinuxDevices } from "./linux-devices.js";

// What bluetoothctl 5.82 (the print-agent image) printed on a GitHub Ubuntu 24.04 runner on
// 2026-09-29, as the `node` user, with the system bus socket mounted. Under Docker's
// `docker-default` profile the bus refuses `Hello`; libdbus writes this to stderr and aborts (exit
// 134). Under Waitron's profile with no BlueZ on the bus, it waits until its `--timeout` and exits 1.
const BUS_REFUSED_STDERR = `dbus[9]: arguments to dbus_connection_get_object_path_data() were incorrect, assertion "connection != NULL" failed in file ../../dbus/dbus-connection.c line 5974.
This is normally a bug in some application using the D-Bus library.

  D-Bus not built with -rdynamic so unable to print a backtrace
`;

const FAKE_BLUETOOTHCTL = `#!/bin/sh
printf '%s\\n' "$*" >> "$WT_BT_LOG"
case "$WT_BT_MODE" in
  refused) printf '%s' "$WT_BT_STDERR" >&2; kill -ABRT $$ ;;
  silent) echo "Unable to open mgmt_socket" >&2; exit 1 ;;
  nocontroller) echo "No default controller available"; exit 0 ;;
  ok) echo "Unable to open mgmt_socket" >&2; echo "Device 66:55:44:33:22:11 CI Printer"; exit 0 ;;
esac
exit 3
`;

let dir: string;
let sysfs: string;
let savedPath: string | undefined;
let lines: { level: string; msg: string; fields?: Record<string, unknown> }[];
let clock: number;

const log: HostLog = {
  info: (msg, fields) => lines.push({ level: "info", msg, fields }),
  warn: (msg, fields) => lines.push({ level: "warn", msg, fields }),
  error: (msg, fields) => lines.push({ level: "error", msg, fields }),
};

async function usbFixture(root: string): Promise<void> {
  const bus = "1-lp0";
  const deviceDir = join(root, "devices", "usb1", bus);
  await mkdir(join(deviceDir, `${bus}:1.0`, "usbmisc", "lp0"), { recursive: true });
  await writeFile(join(deviceDir, "serial"), "B120300001\n");
  await writeFile(join(deviceDir, "manufacturer"), "YICHIP3121\n");
  await writeFile(join(deviceDir, "product"), "USB Portable Printer\n");
  await mkdir(join(root, "class", "usbmisc"), { recursive: true });
  await symlink(
    join("..", "..", "devices", "usb1", bus, `${bus}:1.0`, "usbmisc", "lp0"),
    join(root, "class", "usbmisc", "lp0"),
  );
}

const USB = {
  transport: "usb",
  localKey: "B120300001",
  make: "YICHIP3121",
  model: "USB Portable Printer",
};

function mode(value: "refused" | "silent" | "nocontroller" | "ok"): void {
  process.env.WT_BT_MODE = value;
}

async function calls(): Promise<string[]> {
  try {
    return (await readFile(join(dir, "calls.log"), "utf8")).trimEnd().split("\n");
  } catch {
    return [];
  }
}

function devices() {
  return createLinuxDevices({
    sysfsRoot: sysfs,
    devRoot: "/dev",
    btDevicePath: () => "/dev/rfcomm0",
    log,
    now: () => clock,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "print-agent-bt-"));
  sysfs = join(dir, "sys");
  await usbFixture(sysfs);
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "bluetoothctl"), FAKE_BLUETOOTHCTL);
  await chmod(join(bin, "bluetoothctl"), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
  process.env.WT_BT_LOG = join(dir, "calls.log");
  process.env.WT_BT_STDERR = BUS_REFUSED_STDERR;
  lines = [];
  clock = 1_000_000;
});

afterEach(async () => {
  process.env.PATH = savedPath;
  delete process.env.WT_BT_MODE;
  delete process.env.WT_BT_LOG;
  delete process.env.WT_BT_STDERR;
  await rm(dir, { recursive: true, force: true });
});

describe("the Bluetooth side's availability", () => {
  it("reports a refused system bus once, not once per poll, and keeps the USB inventory", async () => {
    mode("refused");
    const d = devices();
    for (let poll = 0; poll < 3; poll += 1) {
      expect(await d.visibleDevices()).toEqual([USB]);
      clock += 30_000;
    }
    expect(await calls()).toHaveLength(3);
    expect(lines).toEqual([
      {
        level: "warn",
        msg: "bluetooth unavailable",
        fields: {
          reason: "dbus_unreachable",
          detail: expect.stringContaining("connection != NULL"),
        },
      },
    ]);
    expect(d.bluetoothAvailability()).toEqual({
      available: false,
      reason: "dbus_unreachable",
      detail: expect.stringContaining("connection != NULL"),
    });
  });

  it("asks BlueZ with a bounded wait on the live path", async () => {
    mode("ok");
    await devices().visibleDevices();
    expect(await calls()).toEqual(["--timeout 3 devices Paired"]);
  });

  it("tells a BlueZ that never answers apart from a refused bus", async () => {
    mode("silent");
    const d = devices();
    await d.visibleDevices();
    expect(d.bluetoothAvailability()).toMatchObject({
      available: false,
      reason: "bluez_not_answering",
    });
  });

  it("tells a BlueZ with no controller apart from a refused bus", async () => {
    mode("nocontroller");
    const d = devices();
    expect(await d.visibleDevices()).toEqual([USB]);
    expect(d.bluetoothAvailability()).toEqual({
      available: false,
      reason: "no_controller",
      detail: "No default controller available",
    });
  });

  it("reports any other failure with its message", async () => {
    process.env.PATH = join(dir, "empty");
    const d = devices();
    expect(await d.visibleDevices()).toEqual([USB]);
    expect(d.bluetoothAvailability()).toMatchObject({ available: false, reason: "failed" });
    expect(lines).toHaveLength(1);
  });

  it("reports nothing before the first check", () => {
    expect(devices().bluetoothAvailability()).toBeUndefined();
  });

  it("asks an unavailable BlueZ again only after 30 seconds, and reports its recovery once", async () => {
    mode("silent");
    const d = devices();
    await d.visibleDevices();
    clock += 29_999;
    await d.visibleDevices();
    expect(await calls()).toHaveLength(1);

    mode("ok");
    clock += 1;
    expect(await d.visibleDevices()).toEqual([
      USB,
      { transport: "bluetooth", localKey: "66:55:44:33:22:11", model: "CI Printer" },
    ]);
    await d.visibleDevices();
    expect(await calls()).toHaveLength(3);
    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      ["warn", "bluetooth unavailable"],
      ["info", "bluetooth available"],
    ]);
    expect(d.bluetoothAvailability()).toEqual({ available: true });
  });

  it("reports a change of reason as a new line", async () => {
    mode("silent");
    const d = devices();
    await d.visibleDevices();
    mode("nocontroller");
    clock += 30_000;
    await d.visibleDevices();
    expect(lines.map((l) => l.fields?.reason)).toEqual(["bluez_not_answering", "no_controller"]);
  });
});
