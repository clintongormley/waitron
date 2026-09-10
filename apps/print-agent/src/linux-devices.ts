import { spawn } from "node:child_process";
import dgram from "node:dgram";
import type {
  DiscoveredDevice,
  Host,
  PairResult,
  PrinterTarget,
  VisibleDevice,
  WireJob,
} from "@waitron/print-agent";
import { type BluetoothHost, createBluetoothctlHost } from "./bluetooth.js";
import { PDL_SERVICE, parsePdlResponse } from "./network.js";
import { type UsbPrinter, readUsbPrinters } from "./usb.js";

/**
 * The Linux implementation of the {@link Host} device seam (design §7) — USB from sysfs, network over
 * mDNS, Bluetooth over BlueZ — composed from the transport-specific parsers. Every parser is pure and
 * tested; only the live I/O (spawning `bluetoothctl`, opening the mDNS multicast socket, binding an
 * RFCOMM node) sits behind an injectable seam, so this composition is exercised end to end with fakes
 * and the untested surface is the thin process/socket wiring alone.
 */
export interface LinuxDeviceOptions {
  /** sysfs root — `/sys` in production; a fixture tmpdir in tests. */
  sysfsRoot?: string;
  /** device-node root — `/dev` in production; defaults to `<sysfsRoot>/dev` for a single-root fixture. */
  devRoot?: string;
  /** Bluetooth seam; defaults to a live `bluetoothctl` host. */
  bluetooth?: BluetoothHost;
  /** Maps a paired MAC to its RFCOMM write node; defaults to the live (deferred) binding. */
  btDevicePath?: (mac: string) => string;
  /** Active network discovery; defaults to a live mDNS `_pdl-datastream._tcp` probe. */
  scanNetwork?: () => Promise<DiscoveredDevice[]>;
}

/** A device with a stable local handle AND its current OS write node — the internal shape `resolve`
 * needs. `visibleDevices()` returns the same devices with `devicePath` dropped. */
type LocalDevice = VisibleDevice & { devicePath: string };

export type LinuxDevices = Pick<Host, "visibleDevices" | "scan" | "pair" | "resolve">;

export function createLinuxDevices(opts: LinuxDeviceOptions = {}): LinuxDevices {
  const sysfsRoot = opts.sysfsRoot ?? "/sys";
  const devRoot = opts.devRoot ?? `${sysfsRoot}/dev`;
  const bluetooth = opts.bluetooth ?? createBluetoothctlHost({ run: runBluetoothctl });
  const btDevicePath = opts.btDevicePath ?? liveBtDevicePath;
  const scanNetwork = opts.scanNetwork ?? liveMdnsScan;

  const usb = (): Promise<UsbPrinter[]> => readUsbPrinters(sysfsRoot, devRoot);

  const pairedLocal = async (): Promise<LocalDevice[]> => {
    const paired = await bluetooth.paired();
    return paired.map((d) => ({
      transport: "bluetooth",
      localKey: d.mac,
      ...(d.name !== undefined ? { model: d.name } : {}),
      devicePath: btDevicePath(d.mac),
    }));
  };

  const dropPath = (d: LocalDevice): VisibleDevice => ({
    transport: d.transport,
    localKey: d.localKey,
    ...(d.make !== undefined ? { make: d.make } : {}),
    ...(d.model !== undefined ? { model: d.model } : {}),
  });

  return {
    async visibleDevices(): Promise<VisibleDevice[]> {
      const usbDevices = (await usb()).map(dropPath);
      // A Bluetooth adapter can be absent or wedged; its failure must never suppress the USB inventory
      // the pull carries, so BT is best-effort here (an explicit scan/pair still surfaces the error).
      let btDevices: VisibleDevice[];
      try {
        btDevices = (await pairedLocal()).map(dropPath);
      } catch {
        btDevices = [];
      }
      return [...usbDevices, ...btDevices];
    },

    async scan(kinds?): Promise<DiscoveredDevice[]> {
      const wanted = new Set(kinds ?? (["usb", "network_tcp", "bluetooth"] as const));
      const found: DiscoveredDevice[] = [];
      if (wanted.has("usb")) {
        for (const u of await usb()) {
          found.push({
            transport: "usb",
            localKey: u.localKey,
            ...(u.make !== undefined ? { make: u.make } : {}),
            ...(u.model !== undefined ? { model: u.model } : {}),
          });
        }
      }
      if (wanted.has("network_tcp")) found.push(...(await scanNetwork()));
      if (wanted.has("bluetooth")) found.push(...(await bluetooth.scan()));
      return found;
    },

    pair(mac): Promise<PairResult> {
      return bluetooth.pair(mac);
    },

    async resolve(job: WireJob): Promise<PrinterTarget> {
      if (job.transport === "network_tcp") {
        return {
          id: job.printerId,
          transport: job.transport,
          host: job.host,
          port: job.port,
          devicePath: null,
        };
      }
      // usb / bluetooth: the localKey is resolved to the box's CURRENT node via the internal list that
      // retains devicePath (never the public visibleDevices(), which drops it). Only the matching
      // transport's list is consulted, so a USB job never has to reach the Bluetooth radio.
      const local: LocalDevice[] =
        job.transport === "bluetooth" ? await pairedLocal() : await usb();
      const match = local.find((d) => d.localKey === job.localKey);
      if (match === undefined) {
        // The loop marks the job failed rather than sending nowhere.
        throw new Error(`device ${job.localKey} not attached`);
      }
      return {
        id: job.printerId,
        transport: job.transport,
        host: null,
        port: null,
        devicePath: match.devicePath,
      };
    },
  };
}

