import { createConnection } from "node:net";

/**
 * The server's side of the box's clock service (`deploy/box/waitron-box.sh`): one request line to
 * the host's socket, one JSON line back. Every failure answers `available: false`, never a throw,
 * because a box without the service (a laptop, Docker Desktop, a host without systemd) still sells.
 *
 * `missing`: no connection was made (`detail` is the error's code; EACCES is a socket whose group
 * the app is not in). `lost`: the connection broke, or closed with no answer, after the request was
 * sent — a set may have moved the clock, as after a `timeout`.
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

function exchange(socketPath: string, line: string, limitMs: number): Promise<Exchange> {
  return new Promise((resolve) => {
    let bytes = 0;
    let connected = false;
    const chunks: Buffer[] = [];
    const socket = createConnection(socketPath);
    const finish = (result: Exchange) => {
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
          ? { ok: false, reason: "lost" }
          : { ok: false, reason: "missing", detail: String(error.code) },
      ),
    );
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REPLY_BYTES) {
        finish({ ok: false, reason: "malformed" });
        return;
      }
      chunks.push(chunk);
    });
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text === "") {
        finish({ ok: false, reason: "lost" });
        return;
      }
      if (!/^[^\n]*\n$/.test(text)) {
        finish({ ok: false, reason: "malformed" });
        return;
      }
      let reply: unknown;
      try {
        reply = JSON.parse(text);
      } catch {
        finish({ ok: false, reason: "malformed" });
        return;
      }
      if (typeof reply !== "object" || reply === null || Array.isArray(reply)) {
        finish({ ok: false, reason: "malformed" });
        return;
      }
      const record = reply as Record<string, unknown>;
      if (record.ok === true) {
        finish({ ok: true, reply: record });
      } else if (record.ok === false && typeof record.reason === "string") {
        finish({ ok: false, reason: "refused", refusal: record.reason });
      } else {
        finish({ ok: false, reason: "malformed" });
      }
    });
  });
}

const isMs = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE_MS;
const SERVICES: ReadonlySet<unknown> = new Set(["on", "off", "stopped"]);

export function boxHostClient(
  deps: { socketPath?: string; statusMs?: number; setMs?: number } = {},
): BoxHostClient {
  const socketPath = deps.socketPath ?? DEFAULT_SOCKET_PATH;
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
