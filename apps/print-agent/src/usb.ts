import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VisibleDevice } from "@waitron/print-agent";

/**
 * A USB printer the box can already reach, with the OS device node retained so {@link Host.resolve} can
 * map a job's `localKey` to a device path. The public `visibleDevices()` drops `devicePath`.
 */
export type UsbPrinter = VisibleDevice & { transport: "usb"; devicePath: string };

/**
 * Enumerates the box's printer-class USB devices from sysfs (the usblp driver, verified on the real box
 * 2026-09-10 — task-6-hardware-facts.md). Each `<sysfsRoot>/class/usbmisc/lpN` is a symlink into the
 * device tree; resolving it and walking THREE parents up reaches the USB device dir
 * (`usbmisc/lpN` → `usbmisc` → `1-11:1.0` interface → `1-11` device), which carries `serial`,
 * `manufacturer` and `product`. The write node is `<devRoot>/usb/lpN`.
 *
 * `devRoot` is passed explicitly in production (`/dev`); it defaults to `<sysfsRoot>/dev` so a hermetic
 * fixture that writes both trees under one tmpdir needs a single root. A device with no `serial` is
 * SKIPPED: its serial is the printer's stable identity across replug (the `local_key` the server binds
 * to), so a serial-less device cannot be bound and reporting it would let it masquerade as another.
 */
export async function readUsbPrinters(
  sysfsRoot: string,
  devRoot: string = join(sysfsRoot, "dev"),
): Promise<UsbPrinter[]> {
  const classDir = join(sysfsRoot, "class", "usbmisc");
  let entries: string[];
  try {
    entries = await readdir(classDir);
  } catch {
    // No usbmisc class directory — no usblp printer is bound on this box.
    return [];
  }
  const printers: UsbPrinter[] = [];
  for (const name of entries.sort()) {
    if (!name.startsWith("lp")) continue;
    let deviceDir: string;
    try {
      const target = await realpath(join(classDir, name));
      deviceDir = dirname(dirname(dirname(target)));
    } catch {
      // A class entry whose symlink no longer resolves (device detached mid-walk) — skip it.
      continue;
    }
    const serial = await readAttr(deviceDir, "serial");
    if (serial === undefined) continue;
    const make = await readAttr(deviceDir, "manufacturer");
    const model = await readAttr(deviceDir, "product");
    printers.push({
      transport: "usb",
      localKey: serial,
      ...(make !== undefined ? { make } : {}),
      ...(model !== undefined ? { model } : {}),
      devicePath: join(devRoot, "usb", name),
    });
  }
  return printers;
}

/** Reads one sysfs attribute file, trimming the trailing newline the kernel writes. `undefined` when
 * the attribute is absent or empty (an empty value is no value — CLAUDE.md §3). */
async function readAttr(deviceDir: string, attr: string): Promise<string | undefined> {
  try {
    const trimmed = (await readFile(join(deviceDir, attr), "utf8")).trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}
