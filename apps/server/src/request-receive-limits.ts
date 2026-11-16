import type { Server } from "node:https";
import type { Socket } from "node:net";
import { steadyNow } from "@waitron/shared";

export const SETUP_RECEIVE_LIMITS = {
  ordinaryMs: 300_000,
  uploadMs: 43_200_000,
  headersMs: 60_000,
  idleMs: 120_000,
  checkMs: 1000,
  minProgressBytes: 65_536,
};
const UPLOAD_PATHS = new Set([
  "/setup-api/restore/preview",
  "/setup-api/recovery/stage",
  "/setup-api/restore",
]);

export function attachRequestReceiveLimits(
  server: Server,
  overrides: Partial<typeof SETUP_RECEIVE_LIMITS> = {},
): void {
  const limits = { ...SETUP_RECEIVE_LIMITS, ...overrides };
  server.requestTimeout = limits.uploadMs;
  server.headersTimeout = limits.headersMs;
  const turns = new WeakMap<Socket, { since: number; bytes: number }>();
  server.on("secureConnection", (socket) => {
    turns.set(socket, { since: steadyNow(), bytes: socket.bytesRead });
  });
  server.on("request", (request, response) => {
    const socket = request.socket;
    const turn = turns.get(socket)!;
    const started = turn.since;
    let markedBytes = turn.bytes;
    let progressAt = steadyNow();
    const upload = request.method === "POST" && UPLOAD_PATHS.has(request.url!.split("?", 1)[0]!);
    response.once("finish", () => {
      turn.since = steadyNow();
      turn.bytes = socket.bytesRead;
    });
    const clean = () => {
      clearInterval(timer);
      socket.off("close", clean);
    };
    const expire = () => {
      clean();
      if (response.headersSent) socket.destroy();
      else
        socket.end(
          "HTTP/1.1 408 Request Timeout\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
          () => socket.destroy(),
        );
    };
    // Watching the socket's count leaves Hono in charge of consuming and backpressuring the body.
    const timer = setInterval(() => {
      if (request.complete || socket.destroyed) return clean();
      const now = steadyNow();
      if (!upload) {
        if (now - started >= limits.ordinaryMs) expire();
      } else {
        if (socket.bytesRead - markedBytes >= limits.minProgressBytes) {
          markedBytes = socket.bytesRead;
          progressAt = now;
        }
        if (now - progressAt >= limits.idleMs) expire();
      }
    }, limits.checkMs);
    timer.unref();
    socket.once("close", clean);
  });
}
