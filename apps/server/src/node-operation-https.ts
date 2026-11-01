import type { Context } from "hono";
import { TLSSocket } from "node:tls";
import { AppError } from "@waitron/shared";
import "./errors.js";

export function requireNodeOperationHttps(c: Context): void {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  const origin = c.req.header("Origin");
  const site = c.req.header("Sec-Fetch-Site");
  if (
    !(socket instanceof TLSSocket) ||
    !socket.encrypted ||
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    (site !== undefined && !["same-origin", "none"].includes(site))
  )
    throw new AppError("authorization.not_permitted", { permission: "node.promote" });
}
