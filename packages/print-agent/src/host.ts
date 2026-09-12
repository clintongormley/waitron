import type { WireJob } from "./client.js";
import type { PrintTransport, PrinterTarget, Transport, TransportKind } from "./transport.js";

export type { TransportKind } from "./transport.js";

/**
 * The seam between the agent's logic and the machine it runs on (base spec §2.1). A container host reads
 * env + a state directory and serves a setup page; a native till host later reads a settings screen.
 * The loop never touches the filesystem, a clock, a timer or a logger directly — only this.
 */
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

/** A device the agent already has a stable local handle for — a USB printer at a known serial, or a
 * paired Bluetooth printer. Reported to the server on every pull (`local_key` is the printer's
 * identity across reboots and re-plugs) so the admin can bind a configured printer to real hardware. */
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
}

/** The outcome of a {@link Host.pair} attempt — `ok` with the paired device's `localKey` on success,
 * or `ok: false` with an operator-facing `error`. */
export interface PairResult {
  ok: boolean;
  localKey?: string;
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
  // The device seam (design §7). This deliberately supersedes the spec's sketch of §7
  // (`visibleKeys()` / `resolve(target)` / `ResolvedSink`): the shipped shape is `visibleDevices()`,
  // `resolve(job)` and a `scan(kinds?)` the loop drives inside a discovery window.
  /** Devices with a stable local handle right now — reported to the server on every pull. */
  visibleDevices(): Promise<VisibleDevice[]>;
  /** An active discovery pass over the given transports (all discoverable kinds when omitted); run
   * only while the server holds a discovery window open. */
  scan(kinds?: TransportKind[]): Promise<DiscoveredDevice[]>;
  /** Bounded TCP connection checks; send no bytes and return only reachable targets. */
  probeNetwork(targets: NetworkProbe[]): Promise<DiscoveredDevice[]>;
  /** Turns a claimed job's connection facts into a {@link PrinterTarget} the transport can send to —
   * for a local job, mapping its `localKey` to the box's current device path. Throws when the device
   * is gone, so the loop marks the job failed rather than sending nowhere. */
  resolve(job: WireJob): Promise<PrinterTarget>;
  /** Attempts to pair a Bluetooth printer by MAC, returning its `localKey` on success. */
  pair(mac: string): Promise<PairResult>;
}
