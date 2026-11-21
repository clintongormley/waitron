import { createConnection } from "node:net";
import { isReleaseVersion } from "@waitron/shared";
import {
  formatHostRequest,
  HOST_REPLY_MAX,
  parseHostReply,
} from "../../../scripts/box/host-protocol.mjs";
import { isUnset } from "./env-value.js";

/**
 * The server's side of the box's host service: one request line to the host's socket, one JSON
 * line back. `boxHostClient()` sends the fixed requests (`deploy/box/waitron-box.sh`);
 * `boxHostRequests()` asks the host's other requests, writing and reading each line by the rules
 * of `scripts/box/host-protocol.mjs`. Every failure answers `available: false`, never a throw: a
 * box without the service (a laptop, Docker Desktop, a host without systemd) answers every request
 * so, which the start's clock check reads as not synchronised.
 *
 * `missing`: no connection was made (`detail` is the error's code; EACCES is a socket whose group
 * the app is not in). `lost`: the connection broke, or closed with no answer, after the request was
 * sent (for `boxHostRequests()`, a whole reply line that arrived before the break is the answer);
 * as after a `timeout`, a request that changes the box may have done so.
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
export type TimeServiceOnAnswer =
  | { available: false; reason: Unavailable; refusal?: string; detail?: string }
  | { available: true };
export interface LastOfferedUpgrade {
  attemptId: string;
  finishedAt: string;
  fromVersion: string;
  toVersion: string;
  status: "upgraded" | "rolled-back";
}

export interface UpgradeSettingsEdit {
  revision: number;
  automatic: boolean;
  start: string | null;
  end: string | null;
}

export type UpgradeSettingsAnswer =
  | { ok: true; settings: UpgradeSettingsEdit & { version: 1 } }
  | { ok: false; reason: "invalid" | "stale" | "busy" | "unavailable" };

export function upgradeSettingsEdit(value: unknown): UpgradeSettingsEdit | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { revision, automatic, start, end } = value as Record<string, unknown>;
  const hour = (time: unknown): time is string | null =>
    time === null ||
    (typeof time === "string" && time.length === 5 && /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof automatic !== "boolean" ||
    !hour(start) ||
    !hour(end)
  )
    return null;
  return { revision, automatic, start, end };
}

export interface BoxHostClient {
  readUpgradeSettings?(): Promise<UpgradeSettingsAnswer>;
  saveUpgradeSettings?(edit: UpgradeSettingsEdit): Promise<UpgradeSettingsAnswer>;
  lastOfferedUpgrade?(): Promise<LastOfferedUpgrade | null>;
  clockStatus(): Promise<ClockServiceStatus>;
  /** Switches the host's automatic time back on (`clock.sync-on`); test fakes may leave it out. */
  timeServiceOn?(): Promise<TimeServiceOnAnswer>;
  /** Restarts the host's running time service so it asks its servers now (`clock.retry`); test
   * fakes may leave it out. */
  retryTimeService?(): Promise<TimeServiceOnAnswer>;
  setClock(input: {
    targetMs: number;
    requester: Record<string, string | null>;
  }): Promise<ClockSetAnswer>;
}

export const DEFAULT_SOCKET_PATH = "/run/waitron-box/box.sock";
export const DEFAULT_STATUS_MS = 2_000;
/** Longer than the host unit's `RuntimeMaxSec=15`, so the host ends a stuck set first. */
export const DEFAULT_SET_MS = 20_000;
/** Short, since a restart is asked in the correction's turn, where a person's confirmation waits;
 * the host may hold its lock past it, so a set just after a timed-out restart can be refused `busy`,
 * which still counts as a set and ends the restarts. */
export const DEFAULT_RETRY_MS = 5_000;
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
  deps: { socketPath?: string; statusMs?: number; setMs?: number; retryMs?: number } = {},
): Required<BoxHostClient> {
  const socketPath = isUnset(deps.socketPath) ? DEFAULT_SOCKET_PATH : deps.socketPath;
  async function askUpgradeSettings(line: string, limitMs: number): Promise<UpgradeSettingsAnswer> {
    const response = await exchange(socketPath, line, limitMs);
    if (!response.ok) {
      switch (response.refusal) {
        case "settings_invalid":
          return { ok: false, reason: "invalid" };
        case "settings_stale":
          return { ok: false, reason: "stale" };
        case "busy":
          return { ok: false, reason: "busy" };
        default:
          return { ok: false, reason: "unavailable" };
      }
    }
    const value = response.reply.result;
    const fields = upgradeSettingsEdit(value);
    if (fields === null || (value as { version?: unknown }).version !== 1)
      return { ok: false, reason: "unavailable" };
    return { ok: true, settings: { version: 1, ...fields } };
  }
  return {
    readUpgradeSettings: () =>
      askUpgradeSettings("upgrade.settings", deps.statusMs ?? DEFAULT_STATUS_MS),
    saveUpgradeSettings: (edit) =>
      askUpgradeSettings(
        `upgrade.settings.set ${JSON.stringify(edit)}`,
        deps.setMs ?? DEFAULT_SET_MS,
      ),
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
    async lastOfferedUpgrade() {
      const response = await exchange(
        socketPath,
        "upgrade.status",
        deps.statusMs ?? DEFAULT_STATUS_MS,
      );
      if (!response.ok) return null;
      const value = response.reply.result;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
      const { attemptId, finishedAt, fromVersion, toVersion, status } = value as Record<
        string,
        unknown
      >;
      if (
        typeof attemptId !== "string" ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(attemptId) ||
        typeof finishedAt !== "string" ||
        !Number.isFinite(Date.parse(finishedAt)) ||
        new Date(finishedAt).toISOString() !== finishedAt ||
        typeof fromVersion !== "string" ||
        !isReleaseVersion(fromVersion) ||
        typeof toVersion !== "string" ||
        !isReleaseVersion(toVersion) ||
        toVersion.includes("-") ||
        (status !== "upgraded" && status !== "rolled-back")
      )
        return null;
      return { attemptId, finishedAt, fromVersion, toVersion, status };
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
    timeServiceOn: () => askToAct("clock.sync-on", deps.setMs ?? DEFAULT_SET_MS),
    retryTimeService: () => askToAct("clock.retry", deps.retryMs ?? DEFAULT_RETRY_MS),
  };

  async function askToAct(line: string, limitMs: number): Promise<TimeServiceOnAnswer> {
    const result = await exchange(socketPath, line, limitMs);
    if (!result.ok) {
      return {
        available: false,
        reason: result.reason,
        ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      };
    }
    return { available: true };
  }
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
export type NetworkChange = Readonly<
  | { kind: "join"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "join"; ssidHex: string; state: "refused"; reason: JoinChangeRefusal }
  | { kind: "forget"; ssidHex: string; state: "running" | "applied"; reason: null }
  | { kind: "forget"; ssidHex: string; state: "refused"; reason: ForgetChangeRefusal }
>;
/** The nested objects arrive frozen by `parseHostReply`; the answer's own fields are a copy. */
export interface NetworkSnapshot {
  wired: { readonly connected: boolean; readonly address: string | null };
  wifi: { readonly connectedSsidHex: string | null; readonly savedSsidHex: string | null };
  change: NetworkChange | null;
  bootCopy: {
    readonly state: WifiCopyState;
    readonly reason: WifiNoCopyReason | null;
    readonly failure: WifiCopyFailure | null;
  };
}
export type StartScreen = "dashboard" | "till";
export type ScanSecurity = "wpa-psk" | "sae" | "other";
export interface ScannedNetwork {
  readonly ssidHex: string;
  readonly signal: number;
  readonly security: ScanSecurity;
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
