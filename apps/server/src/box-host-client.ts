import { createConnection } from "node:net";

/**
 * The server's side of the box's clock service (`deploy/box/waitron-box.sh`): one request line to
 * the host's socket, one JSON line back. Every failure answers `available: false`, never a throw,
 * because a box without the service (a laptop, Docker Desktop, a host without systemd) still sells.
 */
export type ClockServiceStatus =
  | { available: false; reason: "missing" | "refused" | "timeout" | "malformed" }
  | {
      available: true;
      service: "on" | "off" | "stopped";
      unit: string | null;
      synchronised: boolean;
      lastSyncAt: string | null;
    };
export type ClockSetAnswer =
  | { available: false; reason: "missing" | "refused" | "timeout" | "malformed"; refusal?: string }
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

type Exchange =
  | { ok: true; reply: Record<string, unknown> }
  | { ok: false; reason: "missing" | "refused" | "timeout" | "malformed"; refusal?: string };

function exchange(socketPath: string, line: string, limitMs: number): Promise<Exchange> {
  return new Promise((resolve) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const socket = createConnection(socketPath);
    const finish = (result: Exchange) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), limitMs);
    socket.on("connect", () => socket.write(`${line}\n`));
    socket.on("error", () => finish({ ok: false, reason: "missing" }));
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
  Number.isSafeInteger(value) && (value as number) >= 0;
const SERVICES: ReadonlySet<unknown> = new Set(["on", "off", "stopped"]);

export function boxHostClient(
  deps: { socketPath?: string; statusMs?: number; setMs?: number } = {},
): BoxHostClient {
  const socketPath = deps.socketPath ?? DEFAULT_SOCKET_PATH;
  return {
    async clockStatus() {
      const result = await exchange(socketPath, "clock.status", deps.statusMs ?? DEFAULT_STATUS_MS);
      if (!result.ok) return { available: false, reason: result.reason };
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
      if (!Number.isSafeInteger(targetMs)) return { available: false, reason: "malformed" };
      const result = await exchange(
        socketPath,
        `clock.set ${targetMs} ${JSON.stringify(requester)}`,
        deps.setMs ?? DEFAULT_SET_MS,
      );
      if (!result.ok) {
        return result.refusal === undefined
          ? { available: false, reason: result.reason }
          : { available: false, reason: result.reason, refusal: result.refusal };
      }
      const { beforeMs, afterMs } = result.reply;
      if (!isMs(beforeMs) || !isMs(afterMs)) return { available: false, reason: "malformed" };
      return { available: true, beforeMs, afterMs };
    },
  };
}
