import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VisibleDevice } from "@waitron/print-agent";

export type UsbPrinter = VisibleDevice & { transport: "usb"; devicePath: string };

/**
 * Walking THREE parents up from `<sysfsRoot>/class/usbmisc/lpN`'s target reaches the USB device dir
 * (`usbmisc/lpN` → `usbmisc` → `1-11:1.0` interface → `1-11` device), which carries `serial`.
 *
 * A device with no `serial` is SKIPPED: the serial is the printer's identity across replug, so a
 * serial-less device cannot be bound and reporting it would let it masquerade as another.
 *
 * `devRoot` defaults to `<sysfsRoot>/dev` only so a test fixture needs one root; production must
 * pass `/dev`.
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
      // Detached mid-walk.
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

/** An empty attribute is `undefined`, the same as an absent one (CLAUDE.md §3). */
async function readAttr(deviceDir: string, attr: string): Promise<string | undefined> {
  try {
    const trimmed = (await readFile(join(deviceDir, attr), "utf8")).trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}
