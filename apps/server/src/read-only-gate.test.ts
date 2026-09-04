// A pure Hono unit test — NO database. apps/server's vitest globalSetup boots one shared Postgres
// container for the package's real-PG suites, but this suite touches none of it: it mounts the gate
// on a bare Hono app and drives it with `app.request(...)`, so nothing here reads `db`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readOnlyGate } from "./read-only-gate.js";

function appWith(isReadOnly: () => boolean): Hono {
  const app = new Hono();
  app.use("*", readOnlyGate(isReadOnly));
  app.get("/thing", (c) => c.json({ ok: true }));
  app.post("/thing", (c) => c.json({ wrote: true }));
  return app;
}

describe("readOnlyGate", () => {
  it("refuses a non-GET with node.read_only 403 when the node is a mirror", async () => {
    const res = await appWith(() => true).request("/thing", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });

  it("lets a GET through on a mirror", async () => {
    const res = await appWith(() => true).request("/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets every method through on a primary", async () => {
    const res = await appWith(() => false).request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrote: true });
  });

  it("gates on the boolean predicate, independent of any mode — POST refused when true, allowed when false", async () => {
    expect((await appWith(() => true).request("/thing", { method: "POST" })).status).toBe(403);
    expect((await appWith(() => false).request("/thing", { method: "POST" })).status).toBe(200);
  });

  it("reads the predicate per request (the promotion seam)", async () => {
    const holder = { readOnly: true };
    const app = appWith(() => holder.readOnly);
    expect((await app.request("/thing", { method: "POST" })).status).toBe(403);
    holder.readOnly = false; // promote — no re-mount
    expect((await app.request("/thing", { method: "POST" })).status).toBe(200);
  });
});
