import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { afterEach, describe, expect, it, vi } from "vitest";
import { corsForVenue } from "./cors.js";
import { createHandoverGate, type HandoverGate } from "./handover-gate.js";

function hold() {
  let release!: () => void;
  let arrive!: () => void;
  const wait = new Promise<void>((done) => (release = done));
  const entered = new Promise<void>((done) => (arrive = done));
  return { release, arrive, wait, entered };
}

function rig(): {
  app: Hono;
  gate: HandoverGate;
  holds: Map<string, ReturnType<typeof hold>>;
  contexts: Map<string, Context>;
} {
  const gate = createHandoverGate();
  const holds = new Map<string, ReturnType<typeof hold>>();
  const contexts = new Map<string, Context>();
  const app = new Hono();
  app.use("*", gate.middleware);
  const held = async (c: Context, name: string) => {
    const h = hold();
    holds.set(name, h);
    contexts.set(name, c);
    h.arrive();
    await h.wait;
    return c.json({ done: name });
  };
  app.get("/slow", (c) => held(c, `slow:${c.req.query("n") ?? ""}`));
  app.post("/slow", (c) => held(c, `post:${c.req.query("n") ?? ""}`));
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const h = hold();
      holds.set("events", h);
      await stream.writeSSE({ data: "open" });
      h.arrive();
      await h.wait;
    }),
  );
  app.get("/api/fast", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ healthy: true }));
  return { app, gate, holds, contexts };
}

async function entered(r: ReturnType<typeof rig>, name: string): Promise<void> {
  await vi.waitFor(() => expect(r.holds.has(name)).toBe(true));
  await r.holds.get(name)!.entered;
}

const pendingSettle = async (gate: HandoverGate): Promise<boolean> => {
  let done = false;
  void gate.settled(60_000).then(() => (done = true));
  await new Promise((r) => setTimeout(r, 10));
  return done;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createHandoverGate", () => {
  it("counts a request while it runs and not after", async () => {
    const r = rig();
    const res = r.app.request("/slow?n=1");
    await entered(r, "slow:1");
    expect(await pendingSettle(r.gate)).toBe(false);
    r.holds.get("slow:1")!.release();
    expect((await res).status).toBe(200);
    expect(await r.gate.settled(0)).toEqual({ remaining: [] });
  });

  it("an open event stream is not counted: its handler has returned its response", async () => {
    const r = rig();
    const res = await r.app.request("/events");
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data: open");
    await entered(r, "events");
    expect(await r.gate.settled(0)).toEqual({ remaining: [] });
    r.holds.get("events")!.release();
    await reader.read();
    expect((await reader.read()).done).toBe(true);
  });

  it("after close, a new request is refused 503 handover.stepping_down and an allowed one passes", async () => {
    const r = rig();
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "post:closer");
    r.gate.close({
      allowed: (c) => c.req.method === "GET" && c.req.path === "/health",
      self: r.contexts.get("post:closer")!,
    });
    expect(r.gate.isClosed()).toBe(true);

    const refused = await r.app.request("/api/fast");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({
      error: { code: "handover.stepping_down", params: {} },
    });

    const allowed = await r.app.request("/health");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ healthy: true });

    r.holds.get("post:closer")!.release();
    await closer;
  });

  it("an allowed request after close is not counted", async () => {
    const r = rig();
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "post:closer");
    r.gate.close({
      allowed: (c) => c.req.method === "GET" && c.req.path === "/slow",
      self: r.contexts.get("post:closer")!,
    });
    const res = r.app.request("/slow?n=allowed");
    await entered(r, "slow:allowed");
    expect(await r.gate.settled(1_000)).toEqual({ remaining: [] });
    r.holds.get("slow:allowed")!.release();
    r.holds.get("post:closer")!.release();
    expect((await res).status).toBe(200);
    expect((await closer).status).toBe(200);
  });

  it("is open until closed", async () => {
    const r = rig();
    expect(r.gate.isClosed()).toBe(false);
    expect((await r.app.request("/api/fast")).status).toBe(200);
  });

  it("a request inside before close still completes after it", async () => {
    const r = rig();
    const inside = r.app.request("/slow?n=inside");
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "slow:inside");
    await entered(r, "post:closer");
    r.gate.close({ allowed: () => false, self: r.contexts.get("post:closer")! });
    const settled = r.gate.settled(60_000);
    r.holds.get("slow:inside")!.release();
    const res = await inside;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: "slow:inside" });
    expect(await settled).toEqual({ remaining: [] });
    r.holds.get("post:closer")!.release();
    expect((await closer).status).toBe(200);
  });

  it("the closing request is not waited for", async () => {
    const r = rig();
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "post:closer");
    r.gate.close({ allowed: () => false, self: r.contexts.get("post:closer")! });
    expect(await r.gate.settled(1_000)).toEqual({ remaining: [] });
    r.holds.get("post:closer")!.release();
    expect((await closer).status).toBe(200);
  });

  it("the closing request finishing does not hide a request still inside", async () => {
    const r = rig();
    const other = r.app.request("/slow?n=other");
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "slow:other");
    await entered(r, "post:closer");
    r.gate.close({ allowed: () => false, self: r.contexts.get("post:closer")! });
    r.holds.get("post:closer")!.release();
    expect((await closer).status).toBe(200);
    expect(await r.gate.settled(50)).toEqual({ remaining: [{ method: "GET", path: "/slow" }] });
    r.holds.get("slow:other")!.release();
    expect((await other).status).toBe(200);
  });

  it("settled resolves at zero", async () => {
    const r = rig();
    const a = r.app.request("/slow?n=a");
    const b = r.app.request("/slow?n=b");
    await entered(r, "slow:a");
    await entered(r, "slow:b");
    let result: unknown = null;
    const settled = r.gate.settled(60_000).then((v) => (result = v));
    r.holds.get("slow:a")!.release();
    await a;
    await new Promise((done) => setTimeout(done, 10));
    expect(result).toBeNull();
    r.holds.get("slow:b")!.release();
    await b;
    await settled;
    expect(result).toEqual({ remaining: [] });
  });

  it("settled at the limit names each request still inside", async () => {
    const r = rig();
    const a = r.app.request("/slow?n=a");
    const b = r.app.request("/slow?n=b", { method: "POST" });
    await entered(r, "slow:a");
    await entered(r, "post:b");
    vi.useFakeTimers();
    let result: unknown = null;
    void r.gate.settled(5_000).then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({
      remaining: [
        { method: "GET", path: "/slow" },
        { method: "POST", path: "/slow" },
      ],
    });
    vi.useRealTimers();
    r.holds.get("slow:a")!.release();
    r.holds.get("post:b")!.release();
    await Promise.all([a, b]);
  });
});

