import { Hono } from "hono";
import { describe, expect, it } from "vitest";
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

  it("sets no CORS headers for a stranger (the browser then blocks)", async () => {
    const res = await app().request("/api/till", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves a same-origin request (no Origin header) untouched", async () => {
    const res = await app().request("/api/till");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
