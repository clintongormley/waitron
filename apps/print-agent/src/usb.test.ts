import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUsbPrinters } from "./usb.js";

// Recreates the real box's usblp sysfs shape under a tmpdir root (captured 2026-09-10,
// task-6-hardware-facts.md): a `class/usbmisc/lpN` SYMLINK into
// `devices/.../1-11/1-11:1.0/usbmisc/lpN`, with the identity attrs on the device dir three parents up.
// Returns the root; `readUsbPrinters(root)` derives its device node under `<root>/dev/usb/lpN`.
async function writeSysfsFixture(opts: {
  lp: string;
  serial?: string;
  manufacturer?: string;
  product?: string;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "print-agent-usb-"));
  await addPrinter(root, opts);
  return root;
}

async function addPrinter(
  root: string,
  opts: { lp: string; serial?: string; manufacturer?: string; product?: string },
): Promise<void> {
  // The device dir (`1-11`) holds the identity attrs; the interface (`1-11:1.0`) holds the
  // `usbmisc/lpN` class node the enumeration symlink points at. `1-<lp>` keeps two printers distinct.
  const bus = `1-${opts.lp}`;
  const deviceDir = join(root, "devices", "pci0000:00", "0000:00:14.0", "usb1", bus);
  const usbmiscDir = join(deviceDir, `${bus}:1.0`, "usbmisc", opts.lp);
  await mkdir(usbmiscDir, { recursive: true });
  if (opts.serial !== undefined) await writeFile(join(deviceDir, "serial"), `${opts.serial}\n`);
  if (opts.manufacturer !== undefined) {
    await writeFile(join(deviceDir, "manufacturer"), `${opts.manufacturer}\n`);
  }
  if (opts.product !== undefined) await writeFile(join(deviceDir, "product"), `${opts.product}\n`);

  const classDir = join(root, "class", "usbmisc");
  await mkdir(classDir, { recursive: true });
  // A relative symlink, exactly as the kernel writes it: `../../devices/...`.
  const relTarget = join(
    "..",
    "..",
    "devices",
    "pci0000:00",
    "0000:00:14.0",
    "usb1",
    bus,
    `${bus}:1.0`,
    "usbmisc",
    opts.lp,
  );
  await symlink(relTarget, join(classDir, opts.lp));
}

let roots: string[] = [];
beforeEach(() => {
  roots = [];
});
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

describe("readUsbPrinters", () => {
  it("reads serial + device path from a sysfs fixture", async () => {
    const root = await writeSysfsFixture({
      lp: "lp0",
      serial: "SN-ABC",
      manufacturer: "Epson",
      product: "TM-T20",
    });
    roots.push(root);
    expect(await readUsbPrinters(root)).toEqual([
      {
        transport: "usb",
        localKey: "SN-ABC",
        make: "Epson",
        model: "TM-T20",
        devicePath: `${root}/dev/usb/lp0`,
      },
    ]);
  });

  it("reads the real box's printer (YICHIP3121 / B120300001) into /dev/usb/lp0", async () => {
    // The exact identity captured off clinton@waitron.local (task-6-hardware-facts.md).
    const root = await writeSysfsFixture({
      lp: "lp0",
      serial: "B120300001",
      manufacturer: "YICHIP3121",
      product: "USB Portable Printer",
    });
    roots.push(root);
    expect(await readUsbPrinters(root, "/dev")).toEqual([
      {
        transport: "usb",
        localKey: "B120300001",
        make: "YICHIP3121",
        model: "USB Portable Printer",
        devicePath: "/dev/usb/lp0",
      },
    ]);
  });

  it("skips a device with no serial — a printer with no stable identity cannot be bound", async () => {
    const root = await writeSysfsFixture({ lp: "lp0", manufacturer: "Epson", product: "TM-T20" });
    roots.push(root);
    expect(await readUsbPrinters(root)).toEqual([]);
  });

  it("enumerates two printers present at once", async () => {
    const root = await writeSysfsFixture({
      lp: "lp0",
      serial: "SN-0",
      manufacturer: "Epson",
      product: "TM-T20",
    });
    roots.push(root);
    await addPrinter(root, {
      lp: "lp1",
      serial: "SN-1",
      manufacturer: "Star",
      product: "TSP100",
    });
    const found = await readUsbPrinters(root);
    expect(found).toEqual([
      {
        transport: "usb",
        localKey: "SN-0",
        make: "Epson",
        model: "TM-T20",
        devicePath: `${root}/dev/usb/lp0`,
      },
      {
        transport: "usb",
        localKey: "SN-1",
        make: "Star",
        model: "TSP100",
        devicePath: `${root}/dev/usb/lp1`,
      },
    ]);
  });

  it("omits make/model when the device dir has no manufacturer/product", async () => {
    const root = await writeSysfsFixture({ lp: "lp0", serial: "SN-BARE" });
    roots.push(root);
    expect(await readUsbPrinters(root)).toEqual([
      { transport: "usb", localKey: "SN-BARE", devicePath: `${root}/dev/usb/lp0` },
    ]);
  });

  it("returns an empty list when the box has no usbmisc class dir (no usblp printer bound)", async () => {
    const root = await mkdtemp(join(tmpdir(), "print-agent-usb-empty-"));
    roots.push(root);
    expect(await readUsbPrinters(root)).toEqual([]);
  });

  it("skips a class entry whose symlink no longer resolves (device detached mid-walk)", async () => {
    const root = await mkdtemp(join(tmpdir(), "print-agent-usb-dangling-"));
    roots.push(root);
    const classDir = join(root, "class", "usbmisc");
    await mkdir(classDir, { recursive: true });
    await symlink(join("..", "..", "devices", "gone", "usbmisc", "lp0"), join(classDir, "lp0"));
    expect(await readUsbPrinters(root)).toEqual([]);
  });
});
