import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { DEV_DEVICE_HEADER } from "./device-session.js";

/**
 * CORS for the venue's own origins only (till-reroute design §3.4). `origin` returning null makes
 * hono/cors emit no Allow-Origin header, so the browser blocks a stranger; an allowed origin is echoed
 * exactly (never `*` — credentials ride these requests). Same-origin requests carry no Origin header
 * and pass through unchanged.
 */
export function corsForVenue(allow: (origin: string) => Promise<boolean>): MiddlewareHandler {
  return cors({
    origin: async (origin) => ((await allow(origin)) ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", DEV_DEVICE_HEADER],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
}
