import { Hono } from "hono";
import { expect, it } from "vitest";
import { createAdminShutdown } from "./admin-shutdown.js";

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
