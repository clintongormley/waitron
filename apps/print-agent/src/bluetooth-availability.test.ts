import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostLog } from "@waitron/print-agent";
import {
  type BluetoothAvailability,
  classifyBluetoothFailure,
  sameAvailability,
} from "./bluetooth-availability.js";
import { createLinuxDevices } from "./linux-devices.js";

// What bluetoothctl 5.82 (the print-agent image) printed on a GitHub Ubuntu 24.04 runner on
// 2026-09-29, as the `node` user, with the system bus socket mounted. Under Docker's
// `docker-default` profile the bus refuses `Hello`; libdbus writes this to stderr and aborts (exit
// 134). Under Waitron's profile with no BlueZ on the bus it printed only `Unable to open
// mgmt_socket` and was still running when `timeout 8` killed it (exit 124, run 36558601920); a
// Debian 13 container with its own system bus and no BlueZ did the same. With a stand-in BlueZ
// (scripts/fake-bluez.py) answering, under Waitron's profile on the same kind of runner, run
// 36562581079 timed `--timeout 3 devices Paired` at 3.064 s and `devices Paired` at 0.057 s, each
// through `docker exec`, so the fake below makes `--timeout` cost the same.
const BUS_REFUSED_STDERR = `dbus[9]: arguments to dbus_connection_get_object_path_data() were incorrect, assertion "connection != NULL" failed in file ../../dbus/dbus-connection.c line 5974.
This is normally a bug in some application using the D-Bus library.

  D-Bus not built with -rdynamic so unable to print a backtrace
`;

