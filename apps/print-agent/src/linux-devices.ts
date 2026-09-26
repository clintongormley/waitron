import dgram from "node:dgram";
import { connectTcp } from "./tcp-probe.js";
import { networkInterfaces } from "node:os";
import type {
  DiscoveredDevice,
  Host,
  PairResult,
  PrinterTarget,
  VisibleDevice,
  WireJob,
} from "@waitron/print-agent";
import { type BluetoothHost, createBluetoothctlHost } from "./bluetooth.js";
import { runBluetoothctl } from "./bluetooth-command.js";
import { PDL_SERVICE, parsePdlResponse } from "./network.js";
import { SWEEP_PORT, mergeDiscovered, sweepCandidates, sweepPort } from "./sweep.js";
import { type UsbPrinter, readUsbPrinters } from "./usb.js";

export interface LinuxDeviceOptions {
  sysfsRoot?: string;
  devRoot?: string;
  bluetooth?: BluetoothHost;
  btDevicePath?: (mac: string) => string;
  scanNetwork?: () => Promise<DiscoveredDevice[]>;
}

type LocalDevice = VisibleDevice & { devicePath: string };

export type LinuxDevices = Pick<Host, "visibleDevices" | "scan" | "pair" | "resolve">;

export function createLinuxDevices(opts: LinuxDeviceOptions = {}): LinuxDevices {
  const sysfsRoot = opts.sysfsRoot ?? "/sys";
  // `/dev` is a SIBLING of `/sys`: deriving it from sysfsRoot would open `/sys/dev/usb/lp0`.
  const devRoot = opts.devRoot ?? "/dev";
  const bluetooth = opts.bluetooth ?? createBluetoothctlHost({ run: runBluetoothctl });
  const btDevicePath = opts.btDevicePath ?? liveBtDevicePath;
  const scanNetwork = opts.scanNetwork ?? liveNetworkScan;

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
      // A Bluetooth failure must never suppress the USB inventory. While `liveBtDevicePath` throws,
      // this catch drops EVERY paired Bluetooth device in production.
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
 * to the same node, so resolving a Bluetooth job FAILS LOUD. */
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
