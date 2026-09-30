import dgram from "node:dgram";
import { connectTcp } from "./tcp-probe.js";
import { networkInterfaces } from "node:os";
import type {
  BluetoothCommandResult,
  DiscoveredDevice,
  Host,
  HostLog,
  PairResult,
  PairedBluetoothDevice,
  PrinterTarget,
  VisibleDevice,
  WireJob,
} from "@waitron/print-agent";
import { type BluetoothDevice, type BluetoothHost, createBluetoothctlHost } from "./bluetooth.js";
import { runBluetoothctl } from "./bluetooth-command.js";
import {
  type BluetoothAvailability,
  classifyBluetoothFailure,
  sameAvailability,
} from "./bluetooth-availability.js";
import { PDL_SERVICE, parsePdlResponse } from "./network.js";
import { SWEEP_PORT, mergeDiscovered, sweepCandidates, sweepPort } from "./sweep.js";
import { type UsbPrinter, readUsbPrinters } from "./usb.js";

export interface LinuxDeviceOptions {
  sysfsRoot?: string;
  devRoot?: string;
  bluetooth?: BluetoothHost;
  btDevicePath?: (mac: string) => string;
  scanNetwork?: () => Promise<DiscoveredDevice[]>;
  /** Kills a paired listing BlueZ has not answered; only used with the default `bluetooth`. */
  bluetoothListTimeoutMs?: number;
  log?: HostLog;
  now?: () => number;
}

/** An unavailable Bluetooth side is asked again this often rather than on every poll, because the
 * listing runs before each job pull and a BlueZ that never answers holds it until it is killed. */
export const BLUETOOTH_RECHECK_MS = 30_000;
/** How often the process asks `checkBluetooth()`; the check itself decides whether to list. */
export const BLUETOOTH_CHECK_TICK_MS = 5_000;
const LIST_TIMEOUT_MS = 3_000;

type LocalDevice = VisibleDevice & { devicePath: string };

export type LinuxDevices = Pick<
  Host,
  "visibleDevices" | "scan" | "pair" | "pairedBluetooth" | "forgetBluetooth" | "resolve"
> &
  Required<Pick<Host, "bluetoothPrinting">>;

export interface BluetoothStatusSource {
  /** Undefined until the first check. */
  bluetoothAvailability(): BluetoothAvailability | undefined;
  /** Lists paired devices only when no listing has started in the last `BLUETOOTH_RECHECK_MS`, so
   * running it on a timer beside the job poll adds no listing while the poll is listing. */
  checkBluetooth(): Promise<void>;
}