const FAKE_BLUETOOTHCTL = `#!/bin/sh
printf '%s\\n' "$*" >> "$WT_BT_LOG"
case "$WT_BT_MODE" in
  refused) printf '%s' "$WT_BT_STDERR" >&2; kill -ABRT $$ ;;
  silent) exec sleep 30 ;;
  nocontroller) echo "No default controller available"; exit 0 ;;
  ok)
    [ "$1" = "--timeout" ] && sleep "$2"
    echo "Unable to open mgmt_socket" >&2; echo "Device 66:55:44:33:22:11 CI Printer"; exit 0 ;;
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

/** Only the case where BlueZ never answers waits this out. Under load a fake can be killed at it
 * before it has logged its call, so no case using it counts calls. */
const SILENT_DEADLINE_MS = 300;
/** Long enough that a fake bluetoothctl slow to start under load is not killed before it answers. */
const ANSWERING_DEADLINE_MS = 10_000;

function devices(listDeadlineMs = ANSWERING_DEADLINE_MS) {
  return createLinuxDevices({
    sysfsRoot: sysfs,
    devRoot: "/dev",
    btDevicePath: () => "/dev/rfcomm0",
    bluetoothListTimeoutMs: listDeadlineMs,
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
          error: expect.stringContaining("connection != NULL"),
        },
      },
    ]);
    expect(d.bluetoothAvailability()).toEqual({
      available: false,
      reason: "dbus_unreachable",
      detail: expect.stringContaining("connection != NULL"),
    });
  });

  it("returns a healthy listing at once, without bluetoothctl's own timeout", async () => {
    mode("ok");
    const started = performance.now();
    expect(await devices().visibleDevices()).toEqual([
      USB,
      { transport: "bluetooth", localKey: "66:55:44:33:22:11", model: "CI Printer" },
    ]);
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(await calls()).toEqual(["devices Paired"]);
  });

  it("kills a BlueZ that never answers at the deadline, and tells it apart from a refused bus", async () => {
    mode("silent");
    const d = devices(SILENT_DEADLINE_MS);
    const started = performance.now();
    expect(await d.visibleDevices()).toEqual([USB]);
    expect(performance.now() - started).toBeLessThan(SILENT_DEADLINE_MS + 1_500);
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
    mode("refused");
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
    mode("refused");
    const d = devices();
    await d.visibleDevices();
    mode("nocontroller");
    clock += 30_000;
    await d.visibleDevices();
    expect(lines.map((l) => l.fields?.reason)).toEqual(["dbus_unreachable", "no_controller"]);
  });
});

describe("the Bluetooth side, checked apart from the job poll", () => {
  it("reports before anything asks for devices, and lists at most once per 30 seconds", async () => {
    mode("refused");
    const d = devices();
    await d.checkBluetooth();
    expect(d.bluetoothAvailability()).toMatchObject({ reason: "dbus_unreachable" });
    expect(lines.map((l) => l.msg)).toEqual(["bluetooth unavailable"]);
    clock += 29_999;
    await d.checkBluetooth();
    expect(await calls()).toHaveLength(1);
    clock += 1;
    await d.checkBluetooth();
    expect(await calls()).toHaveLength(2);
    expect(lines).toHaveLength(1);
  });

  it("adds no listing of its own while the job poll lists every time", async () => {
    mode("ok");
    const d = devices();
    for (let poll = 0; poll < 20; poll += 1) {
      await d.visibleDevices();
      await d.checkBluetooth();
      clock += 2_000;
    }
    expect(await calls()).toHaveLength(20);
    expect(lines.map((l) => l.msg)).toEqual(["bluetooth available"]);
  });

  it("lets the job poll skip an unavailable side the check has just asked", async () => {
    mode("nocontroller");
    const d = devices();
    await d.checkBluetooth();
    clock += 10_000;
    expect(await d.visibleDevices()).toEqual([USB]);
    expect(await calls()).toHaveLength(1);
  });

  it("shares a listing already running rather than starting a second", async () => {
    let listings = 0;
    let answer!: (devices: { mac: string; name?: string }[]) => void;
    const d = createLinuxDevices({
      sysfsRoot: sysfs,
      devRoot: "/dev",
      bluetooth: {
        scan: async () => [],
        pair: async () => ({ ok: false, error: "unused" }),
        paired: () => {
          listings += 1;
          return new Promise((resolve) => {
            answer = resolve;
          });
        },
      },
      btDevicePath: () => "/dev/rfcomm0",
      now: () => clock,
    });
    const seen = d.visibleDevices();
    await vi.waitFor(() => expect(listings).toBe(1));
    const checked = d.checkBluetooth();
    answer([{ mac: "66:55:44:33:22:11", name: "CI Printer" }]);
    const [devicesSeen] = await Promise.all([seen, checked]);
    expect(devicesSeen).toContainEqual(expect.objectContaining({ transport: "bluetooth" }));
    expect(listings).toBe(1);
  });

  it("starts a fresh listing once the last one has finished, even one that threw at once", async () => {
    let listings = 0;
    const d = createLinuxDevices({
      sysfsRoot: sysfs,
      devRoot: "/dev",
      bluetooth: {
        scan: async () => [],
        pair: async () => ({ ok: false, error: "unused" }),
        paired: () => {
          listings += 1;
          throw new Error("thrown before any promise");
        },
      },
      now: () => clock,
    });
    await d.checkBluetooth();
    clock += 30_000;
    await d.checkBluetooth();
    expect(listings).toBe(2);
    expect(d.bluetoothAvailability()).toMatchObject({ reason: "failed" });
  });
});

describe("classifyBluetoothFailure", () => {
  const failed = (message: string, extra: Record<string, unknown> = {}): Error =>
    Object.assign(new Error(message), extra);

  it("reads a refused bus from libdbus's assertion", () => {
    expect(classifyBluetoothFailure(failed(`Command failed\n${BUS_REFUSED_STDERR}`))).toEqual({
      available: false,
      reason: "dbus_unreachable",
      detail: expect.stringContaining('assertion "connection != NULL" failed'),
    });
  });

  it("reads a missing controller from bluetoothctl's own line", () => {
    expect(classifyBluetoothFailure(failed("No default controller available"))).toMatchObject({
      reason: "no_controller",
    });
  });

  it("reads a listing killed at its deadline as BlueZ not answering", () => {
    const killed = failed("Command failed: bluetoothctl devices Paired\n", {
      killed: true,
      code: null,
      signal: "SIGKILL",
    });
    expect(classifyBluetoothFailure(killed)).toMatchObject({ reason: "bluez_not_answering" });
  });

  it("reports an exit it has not measured, or a missing command, as a plain failure", () => {
    expect(classifyBluetoothFailure(failed("Command failed", { code: 1 }))).toMatchObject({
      reason: "failed",
    });
    expect(
      classifyBluetoothFailure(failed("spawn bluetoothctl ENOENT", { code: "ENOENT" })),
    ).toEqual({
      available: false,
      reason: "failed",
      detail: "spawn bluetoothctl ENOENT",
    });
  });

  it("accepts a thrown value that is not an Error", () => {
    expect(classifyBluetoothFailure("  bare text  ")).toEqual({
      available: false,
      reason: "failed",
      detail: "bare text",
    });
    expect(classifyBluetoothFailure(null)).toMatchObject({ reason: "failed", detail: "null" });
  });

  it("keeps the first 500 characters of a long message", () => {
    const detail = (classifyBluetoothFailure(failed(`  ${"x".repeat(600)}`)) as { detail: string })
      .detail;
    expect(detail).toBe("x".repeat(500));
  });
});

describe("sameAvailability", () => {
  const up: BluetoothAvailability = { available: true };
  const refused: BluetoothAvailability = {
    available: false,
    reason: "dbus_unreachable",
    detail: "one",
  };

  it("treats two available readings as the same", () => {
    expect(sameAvailability(up, { available: true })).toBe(true);
  });

  it("treats available and unavailable as different, either way round", () => {
    expect(sameAvailability(up, refused)).toBe(false);
    expect(sameAvailability(refused, up)).toBe(false);
  });

  it("compares two unavailable readings by reason, not by their text", () => {
    expect(sameAvailability(refused, { ...refused, detail: "two" })).toBe(true);
    expect(sameAvailability(refused, { ...refused, reason: "no_controller" })).toBe(false);
  });
});
