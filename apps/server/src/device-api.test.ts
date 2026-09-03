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
// connection. Every other device route — the ones that DO touch the database, RLS and permissions — is
// proven against real Postgres in `device-api.rls.test.ts` (CLAUDE.md §4: RLS/permission proofs need a
// non-superuser role, which neither PGlite nor a stub can show).
const noopLog: Logger = () => {};

function mountApp(): Hono {
  const app = new Hono();
  mountDeviceApi(
    app,
    {
      db: undefined as unknown as Database,
      cfg: undefined as unknown as TillConfig,
      secureCookies: false,
    },
    noopLog,
  );
  return app;
}

describe("mountDeviceApi — reset", () => {
  it("POST /api/device/reset clears the device cookie and 204s", async () => {
    const res = await mountApp().request("/api/device/reset", { method: "POST" });
    expect(res.status).toBe(204);
    // Mirrors device-session.test.ts's "clearDeviceCookie expires the cookie" assertion (~line 336):
    // the same cookie name, cleared (Max-Age=0) at the same matching Path.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEVICE_COOKIE}=`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/Path=\//i);
  });
});
