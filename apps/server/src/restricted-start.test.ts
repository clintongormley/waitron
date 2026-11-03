import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { StartedServer } from "./boot.js";
import { corsForVenue } from "./cors.js";
import { createHealthState } from "./health.js";
import { startRestricted } from "./restricted-start.js";

describe("startRestricted", () => {
  it("serves the routes it is handed beside the role probe, then listens", async () => {
    const app = new Hono();
    const listened: Hono[] = [];
    const started: StartedServer = {
      health: createHealthState(new Date()),
      close: () => Promise.resolve(),
    };
    const result = startRestricted({
      app,
      nodeId: "node-1",
      environment: "preproduction",
      readMembership: () => Promise.resolve(null),
      cors: corsForVenue(() => Promise.resolve(false)),
      routes: [(a) => a.get("/stand-in", (c) => c.text("ok"))],
      log: () => {},
      listen: (a) => {
        listened.push(a);
        return started;
      },
    });

    expect(result).toBe(started);
    expect(listened).toEqual([app]);
    const standIn = await app.request("/stand-in");
    expect(standIn.status).toBe(200);
    expect(await standIn.text()).toBe("ok");
    expect(await (await app.request("/api/node")).json()).toMatchObject({
      nodeId: "node-1",
      term: null,
      acceptingSales: false,
    });
  });

  it("answers a till on another of the venue's origins, and no stranger", async () => {
    const app = new Hono();
    startRestricted({
      app,
      nodeId: "node-1",
      environment: "preproduction",
      readMembership: () => Promise.resolve(null),
      cors: corsForVenue((origin) => Promise.resolve(origin === "https://m2.test")),
      routes: [(a) => a.post("/api/node/membership", (c) => c.json({ accepted: false }))],
      log: () => {},
      listen: () => ({ health: createHealthState(new Date()), close: () => Promise.resolve() }),
    });

    const probe = await app.request("/api/node", { headers: { origin: "https://m2.test" } });
    expect(probe.headers.get("access-control-allow-origin")).toBe("https://m2.test");
    const preflight = await app.request("/api/node/membership", {
      method: "OPTIONS",
      headers: {
        origin: "https://m2.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://m2.test");
    const post = await app.request("/api/node/membership", {
      method: "POST",
      headers: { origin: "https://m2.test", "content-type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(200);
    expect(post.headers.get("access-control-allow-origin")).toBe("https://m2.test");
    const stranger = await app.request("/api/node", { headers: { origin: "https://evil.test" } });
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
  });
});
