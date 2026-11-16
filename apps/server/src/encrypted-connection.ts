import type { Context } from "hono";
import { TLSSocket } from "node:tls";

export function isSecure(c: Context): boolean {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  return socket instanceof TLSSocket && socket.encrypted;
}
