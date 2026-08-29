// A pure Hono unit test — NO database. apps/server's vitest globalSetup boots one shared Postgres
// container for the package's real-PG suites, but this suite touches none of it: it mounts the gate
// on a bare Hono app and drives it with `app.request(...)`, so nothing here reads `db`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readOnlyGate } from "./read-only-gate.js";
import type { DeploymentMode } from "@waitron/db";

function appWith(mode: () => DeploymentMode): Hono {
  const app = new Hono();
  app.use("*", readOnlyGate(mode));
  app.get("/thing", (c) => c.json({ ok: true }));
  app.post("/thing", (c) => c.json({ wrote: true }));
  return app;
}

describe("readOnlyGate", () => {
  it("refuses a non-GET with node.read_only 403 when the node is a mirror", async () => {
    const res = await appWith(() => "mirror").request("/thing", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });

  it("lets a GET through on a mirror", async () => {
    const res = await appWith(() => "mirror").request("/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets every method through on a primary", async () => {
    const res = await appWith(() => "primary").request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrote: true });
  });

  it("reads the mode per request (the promotion seam)", async () => {
    const holder = { current: "mirror" as DeploymentMode };
    const app = appWith(() => holder.current);
    expect((await app.request("/thing", { method: "POST" })).status).toBe(403);
    holder.current = "primary"; // promote — no re-mount
    expect((await app.request("/thing", { method: "POST" })).status).toBe(200);
  });
});
