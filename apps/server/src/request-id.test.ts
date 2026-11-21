import { Hono } from "hono";
import { createErrorBoundary } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { createHandoverGate } from "./handover-gate.js";
import { readOnlyGate } from "./read-only-gate.js";
import "./errors.js";
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

  it.each([undefined, "client-abc", "bad id"])(
    "keeps the context and logged id on a route-created response with incoming id %s",
    async (incoming) => {
      const { a, lines } = app();
      a.get(
        "/raw",
        (c) => new Response(c.get("requestId"), { status: 201, headers: { "x-own": "kept" } }),
      );

      const res = await a.request("/raw", {
        headers: incoming === undefined ? {} : { "x-request-id": incoming },
      });
      const echoed = res.headers.get("x-request-id");
      if (incoming === "client-abc") expect(echoed).toBe("client-abc");
      else expect(echoed).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(res.status).toBe(201);
      expect(res.headers.get("x-own")).toBe("kept");
      expect(await res.text()).toBe(echoed);
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        {
          at: at().toISOString(),
          level: "debug",
          event: "http.request",
          requestId: echoed,
          method: "GET",
          routePath: "/raw",
          status: 201,
          durationMs: 0,
        },
      ]);
    },
  );

  it("puts the answered code and safe IDs on a warning for a refused request", async () => {
    const { a, lines } = app();
    const saleId = "2ecbbef3-e05d-4c56-9b52-81d596ebc74c";
    const deliveryId = "7a4c35e2-79e0-41c2-b0ac-64cfd6d91ef1";
    const run = createErrorBoundary({ "invoice_delivery.email_unavailable": 503 }, "sale.failed");
    a.post("/api/sales/:id/deliveries/:deliveryId/retry", (c) =>
      run(
        c,
        () => {},
        () => Promise.reject(new AppError("invoice_delivery.email_unavailable", {})),
      ),
    );
    const response = await a.request(
      `/api/sales/${saleId}/deliveries/${deliveryId}/retry?address=customer%40example.test`,
      { method: "POST", headers: { "x-request-id": "email-retry" } },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "invoice_delivery.email_unavailable", params: {} },
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        at: at().toISOString(),
        level: "warn",
        event: "http.request",
        requestId: "email-retry",
        method: "POST",
        routePath: `/api/sales/${saleId}/deliveries/${deliveryId}/retry?***`,
        status: 503,
        durationMs: 0,
        errorCode: "invoice_delivery.email_unavailable",
      },
    ]);
  });

  it.each([
    ["/api/sales/:id", "/api/sales/customer%40example.test"],
    ["/api/sales/:id", "/api/sales/https%3A%2F%2Fuser%3Apassword%40example.test"],
    ["/api/sales/:id", "/api/sales/2ecbbef3-e05d-4c56-9b52-81d596ebc74c%0A"],
    ["/management-api/staff/:id", "/management-api/staff/2ecbbef3-e05d-4c56-9b52-81d596ebc74c"],
    ["/api/*", "/api/customer%40example.test"],
  ])("keeps the template %s when the request path is %s", async (template, path) => {
    const { a, lines } = app();
    a.post(template, (c) => c.json({ ok: true }));
    expect((await a.request(path, { method: "POST" })).status).toBe(200);
    expect(JSON.parse(lines[0]!).routePath).toBe(template);
  });

  const handover = createHandoverGate();
  handover.close({ allowed: () => false });
  it.each([
    [403, "node.read_only", readOnlyGate(() => true)],
    [503, "handover.stepping_down", handover.middleware],
  ])("logs the code on a direct refusal with status %s", async (status, code, gate) => {
    const { a, lines } = app();
    a.use("*", gate);
    a.post("/api/sales/:id/reprint", (c) => c.text("should stay gated"));
    const path = "/api/sales/2ecbbef3-e05d-4c56-9b52-81d596ebc74c/reprint";
    const response = await a.request(path, { method: "POST" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, params: {} } });
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "warn",
      status,
      errorCode: code,
      routePath: "/api/sales/:id/reprint",
    });
  });

  it("logs http.request with the route pattern and a masked query", async () => {
    const { a, lines } = app();
    await a.request("/api/thing/42?secret=shh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card: "4242424242424242" }),
    });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.event === "http.request");
    expect(entry.level).toBe("debug");
    expect(entry.routePath).toBe("/api/thing/:id?***");
    const blob = JSON.stringify(entry);
    expect(blob).not.toContain("42?secret");
    expect(blob).not.toContain("secret");
    expect(blob).not.toContain("4242424242424242");
  });
});
