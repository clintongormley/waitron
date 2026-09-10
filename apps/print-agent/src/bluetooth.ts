import type { DiscoveredDevice, PairResult } from "@waitron/print-agent";

/**
 * Bluetooth discovery/pairing over BlueZ, driven through `bluetoothctl`. The DECODING — turning the
 * tool's line output into devices and a pair result — is pure and tested against fixtures synthesised in
 * the tool's documented output shape ({@link parseBluetoothctlDevices}, {@link parsePairResult}); the
 * process spawn is injected as `run`, so the only untested part is the spawn itself (a thin gated seam
 * in {@link createLinuxDevices}).
 *
 * The box's Bluetooth ADAPTER was not confirmed at the 2026-09-10 hardware capture, so the exact live
 * output shape and the RFCOMM binding are to confirm at the Step 6c receipt; the live radio path is
 * exercised only there. If a paired printer's RFCOMM node cannot be bound in a container the finding is
 * recorded (spec §7) and the seam here is unchanged.
 */

/** One MAC/name pair off a `bluetoothctl devices`/scan listing. `name` is omitted when the tool is
 * assumed to have no real name and print the MAC-in-dashes placeholder (confirmed at the Step 6c receipt). */
export interface BluetoothDevice {
  mac: string;
  name?: string;
}

/** The Bluetooth half of the device seam: an inquiry scan, a bond, and the bonded-device list. */
export interface BluetoothHost {
  scan(): Promise<DiscoveredDevice[]>;
  pair(mac: string): Promise<PairResult>;
  paired(): Promise<BluetoothDevice[]>;
}

// Group 1 is a colon-separated 6-octet MAC; group 2 is the rest of the line (the device name).
const DEVICE_LINE = /Device\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:\s+(.*))?$/;
// eslint-disable-next-line no-control-regex -- bluetoothctl colours its output; strip CSI SGR codes.
const ANSI = /\[[0-9;]*m/g;

/** Assumed: bluetoothctl prints the MAC in dashes (`AA-BB-CC-DD-EE-FF`) as its placeholder when no name
 * is known, so we treat that as "no name". To confirm against real tool output at the Step 6c receipt. */
function isMacPlaceholder(name: string, mac: string): boolean {
  return name.replaceAll("-", ":").toUpperCase() === mac.toUpperCase();
}

/** Parses `bluetoothctl` device/scan output into MAC/name pairs, last name per MAC winning. Tolerates
 * ANSI colour codes, `[NEW]`/`[CHG]` prefixes and CRs. */
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

/** Decodes a `bluetoothctl pair <mac>` transcript into a {@link PairResult}. */
export function parsePairResult(text: string, mac: string): PairResult {
  const clean = text.replace(ANSI, "");
  if (/Pairing successful/.test(clean)) return { ok: true, localKey: mac.toUpperCase() };
  const failed = /Failed to pair:\s*(.+)/.exec(clean);
  if (failed !== null) return { ok: false, error: failed[1]!.trim() };
  return { ok: false, error: "pairing did not complete" };
}

/** Builds a {@link BluetoothHost} over an injected `run(args)` that spawns `bluetoothctl`. `scanSeconds`
 * bounds the inquiry (LAN/airtime noise must not run continuously — spec §6). */
export function createBluetoothctlHost(opts: {
  run: (args: string[]) => Promise<string>;
  scanSeconds?: number;
}): BluetoothHost {
  const scanSeconds = opts.scanSeconds ?? 6;
  return {
    async scan(): Promise<DiscoveredDevice[]> {
      // A bounded inquiry populates BlueZ's cache; `devices` then reads it back.
      await opts.run(["--timeout", String(scanSeconds), "scan", "on"]);
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
