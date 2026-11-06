import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import { readManagementSessionToken } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

export type TrustedOrigin = (origin: string) => Promise<boolean>;

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** An empty header is present and foreign, never absent: only `undefined` means not sent. */
export function sentFromThisOrigin(c: Context): boolean {
  const origin = c.req.header("Origin");
  const site = c.req.header("Sec-Fetch-Site");
  return (
    (origin === undefined || origin === new URL(c.req.url).origin) &&
    (site === undefined || site === "same-origin" || site === "none")
  );
}

/** A trusted page on another origin is taken whatever its `Sec-Fetch-Site`, which a browser
 * rightly calls `same-site` or `cross-site`. Rejects when `trusted` rejects. */
export async function sentFromOwnPage(c: Context, trusted: TrustedOrigin): Promise<boolean> {
  if (sentFromThisOrigin(c)) return true;
  const origin = c.req.header("Origin");
  if (origin === undefined || origin === "null" || origin === new URL(c.req.url).origin) {
    return false;
  }
  return trusted(origin);
}

/** SameSite ignores the port, so a page on another port of the box's own name carries the
 * manager's cookie; only a change carrying that cookie is judged, so a till on another server,
 * a webhook or the print agent posting without it passes. */
export function requireManagementChangeFromOwnPage(
  trusted: TrustedOrigin,
  log: Logger,
): MiddlewareHandler {
  return async (c, next) => {
    if (!CHANGES.has(c.req.method)) return next();
    if (readManagementSessionToken(c) === null) return next();
    let own = false;
    let lookupFailed = false;
    try {
      own = await sentFromOwnPage(c, trusted);
    } catch {
      lookupFailed = true;
    }
    if (own) return next();
    const err = new AppError("management.origin_refused", {});
    log("warn", err.code, {
      requestId: c.get("requestId"),
      method: c.req.method,
      origin: c.req.header("Origin") ?? null,
      site: c.req.header("Sec-Fetch-Site") ?? null,
      ...(lookupFailed ? { lookupFailed: true } : {}),
    });
    return c.json({ error: { code: err.code, params: err.params } }, 403);
  };
}
