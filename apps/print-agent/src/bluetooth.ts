import type { DiscoveredDevice, PairResult } from "@waitron/print-agent";

/**
 * The decoders are tested against fixtures synthesised in `bluetoothctl`'s documented output shape,
 * not captured from a real adapter.
 */

export interface BluetoothDevice {
  mac: string;
  name?: string;
}

export interface BluetoothHost {
  scan(): Promise<DiscoveredDevice[]>;
  pair(mac: string): Promise<PairResult>;
  paired(): Promise<BluetoothDevice[]>;
}

const DEVICE_LINE = /Device\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:\s+(.*))?$/;
// eslint-disable-next-line no-control-regex -- bluetoothctl colours its output; strip CSI SGR codes.
const ANSI = /\[[0-9;]*m/g;

/** Assumed, not confirmed against real tool output: with no name known, bluetoothctl prints the MAC
 * in dashes. */
function isMacPlaceholder(name: string, mac: string): boolean {
  return name.replaceAll("-", ":").toUpperCase() === mac.toUpperCase();
}

/** Last name per MAC wins. */
export function parseBluetoothctlDevices(text: string): BluetoothDevice[] {
  const byMac = new Map<string, BluetoothDevice>();
  const order: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(ANSI, "").replace(/\r$/, "").trim();
    const match = DEVICE_LINE.exec(line);
    if (match === null) continue;
    const mac = match[1]!.toUpperCase();
    const rawName = match[2]?.trim();
    const name =
      rawName === undefined || rawName === "" || isMacPlaceholder(rawName, mac)
        ? undefined
        : rawName;
    if (!byMac.has(mac)) order.push(mac);
    byMac.set(mac, name !== undefined ? { mac, name } : { mac });
  }
  return order.map((mac) => byMac.get(mac)!);
}

export function parsePairResult(text: string, mac: string): PairResult {
  const clean = text.replace(ANSI, "");
  if (/Pairing successful/.test(clean)) return { ok: true, localKey: mac.toUpperCase() };
  const failed = /Failed to pair:\s*(.+)/.exec(clean);
  if (failed !== null) return { ok: false, error: failed[1]!.trim() };
  return { ok: false, error: "pairing did not complete" };
}

/** `scanSeconds` bounds the inquiry, so airtime noise never runs continuously. */
export function createBluetoothctlHost(opts: {
  run: (args: string[]) => Promise<string>;
  scanSeconds?: number;
}): BluetoothHost {
  const scanSeconds = opts.scanSeconds ?? 6;
  return {
    async scan(): Promise<DiscoveredDevice[]> {
      const output = await opts.run(["--timeout", String(scanSeconds), "scan", "on"]);
      const failure = /(?:No default controller available|Failed to start discovery[^\r\n]*)/.exec(
        output.replace(ANSI, ""),
      );
      if (failure) throw new Error(failure[0]);
      const listed = parseBluetoothctlDevices(await opts.run(["devices"]));
      return listed.map((d) => ({
        transport: "bluetooth",
        localKey: d.mac,
        ...(d.name !== undefined ? { name: d.name } : {}),
      }));
    },
    async pair(mac: string): Promise<PairResult> {
      return parsePairResult(await opts.run(["pair", mac]), mac);
    },
    async paired(): Promise<BluetoothDevice[]> {
      return parseBluetoothctlDevices(await opts.run(["devices", "Paired"]));
    },
  };
}
