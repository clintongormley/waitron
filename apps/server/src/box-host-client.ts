import { createConnection } from "node:net";
import {
  formatHostRequest,
  HOST_REPLY_MAX,
  parseHostReply,
} from "../../../scripts/box/host-protocol.mjs";
import { isUnset } from "./env-value.js";

/**
 * The server's side of the box's host service: one request line to the host's socket, one JSON
 * line back. `boxHostClient()` asks the clock requests (`deploy/box/waitron-box.sh`);
 * `boxHostRequests()` asks the host's other requests, writing and reading each line by the rules
 * of `scripts/box/host-protocol.mjs`. Every failure answers `available: false`, never a throw,
 * because a box without the service (a laptop, Docker Desktop, a host without systemd) still sells.
 *
 * `missing`: no connection was made (`detail` is the error's code; EACCES is a socket whose group
 * the app is not in). `lost`: the connection broke, or closed with no answer, after the request was
 * sent; as after a `timeout`, a request that changes the box may have done so.
 */
export type Unavailable = "missing" | "lost" | "refused" | "timeout" | "malformed";
export type ClockServiceStatus =
  | { available: false; reason: Unavailable; detail?: string }
  | {
      available: true;
      service: "on" | "off" | "stopped";
      unit: string | null;
      synchronised: boolean;
      lastSyncAt: string | null;
    };
export type ClockSetAnswer =
  | { available: false; reason: Unavailable; refusal?: string; detail?: string }
  | { available: true; beforeMs: number; afterMs: number };
export interface BoxHostClient {
  clockStatus(): Promise<ClockServiceStatus>;
  setClock(input: {
    targetMs: number;
    requester: Record<string, string | null>;
  }): Promise<ClockSetAnswer>;
}

export const DEFAULT_SOCKET_PATH = "/run/waitron-box/box.sock";
export const DEFAULT_STATUS_MS = 2_000;
/** Longer than the host unit's `RuntimeMaxSec=15`, so the host ends a stuck set first. */
export const DEFAULT_SET_MS = 20_000;
const MAX_REPLY_BYTES = 4096;
/** The host's own limit on a requester (`deploy/box/waitron-box.sh`). */
const MAX_REQUESTER_BYTES = 512;
/** The latest time a JavaScript Date holds. */
const MAX_DATE_MS = 8.64e15;

type Exchange =
  | { ok: true; reply: Record<string, unknown> }
  | { ok: false; reason: Unavailable; refusal?: string; detail?: string };

type Received =
  | { ok: true; text: string }
  | { ok: false; reason: "missing"; detail: string }
  | { ok: false; reason: "lost"; text: string }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "oversize" };

function sendLine(
  socketPath: string,
  line: string,
  limitMs: number,
  maxBytes: number,
): Promise<Received> {
  return new Promise((resolve) => {
    let bytes = 0;
    let connected = false;
    const chunks: Buffer[] = [];
    let socket: ReturnType<typeof createConnection>;
    try {
      socket = createConnection(socketPath);
    } catch (error) {
      resolve({
        ok: false,
        reason: "missing",
        detail: String((error as NodeJS.ErrnoException).code),
      });
      return;
    }
    const finish = (result: Received) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), limitMs);
    socket.on("connect", () => {
      connected = true;
      socket.write(`${line}\n`);
    });
    socket.on("error", (error: NodeJS.ErrnoException) =>
      finish(
        connected
          ? { ok: false, reason: "lost", text: Buffer.concat(chunks).toString("utf8") }
          : { ok: false, reason: "missing", detail: String(error.code) },
      ),
    );
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish({ ok: false, reason: "oversize" });
        return;
      }
      chunks.push(chunk);
    });
    socket.on("end", () => finish({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
  });
}

async function exchange(socketPath: string, line: string, limitMs: number): Promise<Exchange> {
  const received = await sendLine(socketPath, line, limitMs, MAX_REPLY_BYTES);
  if (!received.ok) {
    if (received.reason === "missing") return received;
    if (received.reason === "oversize") return { ok: false, reason: "malformed" };
    return { ok: false, reason: received.reason };
  }
  const { text } = received;
  if (text === "") return { ok: false, reason: "lost" };
  if (!/^[^\n]*\n$/.test(text)) return { ok: false, reason: "malformed" };
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) {
    return { ok: false, reason: "malformed" };
  }
  const record = reply as Record<string, unknown>;
  if (record.ok === true) return { ok: true, reply: record };
  if (record.ok === false && typeof record.reason === "string") {
    return { ok: false, reason: "refused", refusal: record.reason };
  }
  return { ok: false, reason: "malformed" };
}

