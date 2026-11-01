import type { MiddlewareHandler } from "hono";
import type { TradingAdmission } from "./trading-admission.js";

const managementRoutes: Readonly<Record<string, readonly string[]>> = {
  GET: [
    "locales",
    "session/me",
    "google/config",
    "google/callback",
    "passkey/signals",
    "venue-details/time-zone-repair",
  ],
  POST: [
    "session",
    "password-reset",
    "account-actions/inspect",
    "account-actions/complete",
    "passkey/auth/options",
    "passkey/auth/verify",
    "passkey/register/options",
    "passkey/register/verify",
    "session/me/passkey-offer",
    "google/login",
    "venue-details/time-zone-repair",
  ],
  DELETE: ["session"],
};

export function zoneRepairGate(admission: TradingAdmission): MiddlewareHandler {
  return async (c, next) => {
    const { method, path } = c.req;
    const management =
      managementRoutes[method]?.some((route) => path === `/management-api/${route}`) === true;
    const read =
      method === "GET" &&
      (path === "/health" ||
        path === "/api/node" ||
        path === "/manage" ||
        path.startsWith("/manage/") ||
        path.startsWith("/help/"));
    // The webhook must verify its signature before its own closed-admission write check.
    if (management || read || (method === "POST" && path === "/webhooks/stripe")) return next();
    c.header("cache-control", "no-store");
    return c.json(
      {
        error: {
          code: "venue.time_zone_not_ready",
          params: { reason: admission.snapshot().state },
        },
      },
      409,
    );
  };
}
