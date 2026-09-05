import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import type { Logger } from "./logger.js";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// No database at all — not PGlite, not real Postgres. The ONE route this file exercises,
// `POST /api/device/reset`, touches neither: it only calls `clearDeviceCookie` (device-session.ts),
// which writes a Set-Cookie header and returns — no `deps.db`/`deps.cfg` read anywhere on that path.
// `mountDeviceApi` itself never touches `db`/`cfg` at MOUNT time either (only inside the OTHER routes'
// handlers, which this suite never calls), so an untyped stub satisfies the signature without a live
// connection. Every other device route — the ones that DO touch the database and its permissions — is
// proven against real Postgres in `device-api.pg.test.ts` (CLAUDE.md §4: a privilege proof needs a
// non-superuser role, which neither PGlite nor a stub can show).
const noopLog: Logger = () => {};

// `devMode` is OPTIONAL so the omitted-flag case (production shape) is exercised too: the reset route
// is DEV-ONLY, mounted only under `devMode === true` and 404 otherwise — the same fail-closed shape the
// `GET`/`POST /api/dev/devices` tests prove in `device-api.pg.test.ts`.
function mountApp(devMode?: boolean): Hono {
  const app = new Hono();
  mountDeviceApi(
    app,
    {
      db: undefined as unknown as Database,
      cfg: undefined as unknown as TillConfig,
      secureCookies: false,
      devMode,
    },
    noopLog,
  );
  return app;
}

describe("mountDeviceApi — reset (dev-only)", () => {
  it("POST /api/device/reset clears the device cookie and 204s under devMode", async () => {
    const res = await mountApp(true).request("/api/device/reset", { method: "POST" });
    expect(res.status).toBe(204);
    // Mirrors device-session.test.ts's "clearDeviceCookie expires the cookie" assertion (~line 336):
    // the same cookie name, cleared (Max-Age=0) at the same matching Path.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEVICE_COOKIE}=`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  // The security gate (CLAUDE.md §5/§1): outside devMode the route DOES NOT EXIST, so an unauthenticated
  // cross-site cookie-clear cannot 401 a live till's sales. Mirrors the dev `GET`/`POST /api/dev/devices`
  // 404 proofs — false and omitted (the production shape) both 404.
  it("POST /api/device/reset is absent (404) when devMode is false", async () => {
    const res = await mountApp(false).request("/api/device/reset", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /api/device/reset is absent (404) when devMode is omitted — fail-closed production shape", async () => {
    const res = await mountApp().request("/api/device/reset", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
