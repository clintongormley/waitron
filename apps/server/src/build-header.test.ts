import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildHeaderMiddleware } from "./build-header.js";

function app(): Hono {
  const a = new Hono();
  a.get("/health", (c) => c.json({ ok: true }));
  a.use("*", buildHeaderMiddleware("1c57940"));
  a.get("/api/staff", (c) => c.json([]));
  a.get("/manage/", (c) =>
    c.body("<html>dashboard</html>", 200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    }),
  );
  a.get("/raw", () => new Response("raw", { headers: { "x-own": "kept" } }));
  a.get("/boom", () => {
    throw new Error("boom");
  });
  return a;
}

describe("buildHeaderMiddleware", () => {
  it.each([
    ["/api/staff", 200],
    ["/manage/", 200],
    ["/raw", 200],
    ["/boom", 500],
    ["/nowhere", 404],
  ])("names the build on %s (%i)", async (path, status) => {
    const res = await app().request(path);
    expect(res.status).toBe(status);
    expect(res.headers.get("x-waitron-build")).toBe("1c57940");
  });

  it("keeps the headers and body of a handler that returns its own Response", async () => {
    const res = await app().request("/raw");
    expect(res.headers.get("x-own")).toBe("kept");
    expect(await res.text()).toBe("raw");
  });

  it("leaves a route registered before it without the header", async () => {
    const res = await app().request("/health");
    expect(res.headers.get("x-waitron-build")).toBeNull();
  });
});
