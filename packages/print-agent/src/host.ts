import type { ServerEntry, WireJob } from "./client.js";
import type { PrintTransport, PrinterTarget, Transport, TransportKind } from "./transport.js";

export type { TransportKind } from "./transport.js";

/** The loop never touches the filesystem, a clock, a timer or a logger directly — only the Host. */
export interface AgentConfig {
  serverUrl: string;
  name: string;
  /** Fixed by the first successful probe of the configured address; pins which environment's jobs the
   * agent will ever pull (CLAUDE.md §5). */
  environment?: string;
  /** The two-digit verification number of the OPEN join request, persisted while pending so a restart
   * (which reloads the token and keeps polling the same request) can still show the code the admin
   * matches. Cleared on approval and on halt. */
  pendingVerificationNumber?: string;
  /** Other venue nodes learned from the last successful pull. */
  servers?: ServerEntry[];
}

export type AgentPhase =
  "unconfigured" | "pending" | "pairing_closed" | "running" | "unauthorized" | "unreachable";

export interface AgentStatus {
  phase: AgentPhase;
  serverUrl: string | null;
  current: string | null;
  /** The two-digit number the admin matches in the dashboard. Sourced from the join reply and, across a
   * restart, from the persisted {@link AgentConfig.pendingVerificationNumber}, so a pending agent always
   * shows it. */
  verificationCode?: string;
  lastJobAt?: number;
  lastError?: string;
}

export interface HostLog {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** A device the agent can deliver a job to now — a USB printer at a known serial, or a paired
 * Bluetooth printer only once it has a device path. Reported to the server on every pull
 * (`local_key` is the printer's identity across reboots and re-plugs) so the admin can bind a
 * configured printer to real hardware. */
export interface VisibleDevice {
  transport: "usb" | "bluetooth";
  localKey: string;
  make?: string;
  model?: string;
}

/** An active scan or address-check result. A reachable TCP address does not establish printer identity. */
export interface DiscoveredDevice {
  transport: PrintTransport;
  localKey?: string;
  host?: string;
  port?: number;
  make?: string;
  model?: string;
  name?: string;
  /** Set when the device answered an IPP paper-size query listing A4 or US letter, so it is an office
   * printer, not an ESC/POS receipt printer. Absent means unknown or not a page printer. */
  pagePrinter?: true;
  /** Set on a Bluetooth device whose `bluetoothctl info` shows a printer icon, an imaging class with
   * the printer bit, or the Serial Port profile. Absent means not inspected or none of the three. */
  printerLike?: true;
}

/** The outcome of a {@link Host.pair} attempt — `ok` with the paired device's `localKey` on success,
 * or `ok: false` with an operator-facing `error`. */
export interface PairResult {
  ok: boolean;
  localKey?: string;
  error?: string;
}

/** A device BlueZ holds a bond with, whether or not the agent can deliver to it yet. */
export interface PairedBluetoothDevice {
  localKey: string;
  name?: string;
}

export interface BluetoothCommandResult {
  ok: boolean;
  error?: string;
}

/** A manager-requested address check, carrying the server's remaining lifetime. */
export interface NetworkProbe {
  host: string;
  port: number;
  expiresInMs: number;
}

export interface Host {
  /** Machine hostname when the host platform exposes it. */
  hostname?(): string;
  /** Browser-facing setup address, or null when the host cannot advertise one. */
  setupUrl?(): string | null;
  setupPort?(): number;
  config(): Promise<AgentConfig | null>;
  saveConfig(config: AgentConfig): Promise<void>;
  token(): Promise<string | null>;
  saveToken(token: string | null): Promise<void>;
  transport: Transport;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log: HostLog;
  status(status: AgentStatus): void;
  /** Devices the agent can deliver a job to now — reported to the server on every pull. */
  visibleDevices(): Promise<VisibleDevice[]>;
  /** An active discovery pass over the given transports (all discoverable kinds when omitted); run
   * only while the server holds a discovery window open. */
  scan(kinds?: TransportKind[]): Promise<DiscoveredDevice[]>;
  /** Bounded TCP connection checks; send no bytes and return only reachable targets. */
  probeNetwork(targets: NetworkProbe[]): Promise<DiscoveredDevice[]>;
  /** Asks port 631 of each network device's host one IPP Get-Printer-Attributes query, or reuses a
   * recent answer, and returns the devices with office printers marked `pagePrinter: true`. A failed
   * check leaves the device unmarked. The loop calls it at most once per pull, over the merged scan and
   * probe results, and treats a throw as "nothing marked". */
  markPagePrinters?(devices: DiscoveredDevice[]): Promise<DiscoveredDevice[]>;
  /** Turns a claimed job's connection facts into a {@link PrinterTarget} the transport can send to —
   * for a local job, mapping its `localKey` to the box's current device path. Throws when the device
   * is gone, so the loop marks the job failed rather than sending nowhere. */
  resolve(job: WireJob): Promise<PrinterTarget>;
  /** Attempts to pair a Bluetooth printer by MAC, returning its `localKey` on success. The PIN is
   * the operator's, handed over only if the printer asks for one; it never goes into a log line, an
   * error or the result. */
  pair(mac: string, pin?: string): Promise<PairResult>;
  /** Every bonded Bluetooth device. Throws when the Bluetooth side cannot be listed. Unlike
   * {@link visibleDevices}, it includes devices no job can be delivered to yet. */
  pairedBluetooth(): Promise<PairedBluetoothDevice[]>;
  /** Removes the bond; an address BlueZ no longer knows counts as removed. */
  forgetBluetooth(mac: string): Promise<BluetoothCommandResult>;
  /** False when this host cannot print to any paired Bluetooth printer, which the loop tells the
   * server so it can end those printers' jobs rather than leave them waiting. */
  bluetoothPrinting?(): boolean;
}