/** A minimal mDNS query for the PDL service PTR — header (one question) then the QNAME labels, PTR/IN.
 * A pure deterministic encoder with real branching (the label loop), so it is unit-tested by exact
 * bytes and lives OUTSIDE the gated block; only the socket that sends it (`liveMdnsScan`) is gated. */
export function buildPdlQuery(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // one question
  const labels = PDL_SERVICE.split(".");
  const parts: Buffer[] = [];
  for (const label of labels) {
    const b = Buffer.from(label, "ascii");
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0])); // root
  const qtypeClass = Buffer.from([0, 12, 0, 1]); // PTR, IN
  return Buffer.concat([header, ...parts, qtypeClass]);
}

// --- Live I/O seams: real process/socket work (no branching logic), exercised only at the receipt. ---

/* v8 ignore start -- spawns bluetoothctl; covered by the receipt, not unit tests (no radio in CI). */
function runBluetoothctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bluetoothctl", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (out += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(out));
  });
}

/** The RFCOMM write node for a paired MAC. The box's Bluetooth adapter was unconfirmed at the
 * 2026-09-10 capture, so this binding is settled at the manual receipt (spec §7). SINGLE PAIRED PRINTER
 * ONLY until then: every MAC maps to the same `/dev/rfcomm0`, so two paired BT printers would collide —
 * the Step 6c receipt replaces this with a per-MAC bound node. */
function liveBtDevicePath(mac: string): string {
  void mac; // named for the contract; the concrete per-MAC rfcomm index is settled at the receipt.
  return "/dev/rfcomm0";
}

/** One mDNS `_pdl-datastream._tcp` query, collecting responses for a short window and decoding each
 * with the tested {@link parsePdlResponse}. Runs only under host networking + an open discovery window. */
function liveMdnsScan(windowMs = 1500): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const byHost = new Map<string, DiscoveredDevice>();
    const done = (): void => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...byHost.values()]);
    };
    socket.on("message", (msg) => {
      for (const d of parsePdlResponse(msg)) byHost.set(`${d.host}:${d.port}`, d);
    });
    socket.on("error", done);
    socket.bind(() => {
      socket.send(buildPdlQuery(), 5353, "224.0.0.251");
      setTimeout(done, windowMs);
    });
  });
}
/* v8 ignore stop */
