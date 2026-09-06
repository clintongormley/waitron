import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { corsForVenue } from "./cors.js";

function app(): Hono {
  const a = new Hono();
  a.use(
    "/api/*",
    corsForVenue((o) => Promise.resolve(o === "https://cloud.deli.test")),
  );
  a.post("/api/session", (c) => c.json({ ok: true }));
  a.get("/api/till", (c) => c.json({ ok: true }));
  return a;
}

describe("corsForVenue", () => {
  it("answers a preflight from an allowed origin with credentials, the content-type and dev-device headers", async () => {
    const res = await app().request("/api/session", {
      method: "OPTIONS",
      headers: {
        origin: "https://cloud.deli.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://cloud.deli.test");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "content-type",
    );
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "x-waitron-dev-device",
    );
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("emits no Access-Control-Allow-Origin for a stranger (the browser then blocks)", async () => {
    const res = await app().request("/api/till", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    // The precise fact: no Allow-Origin, so the browser blocks. A stranger DOES still get Vary and
    // Allow-Credentials from hono/cors — only the Allow-Origin echo is withheld.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves a same-origin request (no Origin header) untouched", async () => {
    const res = await app().request("/api/till");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    // No Origin header ⇒ the middleware adds NOTHING (§3.4 "untouched"): no Vary, no
    // Allow-Credentials — hono/cors is never entered.
    expect(res.headers.get("vary")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("passes a no-Origin request through without consulting the allow-list, even if it would throw", async () => {
    const allow = vi.fn(() => Promise.reject(new Error("allow-list must not be consulted")));
    const a = new Hono();
    a.use("/api/*", corsForVenue(allow));
    a.get("/api/till", (c) => c.json({ ok: true }));
    const res = await a.request("/api/till");
    // The route runs (200), not a 500 from the rejected read, and the allow predicate was never called.
    expect(res.status).toBe(200);
    expect(allow).not.toHaveBeenCalled();
  });
});
