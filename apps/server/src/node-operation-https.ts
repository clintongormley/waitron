import type { Context } from "hono";
import { TLSSocket } from "node:tls";
import { AppError } from "@waitron/shared";
import { sentFromThisOrigin } from "./own-page.js";
import "./errors.js";

export function requireNodeOperationHttps(c: Context): void {
  const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
  if (!(socket instanceof TLSSocket) || !socket.encrypted || !sentFromThisOrigin(c))
    throw new AppError("authorization.not_permitted", { permission: "node.manage" });
}
