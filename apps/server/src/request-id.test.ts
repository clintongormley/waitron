import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { requestIdMiddleware, sanitizeRequestId } from "./request-id.js";

const at = () => new Date("2026-08-31T10:00:00.000Z");

describe("sanitizeRequestId", () => {
  it("accepts an allowlisted id and rejects (returns null) control chars, over-length, empty and absent", () => {
    expect(sanitizeRequestId("abc-123.DEF_9")).toBe("abc-123.DEF_9");
    expect(sanitizeRequestId("bad\nid; rm -rf")).toBeNull(); // contains disallowed chars
    expect(sanitizeRequestId("x".repeat(200))).toBeNull(); // too long
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId("")).toBeNull();
  });
});

describe("requestIdMiddleware", () => {
  const app = () => {
    const lines: string[] = [];
    const log = createLogger(
      (l) => lines.push(l),
      at,
      () => "debug",
    );
    const a = new Hono();
    a.use("*", requestIdMiddleware(log, at));
    a.post("/api/thing/:id", (c) => c.json({ requestId: c.get("requestId") }));
    return { a, lines };
  };

  it("generates an id, echoes it, exposes it in context", async () => {
    const { a } = app();
    const res = await a.request("/api/thing/42", { method: "POST" });
    const echoed = res.headers.get("x-request-id");
    expect(echoed).toMatch(/^[A-Za-z0-9._-]+$/);
    expect((await res.json()).requestId).toBe(echoed);
  });

  it("reuses a sanitisable client-supplied id", async () => {
    const { a } = app();
    const res = await a.request("/api/thing/42", {
      method: "POST",
      headers: { "x-request-id": "client-abc" },
    });
    expect(res.headers.get("x-request-id")).toBe("client-abc");
  });

  it("logs http.request with the route pattern, never the concrete path or query or body", async () => {
    const { a, lines } = app();
    await a.request("/api/thing/42?secret=shh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card: "4242424242424242" }),
    });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === "http.request");
    expect(entry.level).toBe("debug");
    expect(entry.routePath).toBe("/api/thing/:id");
    const blob = JSON.stringify(entry);
    expect(blob).not.toContain("42?secret");
    expect(blob).not.toContain("secret");
    expect(blob).not.toContain("4242424242424242");
  });
});
