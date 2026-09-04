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
  it("refuses a non-GET with node.read_only 403 when read-only", async () => {
    const res = await appWith(() => true).request("/thing", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });

  it("lets a GET through when read-only", async () => {
    const res = await appWith(() => true).request("/thing");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets every method through when not read-only", async () => {
    const res = await appWith(() => false).request("/thing", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ wrote: true });
  });

  it("gates on the boolean predicate, independent of any mode — POST refused when true, allowed when false", async () => {
    expect((await appWith(() => true).request("/thing", { method: "POST" })).status).toBe(403);
    expect((await appWith(() => false).request("/thing", { method: "POST" })).status).toBe(200);
  });

  it("pins the SAFE_METHODS set when read-only — HEAD/OPTIONS pass the gate, other write verbs are refused", async () => {
    const app = appWith(() => true);
    // The two safe non-GET verbs the gate must let THROUGH (HEAD is a bodyless GET, OPTIONS a CORS
    // preflight): the gate does not 403 them. (Downstream routing may still 404 an unhandled OPTIONS —
    // that is not the gate's decision, so assert only that the gate did not block.)
    expect((await app.request("/thing", { method: "HEAD" })).status).not.toBe(403);
    expect((await app.request("/thing", { method: "OPTIONS" })).status).not.toBe(403);
    // Every other write verb is refused with node.read_only.
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect((await app.request("/thing", { method })).status).toBe(403);
    }
  });

  it("reads the predicate per request (the promotion seam)", async () => {
    const holder = { readOnly: true };
    const app = appWith(() => holder.readOnly);
    expect((await app.request("/thing", { method: "POST" })).status).toBe(403);
    holder.readOnly = false; // promote — no re-mount
    expect((await app.request("/thing", { method: "POST" })).status).toBe(200);
  });
});