it("close aborts the closed signal", () => {
  const gate = createHandoverGate();
  expect(gate.closed.aborted).toBe(false);
  gate.close({ allowed: () => false });
  expect(gate.closed.aborted).toBe(true);
});

describe("a closed gate's refusal across origins", () => {
  const ADMITTED = "https://other-box.example";
  const paymentPath = "/api/working-orders/bill-1/payments";
  function crossOriginRig(allow: (origin: string) => Promise<boolean>) {
    const gate = createHandoverGate({ cors: corsForVenue(allow) });
    let handled = 0;
    const app = new Hono();
    app.use("*", gate.middleware);
    app.post(paymentPath, (c) => {
      handled += 1;
      return c.json({ paid: true });
    });
    app.on("OPTIONS", paymentPath, (c) => {
      handled += 1;
      return c.body(null, 204);
    });
    app.post("/setup/thing", (c) => c.json({ ok: true }));
    gate.close({ allowed: () => false });
    return { app, handled: () => handled };
  }
  const preflight = (origin: string) => ({
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  const post = (origin: string) => ({
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  });

  it("answers an admitted origin's API preflight and gives its refusal the venue's CORS headers, running no route", async () => {
    const r = crossOriginRig((o) => Promise.resolve(o === ADMITTED));
    const asked = await r.app.request(paymentPath, preflight(ADMITTED));
    const refused = await r.app.request(paymentPath, post(ADMITTED));
    expect({
      preflight: {
        status: asked.status,
        allowOrigin: asked.headers.get("access-control-allow-origin"),
        allowCredentials: asked.headers.get("access-control-allow-credentials"),
        allowMethods: asked.headers.get("access-control-allow-methods"),
      },
      refused: {
        status: refused.status,
        body: await refused.json(),
        allowOrigin: refused.headers.get("access-control-allow-origin"),
        allowCredentials: refused.headers.get("access-control-allow-credentials"),
        cacheControl: refused.headers.get("cache-control"),
      },
      handled: r.handled(),
    }).toEqual({
      preflight: {
        status: 204,
        allowOrigin: ADMITTED,
        allowCredentials: "true",
        allowMethods: expect.stringContaining("POST"),
      },
      refused: {
        status: 503,
        body: { error: { code: "handover.stepping_down", params: {} } },
        allowOrigin: ADMITTED,
        allowCredentials: "true",
        cacheControl: "no-store",
      },
      handled: 0,
    });
  });

  it("names no allowed origin to a stranger, on its preflight or its refusal", async () => {
    const r = crossOriginRig((o) => Promise.resolve(o === ADMITTED));
    const asked = await r.app.request(paymentPath, preflight("https://stranger.example"));
    const refused = await r.app.request(paymentPath, post("https://stranger.example"));
    expect(asked.headers.get("access-control-allow-origin")).toBeNull();
    expect(refused.status).toBe(503);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    expect(r.handled()).toBe(0);
  });

  it("adds no CORS headers to a refusal outside the API", async () => {
    const r = crossOriginRig((o) => Promise.resolve(o === ADMITTED));
    const refused = await r.app.request("/setup/thing", post(ADMITTED));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still refuses when the origin list cannot be read", async () => {
    const r = crossOriginRig(() => Promise.reject(new Error("store closed")));
    const refused = await r.app.request(paymentPath, post(ADMITTED));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({
      error: { code: "handover.stepping_down", params: {} },
    });
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    expect(r.handled()).toBe(0);
  });
});

describe("a closed gate's page for a person", () => {
  function closedApp(close: { successorKnown?: boolean } = {}) {
    const gate = createHandoverGate();
    const app = new Hono();
    app.use("*", gate.middleware);
    app.get("*", (c) => c.text("app page"));
    gate.close({ allowed: () => false, ...close });
    return app;
  }

  function scriptOf(html: string): string {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const asking = scripts.filter((script) => script.includes("location.replace"));
    expect(asking).toHaveLength(1);
    return asking[0]!;
  }

  it.each(["/till/", "/till", "/devices"])(
    "answers GET %s with a page saying the box is standing down, asking again every 5 seconds",
    async (path) => {
      const res = await closedApp().request(path);
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("refresh")).toBeNull();
      expect(res.headers.get("vary")).toBe("Accept-Language");
      const html = await res.text();
      expect(html).toContain("<h1>This box is standing down</h1>");
      expect(html).toContain("<p>Another box now runs the venue.</p>");
      expect(html).toContain("<p>Restarting…</p>");
      const script = scriptOf(html);
      expect(script).toContain("location.pathname + location.search");
      expect(script).toContain('cache: "no-store"');
      expect(script).toContain('headers: { accept: "text/html" }');
      expect(script).toContain("AbortSignal.timeout(5000)");
      expect(script).toContain("response.ok");
      expect(script).toContain("setTimeout(ask, 5000)");
      const hash = createHash("sha256").update(script).digest("base64");
      const policy = res.headers.get("content-security-policy") ?? "";
      expect(policy).toContain("default-src 'none'");
      const directives = policy.split("; ");
      expect(directives).toContain("connect-src 'self'");
      const scriptSrc = directives
        .find((directive) => directive.startsWith("script-src "))!
        .split(" ")
        .slice(1);
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
      expect(scriptSrc).toHaveLength(2);
    },
  );

  it("answers HEAD on a page path with the page's status and headers", async () => {
    const res = await closedApp().request("/till/", { method: "HEAD" });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("refresh")).toBeNull();
  });

  it("speaks Spanish to a Spanish browser", async () => {
    const res = await closedApp().request("/till/", { headers: { "Accept-Language": "es" } });
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<h1>Este servidor se está retirando</h1>");
    expect(html).toContain("<p>Otro servidor lleva ahora el local.</p>");
    expect(html).toContain("<p>Reiniciando…</p>");
  });

  it.each([
    ["en", "This box is standing down", "Restarting…", "Another box now runs the venue."],
    [
      "es",
      "Este servidor se está retirando",
      "Reiniciando…",
      "Otro servidor lleva ahora el local.",
    ],
  ])(
    "names no other box when the gate was closed with no successor known (%s)",
    async (language, title, restarting, successor) => {
      const res = await closedApp({ successorKnown: false }).request("/till/", {
        headers: { "Accept-Language": language },
      });
      expect(res.status).toBe(503);
      const html = await res.text();
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(`<p>${restarting}</p>`);
      expect(html).not.toContain(successor);
      scriptOf(html);
    },
  );

  it.each([
    ["GET", "/api/orders"],
    ["GET", "/assets/app.js"],
    ["POST", "/till/"],
    ["POST", "/devices"],
  ])("keeps the JSON refusal for %s %s", async (method, path) => {
    const res = await closedApp().request(path, { method });
    expect(res.status).toBe(503);
    expect(res.headers.get("refresh")).toBeNull();
    expect(await res.json()).toEqual({ error: { code: "handover.stepping_down", params: {} } });
  });
});
