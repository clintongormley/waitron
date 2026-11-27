import { getRequestListener } from "@hono/node-server";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { createServer, get, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createAdminShutdown } from "./admin-shutdown.js";
import { streamShutdownDownload } from "./admin-shutdown-download.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";

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

it("captures a new backup on Retry while sales stay paused", async () => {
  let passes = 0;
  let pauses = 0;
  const shutdown = createAdminShutdown({
    check: async () => {
      passes++;
      if (passes === 1) throw new Error("The backup destination is unavailable");
    },
    save: async () => {},
    clear: async () => {},
    pauseDuties: () => {
      pauses++;
      return { settled: Promise.resolve(), drainRefunds: async () => {}, resume() {} };
    },
  });
  const app = new Hono();
  app.use("*", shutdown.middleware);
  app.post("/sale", (c) => c.body(null, 204));
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    shutdown.resolvePaused("retry");
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("ready"));
    expect(passes).toBe(2);
    expect(pauses).toBe(1);
  } finally {
    await shutdown.close();
  }
});

it("writes the next-start hold only when the administrator chooses Shut down anyway", async () => {
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => (releaseSave = resolve));
  let marked = false;
  const shutdown = createAdminShutdown({
    check: async () => {
      throw new Error("The saved archive could not be opened");
    },
    save: async () => {
      await saving;
      marked = true;
    },
    clear: async () => {},
  });
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    expect(marked).toBe(false);
    shutdown.resolvePaused("shut-down-anyway");
    expect(shutdown.status().phase).toBe("checking");
    releaseSave();
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "ready", checked: false }));
    expect(marked).toBe(true);
  } finally {
    releaseSave();
    await shutdown.close();
  }
});

it.each([
  ["keeps the successful check when only the hold save fails", false, { phase: "ready" }],
  [
    "reports an unchecked backup after a later check fails",
    true,
    { phase: "ready", checked: false },
  ],
])("%s", async (_scenario, retry, outcome) => {
  let saves = 0;
  let checks = 0;
  const shutdown = createAdminShutdown({
    check: async () => {
      if (++checks === 2) throw new Error("The retry could not check the copy");
    },
    save: async () => {
      if (++saves === 1) throw new Error("The shutdown hold could not be saved");
    },
    clear: async () => {},
  });
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    if (retry) {
      shutdown.resolvePaused("retry");
      await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    }
    shutdown.resolvePaused("shut-down-anyway");
    await vi.waitFor(() => expect(shutdown.status()).toEqual(outcome));
    expect(checks).toBe(retry ? 2 : 1);
  } finally {
    await shutdown.close();
  }
});

it("clears a partly written shutdown hold when cancelling after a failed save", async () => {
  let mark = false;
  const shutdown = createAdminShutdown({
    check: async () => {
      throw new Error("The final backup failed");
    },
    save: async () => {
      mark = true;
      throw new Error("The hold could not be synced");
    },
    clear: async () => {
      mark = false;
    },
  });
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    shutdown.resolvePaused("shut-down-anyway");
    await vi.waitFor(() => expect(mark && shutdown.status().phase === "paused").toBe(true));
    await shutdown.cancel();
    expect(mark).toBe(false);
    expect(shutdown.status()).toEqual({ phase: "idle" });
  } finally {
    await shutdown.close();
  }
});

it("holds sales until the named archive is delivered and the administrator confirms it", async () => {
  let marked = false;
  let removed = false;
  const name = "final-backup.wbackup";
  const shutdown = createAdminShutdown({
    check: async () => ({
      name,
      path: "/private/checked-archive",
      bytes: 123,
      remove: async () => {
        removed = true;
      },
    }),
    save: async () => {
      marked = true;
    },
    clear: async () => {},
  });
  const app = new Hono();
  app.use("*", shutdown.middleware);
  app.post("/sale", (c) => c.body(null, 204));
  try {
    shutdown.start();
    await vi.waitFor(() =>
      expect(shutdown.status()).toEqual({ phase: "download", name, bytes: 123, delivered: false }),
    );
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    const interrupted = await shutdown.beginDownload(name);
    interrupted.finish(false);
    expect(() => shutdown.confirmDownload(name)).toThrow(
      expect.objectContaining({ code: "box.shutdown_in_progress" }),
    );
    const transfer = await shutdown.beginDownload(name);
    transfer.finish(true);
    expect(() => shutdown.confirmDownload("earlier-backup.wbackup")).toThrow(
      expect.objectContaining({ code: "box.shutdown_in_progress" }),
    );
    expect(marked).toBe(false);
    shutdown.confirmDownload(name);
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "ready" }));
    expect({ marked, removed }).toEqual({ marked: true, removed: true });
  } finally {
    await shutdown.close();
  }
});

it("waits for an interrupted download to close before removing the archive and reopening sales", async () => {
  const name = "final-backup.wbackup";
  let removed = false;
  const shutdown = createAdminShutdown({
    check: async () => ({
      name,
      path: "/private/checked-archive",
      bytes: 123,
      remove: async () => {
        removed = true;
      },
    }),
    save: async () => {},
    clear: async () => {},
  });
  const app = new Hono();
  app.use("*", shutdown.middleware);
  app.post("/sale", (c) => c.body(null, 204));
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("download"));
    const transfer = await shutdown.beginDownload(name);
    const cancelling = shutdown.cancel();
    try {
      expect(transfer.signal.aborted).toBe(true);
      expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
      expect(removed).toBe(false);
    } finally {
      transfer.finish(false);
      await cancelling;
    }
    expect(removed).toBe(true);
    expect((await app.request("/sale", { method: "POST" })).status).toBe(204);
  } finally {
    await shutdown.close();
  }
});

it.each(["cancels", "retries"] as const)(
  "closes the paused download when the administrator %s",
  async (action) => {
    const name = "checked.backup.enc";
    const bytes = 32 * 1024 * 1024;
    const folder = await mkdtemp(join(tmpdir(), "waitron-cancel-download-"));
    const path = join(folder, name);
    const shutdown = createAdminShutdown({
      check: async () => ({ name, path, bytes, remove: async () => {} }),
      save: async () => {},
      clear: async () => {},
    });
    const app = new Hono();
    app.get("/download", async (c) =>
      streamShutdownDownload(c, await shutdown.beginDownload(name)),
    );
    const server = createServer(getRequestListener(app.fetch));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await writeFile(path, "Checked backup");
      await truncate(path, bytes);
      const held = await retainHttpListener("127.0.0.1", server);
      shutdown.start();
      await vi.waitFor(() => expect(shutdown.status().phase).toBe("download"));
      const answer = await new Promise<IncomingMessage>((resolve, reject) => {
        get(`http://${held.host}:${held.port}/download`, { agent: false }, resolve).once(
          "error",
          reject,
        );
      });
      const closed = new Promise<void>((resolve) => answer.once("close", resolve));
      if (action === "cancels") await shutdown.cancel();
      else {
        const retry = await fetch(`http://${held.host}:${held.port}/download`);
        const bytesReceived = (await retry.arrayBuffer()).byteLength;
        expect(retry.status).toBe(200);
        expect(bytesReceived).toBe(bytes);
        await vi.waitFor(() =>
          expect(shutdown.status()).toMatchObject({ phase: "download", delivered: true }),
        );
      }
      answer.resume();
      await closed;
      expect(answer.complete).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      server.closeAllConnections();
      await shutdown.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(folder, { force: true, recursive: true });
    }
  },
);
