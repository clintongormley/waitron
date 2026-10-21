import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TradingAdmission } from "./trading-admission.js";
import { zoneRepairGate } from "./zone-repair-serving.js";

const allowed = [
  ["GET", "/management-api/locales"],
  ["GET", "/management-api/session/me"],
  ["GET", "/management-api/google/config"],
  ["GET", "/management-api/google/callback"],
  ["GET", "/management-api/passkey/signals"],
  ...[
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
  ].map((path) => ["POST", `/management-api/${path}`] as const),
  ["DELETE", "/management-api/session"],
  ["GET", "/management-api/venue-details/time-zone-repair"],
  ["POST", "/management-api/venue-details/time-zone-repair"],
  ["GET", "/manage"],
  ["GET", "/manage/account?token=synthetic"],
  ["GET", "/manage/assets/app.js"],
  ["GET", "/help/en/time-zone"],
  ["GET", "/health"],
  ["GET", "/api/node"],
  ["POST", "/webhooks/stripe"],
] as const;
const denied = [
  ["GET", "/management-api/venue-details"],
  ["GET", "/management-api/reports"],
  ["GET", "/management-api/alerts"],
  ["GET", "/management-api/live"],
  ["PUT", "/management-api/session/me/locale"],
  ["POST", "/management-api/persons"],
  ["GET", "/api/clock/state"],
  ["POST", "/api/pay"],
  ["POST", "/api/bills/1/pay"],
  ["POST", "/management-api/venue-details/time-zone-repair/force"],
  ["PUT", "/management-api/venue-details/time-zone-repair"],
  ["GET", "/management-api/locales/extra"],
  ["GET", "/management-api/locales%2fextra"],
  ["POST", "/manage"],
  ["DELETE", "/help/en/time-zone"],
  ["POST", "/webhooks/stripe/extra"],
  ["GET", "/webhooks/stripe"],
  ["GET", "/"],
  ["GET", "/management-api/new-future-read"],
  ["POST", "/new-future-mutation"],
] as const;
function appFor(state: "missing" | "invalid" | "restart_required") {
  const admission = new TradingAdmission();
  if (state === "restart_required") admission.requireRestart();
  else admission.repairOnly(state);
  const app = new Hono();
  app.use("*", zoneRepairGate(admission));
  app.all("*", (c) => c.text("reached"));
  return app;
}
describe("repair-only serving", () => {
  it.each(allowed)(
    "retains %s %s for its own authentication and signature checks",
    async (method, path) => {
      const response = await appFor("invalid").request(path, { method });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("reached");
    },
  );
  for (const state of ["missing", "invalid", "restart_required"] as const) {
    it.each(denied)(
      `${state} refuses %s %s before the application handler`,
      async (method, path) => {
        const response = await appFor(state).request(path, { method });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: { code: "venue.time_zone_not_ready", params: { reason: state } },
        });
        expect(response.headers.get("cache-control")).toBe("no-store");
      },
    );
  }
});