export function createLinuxDevices(
  opts: LinuxDeviceOptions = {},
): LinuxDevices & BluetoothStatusSource {
  const sysfsRoot = opts.sysfsRoot ?? "/sys";
  // `/dev` is a SIBLING of `/sys`: deriving it from sysfsRoot would open `/sys/dev/usb/lp0`.
  const devRoot = opts.devRoot ?? "/dev";
  const bluetooth =
    opts.bluetooth ??
    createBluetoothctlHost({
      run: runBluetoothctl,
      listTimeoutMs: opts.bluetoothListTimeoutMs ?? LIST_TIMEOUT_MS,
      ...(opts.log !== undefined ? { log: opts.log } : {}),
    });
  const btDevicePath = opts.btDevicePath ?? liveBtDevicePath;
  const scanNetwork = opts.scanNetwork ?? liveNetworkScan;
  const now = opts.now ?? Date.now;
  let availability: BluetoothAvailability | undefined;
  let listedAt = -Infinity;
  let listing: Promise<BluetoothDevice[]> | undefined;

  const record = (next: BluetoothAvailability): void => {
    const changed = availability === undefined || !sameAvailability(availability, next);
    availability = next;
    if (!changed) return;
    if (next.available) opts.log?.info("bluetooth available");
    else opts.log?.warn("bluetooth unavailable", { reason: next.reason, error: next.detail });
  };

  const listPaired = async (): Promise<BluetoothDevice[]> => {
    listedAt = now();
    try {
      const paired = await bluetooth.paired();
      record({ available: true });
      return paired;
    } catch (error) {
      record(classifyBluetoothFailure(error));
      throw error;
    }
  };
  // One listing at a time: the timer's check and the job poll share one already running.
  const sharedListing = (): Promise<BluetoothDevice[]> => {
    listing ??= listPaired().finally(() => {
      listing = undefined;
    });
    return listing;
  };
  const recheckDue = (): boolean => now() - listedAt >= BLUETOOTH_RECHECK_MS;

  const usb = (): Promise<UsbPrinter[]> => readUsbPrinters(sysfsRoot, devRoot);

  const toLocal = (paired: BluetoothDevice[]): LocalDevice[] =>
    paired.map((d) => ({
      transport: "bluetooth",
      localKey: d.mac,
      ...(d.name !== undefined ? { model: d.name } : {}),
      devicePath: btDevicePath(d.mac),
    }));
  const pairedLocal = async (): Promise<LocalDevice[]> => toLocal(await bluetooth.paired());

  const dropPath = (d: LocalDevice): VisibleDevice => ({
    transport: d.transport,
    localKey: d.localKey,
    ...(d.make !== undefined ? { make: d.make } : {}),
    ...(d.model !== undefined ? { model: d.model } : {}),
  });

  return {
    bluetoothAvailability: () => availability,

    async checkBluetooth(): Promise<void> {
      if (listing !== undefined || recheckDue()) await sharedListing().catch(() => []);
    },

    async visibleDevices(): Promise<VisibleDevice[]> {
      // Joined before the USB read, so a listing `pairedBluetooth()` just started is shared rather
      // than finishing during the read and being run again. A Bluetooth failure must never
      // suppress the USB inventory.
      const listing =
        availability?.available === false && !recheckDue()
          ? Promise.resolve([])
          : sharedListing().catch(() => []);
      const usbDevices = (await usb()).map(dropPath);
      const paired = await listing;
      // While `liveBtDevicePath` throws, this catch drops EVERY paired Bluetooth device in production.
      let btDevices: VisibleDevice[];
      try {
        btDevices = toLocal(paired).map(dropPath);
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

    pair(mac, pin): Promise<PairResult> {
      return bluetooth.pair(mac, pin);
    },

    async pairedBluetooth(): Promise<PairedBluetoothDevice[]> {
      const known = availability;
      if (known?.available === false && !recheckDue()) throw new Error(known.detail);
      return (await sharedListing()).map((d) => ({
        localKey: d.mac,
        ...(d.name !== undefined ? { name: d.name } : {}),
      }));
    },

    forgetBluetooth(mac): Promise<BluetoothCommandResult> {
      return bluetooth.forget(mac);
    },

    // Only a device path someone supplies can print: `liveBtDevicePath` is not built.
    bluetoothPrinting: () => opts.btDevicePath !== undefined,

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
      // Only the matching transport's list is consulted, so a USB job never reaches the radio.
      const local: LocalDevice[] =
        job.transport === "bluetooth" ? await pairedLocal() : await usb();
      const match = local.find((d) => d.localKey === job.localKey);
      if (match === undefined) {
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

/** A minimal mDNS PTR/IN query for the PDL service. */
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

/* v8 ignore start -- opens the mDNS and port-9100 sockets; covered by the
   receipts, not unit tests (no radio or LAN in CI). */

/** There is no per-MAC RFCOMM node yet, and a shared `/dev/rfcomm0` would route two paired printers
 * to the same node, so this throws; `visibleDevices` then leaves the device out, and no Bluetooth job
 * is handed to this agent. */
function liveBtDevicePath(mac: string): string {
  throw new Error(`bluetooth device ${mac} resolution not implemented (Step 6c receipt)`);
}

/** An announced entry, which carries the printer's own name, wins over a swept duplicate. */
async function liveNetworkScan(): Promise<DiscoveredDevice[]> {
  const [announced, swept] = await Promise.all([liveMdnsScan(), liveSweep()]);
  return mergeDiscovered(announced, swept);
}

function liveSweep(): Promise<DiscoveredDevice[]> {
  const hosts = sweepCandidates({ interfaces: networkInterfaces });
  return sweepPort({ hosts, port: SWEEP_PORT, connect: connectTcp });
}

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
