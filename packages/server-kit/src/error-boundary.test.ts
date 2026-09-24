import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger, LogLevel } from "./logger.js";
// This package's own registry augmentation (`management.request_invalid`, `management_session.required`).
import "./errors.js";

// Test-local codes, declared only so the fixtures typecheck; AppError validates nothing at runtime.
declare module "@waitron/shared" {
  interface ErrorParams {
    "tenant.not_found": { id: string };
    "session.required": Record<string, never>;
    "recovery.state_incomplete": { missing: string };
  }
}

type Line = { level: LogLevel; event: string; fields: Record<string, unknown> };

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
    expect(lines).toEqual([]);
  });

  it("maps an AppError whose code IS in the map to that status and logs it at warn", async () => {
    const lines: Line[] = [];
    // A NON-default status proves the boundary reads the map it was handed.
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
    expect(lines).toEqual([{ level: "warn", event: "tenant.not_found", fields: { id } }]);
  });

  it("maps an AppError whose code is mapped to 500 to that status but still logs it at warn", async () => {
    const lines: Line[] = [];
    // Log severity keys off AppError-vs-not, never the status.
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

  it("includes the request id on an AppError warn line", async () => {
    const lines: Line[] = [];
    const status: Record<string, ContentfulStatusCode> = { "tenant.not_found": 404 };
    const boundary = createErrorBoundary(status, "widget.failed");
    const app = new Hono();
    app.get("/boom", (c) => {
      // The request-id middleware seeds this on a real request.
      c.set("requestId", "req-xyz");
      return boundary(c, collect(lines), () =>
        Promise.reject(new AppError("tenant.not_found", { id: "s1" })),
      );
    });

    await app.request("/boom");
    const warn = lines.find((l) => l.level === "warn");
    expect(warn?.fields.requestId).toBe("req-xyz");
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
    expect(JSON.parse(raw)).toEqual({ error: { code: "server.internal" } });
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("s3cr3t");
    expect(lines).toEqual([
      { level: "error", event: "widget.failed", fields: { errorCode: "unknown" } },
    ]);
  });
});
