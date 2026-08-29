import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger, LogLevel } from "./logger.js";
// The registry augmentation for the codes these tests throw/answer (`tenant.not_found`,
// `session.required`, `server.internal`) — the reachability convention the API files follow.
import "./errors.js";

type Line = { level: LogLevel; event: string; fields: Record<string, unknown> };

/** A collecting logger — the same shape `till-api.test.ts` uses — so each test asserts on the REAL
 * structured lines the boundary emits, not on a mock. */
function collect(lines: Line[]): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

describe("createErrorBoundary (the shared error boundary till-api and management-api reuse)", () => {
  it("returns fn()'s response unchanged and logs nothing when fn resolves", async () => {
    const lines: Line[] = [];
    const boundary = createErrorBoundary({}, "widget.failed");
    const app = new Hono();
    app.get("/ok", (c) =>
      boundary(c, collect(lines), () => Promise.resolve(c.json({ ok: true }, 200))),
    );

    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The happy path touches the logger not at all.
    expect(lines).toEqual([]);
  });

  it("maps an AppError whose code IS in the map to that status and logs it at warn", async () => {
    const lines: Line[] = [];
    // A map assigning a NON-default status (404, not the `?? 400` fallback) proves the boundary
    // reads the map it was handed.
    const status: Record<string, ContentfulStatusCode> = { "tenant.not_found": 404 };
    const boundary = createErrorBoundary(status, "widget.failed");
    const id = randomUUID();
    const app = new Hono();
    app.get("/boom", (c) =>
      boundary(c, collect(lines), () => Promise.reject(new AppError("tenant.not_found", { id }))),
    );

    const res = await app.request("/boom");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "tenant.not_found", params: { id } } });
    // Logged at WARN with the code and its params (never the error's `.message`).
    expect(lines).toEqual([{ level: "warn", event: "tenant.not_found", fields: { id } }]);
  });

  it("maps an AppError whose code is mapped to 500 to that status but still logs it at warn", async () => {
    const lines: Line[] = [];
    // A server-fault AppError (a box that has lost its own secret files): the map assigns it 500, so
    // the RESPONSE is a structured 500 — but log severity keys off AppError-vs-not, not the status, so
    // a deliberate/expected AppError is logged at WARN even when re-emitted at a 5xx (the same
    // convention `setup-api.ts`'s `mirror.bundle_fetch_failed` → 502 follows). Only an unexpected
    // non-AppError takes the `error`/opaque-500 branch.
    const status: Record<string, ContentfulStatusCode> = { "recovery.state_incomplete": 500 };
    const boundary = createErrorBoundary(status, "widget.failed");
    const app = new Hono();
    app.get("/boom", (c) =>
      boundary(c, collect(lines), () =>
        Promise.reject(new AppError("recovery.state_incomplete", { missing: "trading.env" })),
      ),
    );

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "recovery.state_incomplete", params: { missing: "trading.env" } },
    });
    // Logged at WARN (AppError → warn regardless of the 5xx status), with the code and its params.
    expect(lines).toEqual([
      { level: "warn", event: "recovery.state_incomplete", fields: { missing: "trading.env" } },
    ]);
  });

  it("maps an AppError whose code is NOT in the map to 400 (the default) and logs it at warn", async () => {
    const lines: Line[] = [];
    // `session.required` is deliberately absent from this map, so it takes the `?? 400` fallback.
    const status: Record<string, ContentfulStatusCode> = { "tenant.not_found": 404 };
    const boundary = createErrorBoundary(status, "widget.failed");
    const app = new Hono();
    app.get("/boom", (c) =>
      boundary(c, collect(lines), () => Promise.reject(new AppError("session.required", {}))),
    );

    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "session.required", params: {} } });
    expect(lines).toEqual([{ level: "warn", event: "session.required", fields: {} }]);
  });

  it("maps a non-AppError to an opaque server.internal 500, logs it at error under the given tag, and NEVER leaks .message", async () => {
    const lines: Line[] = [];
    // A message a driver could load with a secret — the boundary must keep it off the wire.
    const secret = "postgres://user:s3cr3t@db.internal:5432/prod";
    const boundary = createErrorBoundary({}, "widget.failed");
    const app = new Hono();
    app.get("/crash", (c) => boundary(c, collect(lines), () => Promise.reject(new Error(secret))));

    const res = await app.request("/crash");
    expect(res.status).toBe(500);
    const raw = await res.text();
    // Only the opaque code — no params, and nothing of the caught value's `.message`.
    expect(JSON.parse(raw)).toEqual({ error: { code: "server.internal" } });
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("s3cr3t");
    // Logged at ERROR under the EXACT tag the factory was given, with `codeOf`'s classification of an
    // unclassified value ("unknown") — never the message.
    expect(lines).toEqual([
      { level: "error", event: "widget.failed", fields: { errorCode: "unknown" } },
    ]);
  });
});
