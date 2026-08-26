import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup } from "./setup-api.js";

const noopLog: Logger = () => {};

/** A logger that records every line, so the mount-time setup-mode signal can be asserted. */
function capturingLog(): {
  log: Logger;
  lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }>;
} {
  const lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  return { log, lines };
}

describe("mountSetup — setup-mode routes for an unprovisioned box", () => {
  it("reports unprovisioned status as JSON", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/setup-api/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    });
  });

  it("reflects the deployment environment it was given", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "production" }, noopLog);
    const res = await app.request("/setup-api/status");
    expect(await res.json()).toEqual({
      provisioned: false,
      environment: "production",
      needs: ["venue"],
    });
  });

  it("serves a setup placeholder page for any other path", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toMatch(/set ?up/i);
  });

  it("serves the placeholder for a deep unmatched path too, not only the root", async () => {
    const app = new Hono();
    mountSetup(app, { environment: "preproduction" }, noopLog);
    const res = await app.request("/anything/else");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toMatch(/set ?up/i);
  });

  it("does not shadow a route registered before it (e.g. /health)", async () => {
    const app = new Hono();
    app.get("/health", (c) => c.json({ ok: true }));
    mountSetup(app, { environment: "preproduction" }, noopLog);
    expect((await app.request("/health")).status).toBe(200);
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });

  it("logs one setup-mode signal, carrying the environment, when mounted", () => {
    const { log, lines } = capturingLog();
    mountSetup(new Hono(), { environment: "preproduction" }, log);
    const signal = lines.filter((l) => l.event === "setup.mode_active");
    expect(signal).toHaveLength(1);
    expect(signal[0]).toMatchObject({
      level: "info",
      fields: { environment: "preproduction" },
    });
  });
});
