import { Hono, type Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const gate = createHandoverGate({ notCounted: (c) => c.req.path === "/events" });
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
  app.get("/events", (c) => held(c, "events"));
  app.get("/fast", (c) => c.json({ ok: true }));
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

  it("an event stream is not counted", async () => {
    const r = rig();
    const res = r.app.request("/events");
    await entered(r, "events");
    expect(await r.gate.settled(1_000)).toEqual({ remaining: [] });
    r.holds.get("events")!.release();
    await res;
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

    const refused = await r.app.request("/fast");
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
    r.gate.close({
      allowed: (c) => c.req.path === "/slow",
      self: undefined as unknown as Context,
    });
    const res = r.app.request("/slow?n=allowed");
    await entered(r, "slow:allowed");
    expect(await r.gate.settled(1_000)).toEqual({ remaining: [] });
    r.holds.get("slow:allowed")!.release();
    expect((await res).status).toBe(200);
  });

  it("is open until closed", async () => {
    const r = rig();
    expect(r.gate.isClosed()).toBe(false);
    expect((await r.app.request("/fast")).status).toBe(200);
  });

  it("a request inside before close still completes after it", async () => {
    const r = rig();
    const inside = r.app.request("/slow?n=inside");
    await entered(r, "slow:inside");
    r.gate.close({ allowed: () => false, self: undefined as unknown as Context });
    const settled = r.gate.settled(60_000);
    r.holds.get("slow:inside")!.release();
    const res = await inside;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: "slow:inside" });
    expect(await settled).toEqual({ remaining: [] });
  });

  it("the closing request is not waited for", async () => {
    const r = rig();
    const closer = r.app.request("/slow?n=closer", { method: "POST" });
    await entered(r, "post:closer");
    r.gate.close({ allowed: () => false, self: r.contexts.get("post:closer")! });
    expect(await r.gate.settled(1_000)).toEqual({ remaining: [] });
    // Its own finally must not drive the count below zero and hide a later request.
    r.holds.get("post:closer")!.release();
    expect((await closer).status).toBe(200);
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
