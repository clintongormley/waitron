import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { StartedServer } from "./boot.js";
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
});
