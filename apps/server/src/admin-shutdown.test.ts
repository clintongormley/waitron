import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createAdminShutdown } from "./admin-shutdown.js";

it.each(["request", "job"])("can cancel while an admitted %s is still running", async (kind) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const check = vi.fn(async () => {});
  const shutdown = createAdminShutdown({
    check,
    save: async () => {},
    clear: async () => {},
    pauseDuties: () => {
      entered();
      return { settled: held, drainRefunds: async () => {}, resume() {} };
    },
  });
  const app = new Hono();
  app.use("*", shutdown.middleware);
  app.post("/admitted", async (c) => {
    entered();
    await held;
    return c.body(null, 204);
  });
  app.post("/sale", (c) => c.body(null, 204));
  const request = kind === "request" ? app.request("/admitted", { method: "POST" }) : undefined;
  try {
    if (request) await started;
    shutdown.start();
    if (!request) await started;
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    const cancelling = shutdown.cancel();
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "idle" }));
    await cancelling;
    expect((await app.request("/sale", { method: "POST" })).status).toBe(204);
  } finally {
    release();
    await request;
    await shutdown.close();
  }
  expect(check).not.toHaveBeenCalled();
});

it("waits for admitted work and keeps new work out until Cancel has settled", async () => {
  let releaseWriter!: () => void;
  const held = new Promise<void>((resolve) => (releaseWriter = resolve));
  let entered!: () => void;
  const writing = new Promise<void>((resolve) => (entered = resolve));
  let startCheck!: () => void;
  const checking = new Promise<void>((resolve) => (startCheck = resolve));
  let releaseCheck!: () => void;
  const checkHeld = new Promise<void>((resolve) => (releaseCheck = resolve));
  const order: string[] = [];
  const shutdown = createAdminShutdown({
    async check(signal) {
      order.push("check started");
      startCheck();
      await checkHeld;
      signal.throwIfAborted();
    },
    save: async () => void order.push("saved"),
    clear: async () => {},
  });
  const app = new Hono();
  app.use("*", shutdown.middleware);
  app.post("/sale", async (c) => {
    entered();
    await held;
    order.push("writer finished");
    return c.text("recorded");
  });
  const sale = app.request("/sale", { method: "POST" });
  try {
    await writing;
    shutdown.start();
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    expect(order).toEqual([]);
    releaseWriter();
    expect(await (await sale).text()).toBe("recorded");
    await checking;
    const cancel = shutdown.cancel();
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    releaseCheck();
    await cancel;
    expect(shutdown.status()).toEqual({ phase: "idle" });
    expect((await app.request("/sale", { method: "POST" })).status).toBe(200);
    expect(order).toEqual(["writer finished", "check started", "writer finished"]);
  } finally {
    releaseWriter();
    releaseCheck();
    await shutdown.close();
    await sale;
  }
});