const isMs = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE_MS;
const SERVICES: ReadonlySet<unknown> = new Set(["on", "off", "stopped"]);

export function boxHostClient(
  deps: { socketPath?: string; statusMs?: number; setMs?: number } = {},
): BoxHostClient {
  const socketPath = isUnset(deps.socketPath) ? DEFAULT_SOCKET_PATH : deps.socketPath;
  return {
    async clockStatus() {
      const result = await exchange(socketPath, "clock.status", deps.statusMs ?? DEFAULT_STATUS_MS);
      if (!result.ok) {
        return {
          available: false,
          reason: result.reason,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        };
      }
      const { service, unit, synchronised, lastSyncAt } = result.reply;
      if (
        !SERVICES.has(service) ||
        !(unit === null || typeof unit === "string") ||
        typeof synchronised !== "boolean" ||
        !(lastSyncAt === null || isMs(lastSyncAt))
      ) {
        return { available: false, reason: "malformed" };
      }
      return {
        available: true,
        service: service as "on" | "off" | "stopped",
        unit,
        synchronised,
        lastSyncAt: lastSyncAt === null ? null : new Date(lastSyncAt).toISOString(),
      };
    },
    async setClock({ targetMs, requester }) {
      // The host takes printable ASCII only, so a letter beyond it travels as a JSON escape.
      const json = JSON.stringify(requester).replace(
        /[^\x20-\x7e]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
      if (!Number.isSafeInteger(targetMs) || json.length > MAX_REQUESTER_BYTES) {
        return { available: false, reason: "malformed" };
      }
      const result = await exchange(
        socketPath,
        `clock.set ${targetMs} ${json}`,
        deps.setMs ?? DEFAULT_SET_MS,
      );
      if (!result.ok) {
        return {
          available: false,
          reason: result.reason,
          ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        };
      }
      const { beforeMs, afterMs } = result.reply;
      if (!isMs(beforeMs) || !isMs(afterMs)) return { available: false, reason: "malformed" };
      return { available: true, beforeMs, afterMs };
    },
  };
}

export type HostActor = { source: "person"; person: string } | { source: "server" };
export type PersonActor = Extract<HostActor, { source: "person" }>;
export type ProtocolRefusal =
  "request_invalid" | "actor_invalid" | "fields_invalid" | "host_failed";
export type HostUnavailable<Refusal extends string> =
  | { available: false; reason: "refused"; refusal: Refusal }
  | { available: false; reason: "unsupported"; detail: "unknown_request" | "request_invalid" }
  | { available: false; reason: "missing"; detail: string }
  | { available: false; reason: "lost" | "timeout" | "malformed" | "invalid" };
export type HostAnswer<Value extends object, Refusal extends string> =
  ({ available: true } & Value) | HostUnavailable<Refusal>;

export type WifiCopyState = "pending" | "current" | "absent" | "failed";
export type WifiCopyFailure =
  | "mount-unverified"
  | "root-changed"
  | "path-unsafe"
  | "permissions-unsafe"
  | "io-failed"
  | "publication-unverified";
export type WifiNoCopyReason =
  | "cable-only"
  | "open"
  | "open-or-wep"
  | "dynamic-wep"
  | "owe"
  | "enterprise"
  | "unsupported-security"
  | "password-unavailable"
  | "password-not-printable"
  | "password-too-long"
  | "password-invalid";
export type JoinChangeRefusal = "password-rejected" | "network-not-found" | "timed-out" | "failed";
export type ForgetChangeRefusal = "failed";
export type NetworkChange =
  | { kind: "join"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "join"; ssidHex: string; state: "refused"; reason: JoinChangeRefusal }
  | { kind: "forget"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "forget"; ssidHex: string; state: "refused"; reason: ForgetChangeRefusal };
export interface NetworkSnapshot {
  wired: { connected: boolean; address: string | null };
  wifi: { connectedSsidHex: string | null; savedSsidHex: string | null };
  change: NetworkChange | null;
  bootCopy: {
    state: WifiCopyState;
    reason: WifiNoCopyReason | null;
    failure: WifiCopyFailure | null;
  };
}
export type StartScreen = "dashboard" | "till";
export type ScanSecurity = "wpa-psk" | "sae" | "other";
export interface ScannedNetwork {
  ssidHex: string;
  signal: number;
  security: ScanSecurity;
}
export type WifiJoin = {
  ssidHex: string;
  keyMgmt: "wpa-psk" | "sae";
  psk: string;
  hidden: boolean;
};
export type NameTag = { name: string; live: boolean } | null;
export type TagOutcome = "written" | "removed" | "unchanged";
export type NetworkScanRefusal = ProtocolRefusal | "busy" | "no_wifi";
export type NetworkJoinRefusal = ProtocolRefusal | "busy" | "no_wifi";
export type NetworkForgetRefusal = ProtocolRefusal | "busy" | "not_saved";
export type TagWriteRefusal =
  ProtocolRefusal | "busy" | "no_free_token" | "header_unreadable" | "no_space";

export interface BoxHostRequests {
  networkRead(actor: HostActor): Promise<HostAnswer<NetworkSnapshot, ProtocolRefusal>>;
  networkScan(
    actor: PersonActor,
  ): Promise<HostAnswer<{ networks: readonly ScannedNetwork[] }, NetworkScanRefusal>>;
  networkJoin(
    join: WifiJoin,
    actor: PersonActor,
  ): Promise<HostAnswer<Record<never, never>, NetworkJoinRefusal>>;
  networkForget(
    forget: { ssidHex: string },
    actor: PersonActor,
  ): Promise<HostAnswer<Record<never, never>, NetworkForgetRefusal>>;
  screenRead(actor: HostActor): Promise<HostAnswer<{ start: StartScreen }, ProtocolRefusal>>;
  screenSet(
    set: { start: StartScreen },
    actor: PersonActor,
  ): Promise<HostAnswer<{ start: StartScreen }, ProtocolRefusal>>;
  /** Always sent as the server: the only actor `tag.write` accepts. */
  tagWrite(tag: NameTag): Promise<HostAnswer<{ tag: TagOutcome }, TagWriteRefusal>>;
}

export const DEFAULT_HOST_READ_MS = 5_000;
/** Longer than the host unit's `RuntimeMaxSec=15` (`deploy/box/waitron-box@.service`). */
export const DEFAULT_HOST_CHANGE_MS = 20_000;
/** The longest line `deploy/box/waitron-box.sh` reads before answering `request_invalid`. */
const SHELL_LINE_MAX = 700;

async function request<Value extends object, Refusal extends string>(
  socketPath: string,
  verb: string,
  fields: Readonly<Record<string, unknown>>,
  actor: Readonly<Record<string, unknown>>,
  limitMs: number,
): Promise<HostAnswer<Value, Refusal>> {
  let line: string;
  try {
    line = formatHostRequest({ verb, fields, actor });
  } catch {
    return { available: false, reason: "invalid" };
  }
  const received = await sendLine(socketPath, line, limitMs, HOST_REPLY_MAX);
  let text: string;
  if (received.ok) {
    text = received.text;
  } else if (received.reason === "lost" && received.text.endsWith("\n")) {
    // A handler that left part of a long line unread can reset the connection after its reply.
    text = received.text;
  } else {
    if (received.reason === "missing") {
      return { available: false, reason: "missing", detail: received.detail };
    }
    if (received.reason === "oversize") return { available: false, reason: "malformed" };
    return { available: false, reason: received.reason };
  }
  if (text === "") return { available: false, reason: "lost" };
  const reply = parseHostReply(verb, text);
  if (reply.kind === "ok") return { available: true, ...reply.value } as HostAnswer<Value, Refusal>;
  if (reply.kind === "malformed") return { available: false, reason: "malformed" };
  if (reply.reason === "unknown_request") {
    return { available: false, reason: "unsupported", detail: "unknown_request" };
  }
  if (reply.reason === "request_invalid" && line.length > SHELL_LINE_MAX) {
    return { available: false, reason: "unsupported", detail: "request_invalid" };
  }
  return { available: false, reason: "refused", refusal: reply.reason as Refusal };
}

export function boxHostRequests(
  deps: { socketPath?: string; readMs?: number; changeMs?: number } = {},
): BoxHostRequests {
  const socketPath = isUnset(deps.socketPath) ? DEFAULT_SOCKET_PATH : deps.socketPath;
  const readMs = deps.readMs ?? DEFAULT_HOST_READ_MS;
  const changeMs = deps.changeMs ?? DEFAULT_HOST_CHANGE_MS;
  return {
    networkRead: (actor) => request(socketPath, "network.read", {}, actor, readMs),
    networkScan: (actor) => request(socketPath, "network.scan", {}, actor, changeMs),
    networkJoin: (join, actor) => request(socketPath, "network.join", join, actor, changeMs),
    networkForget: (forget, actor) =>
      request(socketPath, "network.forget", forget, actor, changeMs),
    screenRead: (actor) => request(socketPath, "screen.read", {}, actor, readMs),
    screenSet: (set, actor) => request(socketPath, "screen.set", set, actor, changeMs),
    tagWrite: (tag) => request(socketPath, "tag.write", { tag }, { source: "server" }, changeMs),
  };
}
