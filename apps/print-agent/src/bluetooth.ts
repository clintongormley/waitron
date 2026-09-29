import {
  type BluetoothCommandResult,
  type DiscoveredDevice,
  type PairResult,
  isBluetoothAddress,
} from "@waitron/print-agent";
import {
  ANSI,
  type BluetoothctlRunOptions,
  NOT_AN_ADDRESS,
  NO_CONTROLLER,
  pairWithBluetoothctl,
} from "./bluetooth-command.js";

/**
 * The `devices` decoder is tested against fixtures synthesised in `bluetoothctl`'s documented output
 * shape. The `info` and `remove` fixtures include values recorded on the owner's box (BlueZ 5.82,
 * 2026-09-29); the rest of each is synthesised, and marked so beside it.
 */

export interface BluetoothDevice {
  mac: string;
  name?: string;
}

export interface BluetoothHost {
  scan(): Promise<DiscoveredDevice[]>;
  pair(mac: string, pin?: string): Promise<PairResult>;
  paired(): Promise<BluetoothDevice[]>;
  forget(mac: string): Promise<BluetoothCommandResult>;
}

/** `info` is asked of at most this many listed devices per scan, all at once, so the command's own
 * deadline bounds the whole batch. Devices past it stay in the scan, unmarked. */
export const MAX_BLUETOOTH_INFO_DEVICES = 8;

const DEVICE_LINE = /Device\s+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?:\s+(.*))?$/;

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

const SERIAL_PORT_UUID = "00001101-0000-1000-8000-00805f9b34fb";
const MAJOR_CLASS_MASK = 0x1f00;
const IMAGING_MAJOR_CLASS = 0x0600;
const PRINTER_MINOR_BIT = 0x0080;
const INFO_FIELD = /^(\w+):\s*(.*)$/;

function cleanLines(text: string): string[] {
  return text.split("\n").map((line) => line.replace(ANSI, "").replace(/\r$/, "").trim());
}

/** Modalias is never read: once paired, the owner's printer reported Apple's vendor id (owner's box,
 * BlueZ 5.82, 2026-09-29). */
export function parseBluetoothctlInfo(text: string): { printerLike?: true } {
  let icon: string | undefined;
  let classOfDevice = 0;
  const uuids = new Set<string>();
  for (const line of cleanLines(text)) {
    const field = INFO_FIELD.exec(line);
    if (field === null) continue;
    const [, key, value] = field as unknown as [string, string, string];
    if (key === "Icon") icon = value;
    else if (key === "Class") {
      const hex = /^0x([0-9a-f]+)/i.exec(value);
      if (hex !== null) classOfDevice = Number.parseInt(hex[1]!, 16);
    } else if (key === "UUID") {
      const uuid = /\(([0-9a-f-]{36})\)$/i.exec(value);
      if (uuid !== null) uuids.add(uuid[1]!.toLowerCase());
    }
  }
  const printerLike =
    icon === "printer" ||
    ((classOfDevice & MAJOR_CLASS_MASK) === IMAGING_MAJOR_CLASS &&
      (classOfDevice & PRINTER_MINOR_BIT) !== 0) ||
    uuids.has(SERIAL_PORT_UUID);
  return printerLike ? { printerLike: true } : {};
}

const REMOVAL_INCOMPLETE = "removal did not complete";

/** Success is the removal line at exit 0, or this address reported unknown at exit 1: gone is what
 * Forget asked for. `exitCode` is null for a run that was killed or ended by a signal. */
export function parseRemoveResult(
  text: string,
  mac: string,
  exitCode: number | null,
): BluetoothCommandResult {
  const gone = `DEVICE ${mac.toUpperCase()} NOT AVAILABLE`;
  for (const line of cleanLines(text)) {
    if (line === "Device has been removed" && exitCode === 0) return { ok: true };
    if (line.toUpperCase() === gone && exitCode === 1) return { ok: true };
    if (line === NO_CONTROLLER) return { ok: false, error: NO_CONTROLLER };
    const failed = /^Failed to remove device:\s*(.+)$/.exec(line);
    if (failed !== null) return { ok: false, error: failed[1]! };
  }
  return { ok: false, error: REMOVAL_INCOMPLETE };
}

/** `scanSeconds` bounds the inquiry, so airtime noise never runs continuously. `listTimeoutMs`
 * kills the paired listing: with the system bus up and no BlueZ on it, bluetoothctl 5.82 was still
 * waiting when killed after 8 seconds. It is a kill rather than bluetoothctl's own `--timeout`,
 * which bluetoothctl waits out in full even after BlueZ has answered (see
 * bluetooth-availability.test.ts). */
export function createBluetoothctlHost(opts: {
  run: (args: string[], runOpts?: BluetoothctlRunOptions) => Promise<string>;
  pair?: (mac: string, pin?: string) => Promise<PairResult>;
  scanSeconds?: number;
  listTimeoutMs?: number;
}): BluetoothHost {
  const scanSeconds = opts.scanSeconds ?? 6;
  const pair = opts.pair ?? pairWithBluetoothctl;
  const listOpts = opts.listTimeoutMs === undefined ? undefined : { timeoutMs: opts.listTimeoutMs };
  return {
    async scan(): Promise<DiscoveredDevice[]> {
      const output = await opts.run(["--timeout", String(scanSeconds), "scan", "on"]);
      const failure = /(?:No default controller available|Failed to start discovery[^\r\n]*)/.exec(
        output.replace(ANSI, ""),
      );
      if (failure) throw new Error(failure[0]);
      const listed = parseBluetoothctlDevices(await opts.run(["devices"]));
      const inspected = await Promise.allSettled(
        listed.slice(0, MAX_BLUETOOTH_INFO_DEVICES).map((d) => opts.run(["info", d.mac])),
      );
      return listed.map((d, i) => {
        const info = inspected[i];
        const printerLike =
          info?.status === "fulfilled" && parseBluetoothctlInfo(info.value).printerLike === true;
        return {
          transport: "bluetooth",
          localKey: d.mac,
          ...(d.name !== undefined ? { name: d.name } : {}),
          ...(printerLike ? { printerLike: true as const } : {}),
        };
      });
    },
    pair(mac: string, pin?: string): Promise<PairResult> {
      return pair(mac, pin);
    },
    async forget(mac: string): Promise<BluetoothCommandResult> {
      if (!isBluetoothAddress(mac)) return { ok: false, error: NOT_AN_ADDRESS };
      try {
        return parseRemoveResult(await opts.run(["remove", mac]), mac, 0);
      } catch (error) {
        const failed = error as {
          stdout?: unknown;
          code?: unknown;
          killed?: unknown;
          signal?: unknown;
        } | null;
        const exitCode =
          failed?.killed !== true && failed?.signal == null && typeof failed?.code === "number"
            ? failed.code
            : null;
        const printed = failed?.stdout;
        const result = parseRemoveResult(typeof printed === "string" ? printed : "", mac, exitCode);
        if (result.ok || result.error !== REMOVAL_INCOMPLETE) return result;
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async paired(): Promise<BluetoothDevice[]> {
      const args = ["devices", "Paired"];
      const output = await (listOpts === undefined ? opts.run(args) : opts.run(args, listOpts));
      if (output.replace(ANSI, "").includes(NO_CONTROLLER)) throw new Error(NO_CONTROLLER);
      return parseBluetoothctlDevices(output);
    },
  };
}
