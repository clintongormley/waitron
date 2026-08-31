import { describe, expect, it, vi } from "vitest";
import { createDiagnosticsLog } from "./log.js";
import { createInstrumentedFetch, maskPath } from "./instrument-fetch.js";

describe("maskPath", () => {
  it("masks uuid and numeric segments", () => {
    expect(maskPath("/api/sales/123")).toBe("/api/sales/:id");
    expect(maskPath("/management-api/persons/2f1c8e2a-0000-4000-8000-000000000000")).toBe(
      "/management-api/persons/:id",
    );
    expect(maskPath("/management-api/layout")).toBe("/management-api/layout");
  });
});

describe("createInstrumentedFetch", () => {
  it("sets x-request-id and logs start/end without a body", async () => {
    const log = createDiagnosticsLog();
    let seenHeader: string | null = null;
    const base = vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeader = new Headers(init?.headers).get("x-request-id");
      return new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      makeId: () => "rid-1",
    });
    await f("http://box/api/sales/9", {
      method: "POST",
      body: JSON.stringify({ card: "4242424242424242" }),
    });
    expect(seenHeader).toBe("rid-1");
    const events = log.snapshot();
    expect(events.map((e) => e.fields.phase)).toEqual(["start", "end"]);
    const end = events.at(-1)!;
    expect(end.fields).toMatchObject({
      method: "POST",
      path: "/api/sales/:id",
      status: 200,
      requestId: "rid-1",
    });
    expect(JSON.stringify(events)).not.toContain("4242424242424242"); // body never recorded
  });

  it("captures the domain code on a failure via res.clone()", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "sale.void_forbidden" } }), { status: 403 }),
    );
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      makeId: () => "rid-2",
    });
    const res = await f("http://box/api/sales/void", { method: "POST" });
    expect(await res.json()).toEqual({ error: { code: "sale.void_forbidden" } }); // body still readable by #request
    expect(log.snapshot().at(-1)!.fields.code).toBe("sale.void_forbidden");
  });

  it("defaults makeId to crypto.randomUUID, the method to GET, and accepts a URL input", async () => {
    const log = createDiagnosticsLog();
    let seenHeader: string | null = null;
    const base = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      seenHeader = new Headers(init?.headers).get("x-request-id");
      return new Response("{}", { status: 200 });
    });
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log);
    await f(new URL("http://box/api/items/7"));
    expect(seenHeader).toMatch(/^[0-9a-f-]{36}$/i); // a crypto.randomUUID
    const end = log.snapshot().at(-1)!;
    expect(end.fields).toMatchObject({ method: "GET", path: "/api/items/:id", status: 200 });
    expect(end.fields.requestId).toBe(seenHeader);
  });

  it("resolves a relative url against baseUrl", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      baseUrl: "http://box",
      makeId: () => "rid-3",
    });
    await f("/api/users/5");
    expect(log.snapshot().at(-1)!.fields.path).toBe("/api/users/:id");
  });

  it("keeps the raw path when the url cannot be parsed", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      makeId: () => "rid-4",
    });
    // A Request object is neither a string nor a URL, so it falls to String(input), which then
    // fails URL parsing and exercises the raw-path fallback.
    await f(new Request("http://box/api/x"));
    expect(log.snapshot().at(-1)!.fields.requestId).toBe("rid-4");
  });

  it("captures no code when the error body is not JSON", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(async () => new Response("boom", { status: 500 }));
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      makeId: () => "rid-5",
    });
    await f("http://box/api/sales/1");
    const end = log.snapshot().at(-1)!;
    expect(end.level).toBe("warn");
    expect(end.fields).toMatchObject({ status: 500, path: "/api/sales/:id" });
    expect(end.fields.code).toBeUndefined();
  });

  it("logs an error and rethrows on a network failure", async () => {
    const log = createDiagnosticsLog();
    const base = vi.fn(async () => {
      throw new Error("down");
    });
    const f = createInstrumentedFetch(base as unknown as typeof fetch, log, {
      makeId: () => "rid-6",
    });
    await expect(f("http://box/api/ping")).rejects.toThrow("down");
    const end = log.snapshot().at(-1)!;
    expect(end.level).toBe("error");
    expect(end.fields).toMatchObject({ phase: "end", requestId: "rid-6", error: "network" });
  });
});
