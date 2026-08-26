import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Logger } from "./logger.js";
import { mountSpa } from "./spa-api.js";

const noopLog: Logger = () => {};

// A focused Hono-level test of the mount ORDER `boot.ts` uses — APIs first, then the two SPAs,
// dashboard (`/manage`) before till (`` = root catch-all, mounted LAST). A full `startServer`
// needs a database and a real container (see `boot.test.ts`); this proves the routing CONTRACT that
// actually matters without one: the till's root catch-all must not shadow the APIs or `/manage`.
// It is an ORDERING REGRESSION GUARD — it may pass on first write (Task 2's `mountSpa` is correct),
// and its value is that it goes RED if a future edit registers the catch-all before an API or
// mounts the till before the dashboard. Proven to bite by swapping the two `mountSpa` calls (the
// `/manage` request then falls through to the till catch-all and serves "till", not "dashboard").
describe("SPA mounting alongside API routes (boot order)", () => {
  let tillDir: string | undefined;
  let dashDir: string | undefined;

  beforeAll(() => {
    tillDir = mkdtempSync(join(tmpdir(), "waitron-till-"));
    dashDir = mkdtempSync(join(tmpdir(), "waitron-dash-"));
    writeFileSync(join(tillDir, "index.html"), "<html>till</html>");
    writeFileSync(join(dashDir, "index.html"), "<html>dashboard</html>");
    mkdirSync(join(dashDir, "assets"));
    writeFileSync(join(dashDir, "assets", "d-1.js"), "// dashboard asset");
  });

  afterAll(() => {
    // Guarded teardown (CLAUDE.md §4): a `beforeAll` that threw before `mkdtempSync` returned must
    // not be followed by an `rmSync(undefined)` reported as a second failure beside the real one.
    if (tillDir !== undefined) rmSync(tillDir, { recursive: true, force: true });
    if (dashDir !== undefined) rmSync(dashDir, { recursive: true, force: true });
  });

  const build = () => {
    const app = new Hono();
    // stand-ins for the real API + health routes, registered first exactly as boot.ts does
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/api/till", (c) => c.json({ api: "till" }));
    app.get("/management-api/staff-roster", (c) => c.json({ api: "management" }));
    // then the SPAs, dashboard (/manage) before till (/), as boot will mount them
    mountSpa(app, { root: dashDir!, basePath: "/manage" }, noopLog);
    mountSpa(app, { root: tillDir!, basePath: "" }, noopLog);
    return app;
  };

  it("routes /api and /management-api to the APIs, not the SPA catch-all", async () => {
    const app = build();
    expect(await (await app.request("/api/till")).json()).toEqual({ api: "till" });
    expect(await (await app.request("/management-api/staff-roster")).json()).toEqual({
      api: "management",
    });
    expect((await app.request("/health")).status).toBe(200);
  });

  it("serves the till at / and the dashboard at /manage", async () => {
    const app = build();
    expect(await (await app.request("/")).text()).toContain("till");
    expect(await (await app.request("/manage/")).text()).toContain("dashboard");
    expect(await (await app.request("/manage/assets/d-1.js")).text()).toContain("dashboard asset");
  });
});
