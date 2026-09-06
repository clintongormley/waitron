import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { DEV_DEVICE_HEADER } from "./device-session.js";

/**
 * CORS for the venue's own origins only (till-reroute design §3.4). `origin` returning null makes
 * hono/cors emit no Allow-Origin header, so the browser blocks a stranger; an allowed origin is echoed
 * exactly (never `*` — credentials ride these requests).
 *
 * A same-origin request carries no `Origin` header: it is passed straight through and hono/cors is
 * never entered, so the allow-list is not read (no DB cost, no failure dependency) and no Vary /
 * Allow-Credentials headers are added — "leaves a same-origin request untouched" (§3.4). Only a
 * request that DOES carry an Origin runs the CORS middleware.
 */
export function corsForVenue(allow: (origin: string) => Promise<boolean>): MiddlewareHandler {
  const middleware = cors({
    origin: async (origin) => ((await allow(origin)) ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", DEV_DEVICE_HEADER],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
  return (c, next) => (c.req.header("origin") === undefined ? next() : middleware(c, next));
}
