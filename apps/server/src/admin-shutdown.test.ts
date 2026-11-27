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

function signalGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

it.each(["checked", "download", "unchecked", "save-failed"] as const)(
  "requests host power-off only after a saved hold (%s)",
  async (kind) => {
    const saving = signalGate();
    const saved = signalGate();
    const hostReply = signalGate();
    const removed = vi.fn(async () => {});
    const powerOff = vi.fn(async () => {
      await hostReply.promise;
      return { available: true } as const;
    });
    const archive = { name: "final.enc", path: "unused", bytes: 1, remove: removed };
    const actor = { source: "person", person: "00000000-0000-4000-8000-000000000111" } as const;
    const shutdown = createAdminShutdown({
      async check() {
        if (kind === "unchecked") throw new Error("Backup failed");
        if (kind === "download") return { archive };
      },
      async save() {
        saving.resolve();
        await saved.promise;
        if (kind === "save-failed") throw new Error("Mark write failed");
      },
      clear: async () => {},
      powerOff,
    });
    try {
      shutdown.start(actor);
      if (kind === "download") {
        await vi.waitFor(() => expect(shutdown.status().phase).toBe("download"));
        (await shutdown.beginDownload(archive.name)).finish(true);
        shutdown.confirmDownload(archive.name);
      }
      if (kind === "unchecked") {
        await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
        shutdown.resolvePaused("shut-down-anyway");
      }
      await saving.promise;
      expect(powerOff).not.toHaveBeenCalled();
      saved.resolve();
      if (kind === "save-failed") {
        await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
        await shutdown.close();
        expect(powerOff).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => expect(powerOff.mock.calls).toEqual([[actor]]));
        expect(shutdown.status()).toMatchObject({ phase: "ready", powerOff: "requesting" });
        if (kind === "download") expect(removed).toHaveBeenCalledOnce();
        await shutdown.close();
        hostReply.resolve();
        await vi.waitFor(() =>
          expect(shutdown.status()).toMatchObject({ phase: "ready", powerOff: "requested" }),
        );
        expect(powerOff).toHaveBeenCalledOnce();
      }
    } finally {
      saved.resolve();
      hostReply.resolve();
      await shutdown.close();
    }
  },
);

it.each([
  { available: false, reason: "missing", detail: "ENOENT" },
  { available: false, reason: "refused", refusal: "unknown_request" },
] as const)(
  "gives manual switch-off instructions on a box with no power-off service (%j)",
  async (answer) => {
    const powerOff = vi.fn(async () => answer);
    const shutdown = createAdminShutdown({
      check: async () => {},
      save: async () => {},
      clear: async () => {},
      powerOff,
    });
    shutdown.start({ source: "person", person: "00000000-0000-4000-8000-000000000111" });
    try {
      await vi.waitFor(() => expect(powerOff).toHaveBeenCalledOnce());
      expect(shutdown.status()).toEqual({ phase: "ready" });
    } finally {
      await shutdown.close();
    }
  },
);

it.each(["keep-waiting", "cancel", "shut-down-anyway"] as const)(
  "settles one stalled check when the administrator chooses %s",
  async (decision) => {
    const cleaned = signalGate();
    const order: string[] = [];
    const shutdown = createAdminShutdown({
      async check(signal, context) {
        order.push("captured");
        try {
          await context?.waitForUpload(signal);
          order.push("verified");
        } finally {
          await cleaned.promise;
          order.push("settled");
        }
      },
      save: async () => void order.push("saved"),
      clear: async () => {},
    });
    try {
      shutdown.start();
      await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "stalled" }));
      expect(order).toEqual(["captured"]);
      expect(() => shutdown.resolvePaused("retry")).toThrow();
      const cancelling = decision === "cancel" ? shutdown.cancel() : undefined;
      if (decision !== "cancel") shutdown.resolvePaused(decision);
      expect(shutdown.status().phase).not.toBe("ready");
      cleaned.resolve();
      await cancelling;
      if (decision === "cancel") {
        expect(shutdown.status()).toEqual({ phase: "idle" });
        expect(order).toEqual(["captured", "settled"]);
      } else {
        await vi.waitFor(() =>
          expect(shutdown.status()).toEqual(
            decision === "keep-waiting" ? { phase: "ready" } : { phase: "ready", checked: false },
          ),
        );
        expect(order).toEqual(
          decision === "keep-waiting"
            ? ["captured", "verified", "settled", "saved"]
            : ["captured", "settled", "saved"],
        );
      }
    } finally {
      cleaned.resolve();
      await shutdown.close();
    }
  },
);

it("removes the stall prompt when the last waiting upload expires", async () => {
  const first = new AbortController();
  const second = new AbortController();
  const firstSettled = signalGate();
  const secondSettled = signalGate();
  const cleaned = signalGate();
  const shutdown = createAdminShutdown({
    async check(_signal, { waitForUpload }) {
      await Promise.allSettled([
        waitForUpload(first.signal).finally(firstSettled.resolve),
        waitForUpload(second.signal).finally(secondSettled.resolve),
      ]);
      await cleaned.promise;
      throw new Error("The backup destinations timed out");
    },
    save: async () => {},
    clear: async () => {},
  });
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "stalled" }));
    first.abort();
    await firstSettled.promise;
    expect(shutdown.status()).toEqual({ phase: "stalled" });
    second.abort();
    await secondSettled.promise;
    expect(shutdown.status()).toEqual({ phase: "checking" });
    expect(() => shutdown.resolvePaused("keep-waiting")).toThrow(
      expect.objectContaining({ code: "box.shutdown_in_progress" }),
    );
    cleaned.resolve();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
  } finally {
    cleaned.resolve();
    await shutdown.close();
  }
});

it("captures a new backup on Retry while sales stay paused", async () => {
  let passes = 0;
  let pauses = 0;
  const shutdown = createAdminShutdown({
    check: async (_signal, { reportFailedDestination }) => {
      if (++passes === 1) {
        reportFailedDestination("/mnt/backup");
        throw new Error("The backup destination is unavailable");
      }
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
    await vi.waitFor(() =>
      expect(shutdown.view()).toMatchObject({ phase: "paused", failedDestination: "/mnt/backup" }),
    );
    expect(shutdown.status()).not.toHaveProperty("failedDestination");
    shutdown.resolvePaused("retry");
    expect((await app.request("/sale", { method: "POST" })).status).toBe(503);
    await vi.waitFor(() => expect(shutdown.view()).toEqual({ phase: "ready" }));
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

it("retries the spare check after checking a saved backup", async () => {
  const checkReplica = vi.fn().mockRejectedValueOnce(new Error("The spare is behind"));
  const check = vi.fn(async () => ({ checkReplica }));
  const save = vi.fn(async () => {});
  const shutdown = createAdminShutdown({ check, save, clear: async () => {} });
  try {
    shutdown.start();
    await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
    expect(save).not.toHaveBeenCalled();
    shutdown.resolvePaused("retry");
    await vi.waitFor(() => expect(shutdown.status()).toEqual({ phase: "ready" }));
    expect(check).toHaveBeenCalledTimes(1);
    expect(checkReplica).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    await shutdown.close();
  }
});

it.each(["retry", "cancel", "shut-down-anyway"] as const)(
  "keeps the hold absent after a spare check fails, then handles %s",
  async (decision) => {
    let backedUp = 0;
    let checkedSpare = 0;
    let marked = false;
    let removed = false;
    const name = "final.backup.enc";
    const shutdown = createAdminShutdown({
      async check() {
        backedUp += 1;
        return {
          archive: {
            name,
            path: "/unused",
            bytes: 10,
            remove: async () => {
              removed = true;
            },
          },
          async checkReplica() {
            if (++checkedSpare === 1) throw new Error("The spare did not confirm the upload");
          },
        };
      },
      save: async () => {
        marked = true;
      },
      clear: async () => {
        marked = false;
      },
    });
    try {
      shutdown.start(undefined, { paired: true, downloadOnly: true });
      expect(shutdown.view()).toEqual({ phase: "checking", paired: true, downloadOnly: true });
      await vi.waitFor(() => expect(shutdown.status().phase).toBe("download"));
      expect(checkedSpare).toBe(0);
      (await shutdown.beginDownload(name)).finish(true);
      shutdown.confirmDownload(name);
      await vi.waitFor(() => expect(shutdown.status().phase).toBe("paused"));
      expect(shutdown.view()).toMatchObject({ paired: true, downloadOnly: true });
      expect({ backedUp, checkedSpare, marked, removed }).toEqual({
        backedUp: 1,
        checkedSpare: 1,
        marked: false,
        removed: false,
      });
      if (decision === "cancel") {
        await shutdown.cancel();
        expect(shutdown.status()).toEqual({ phase: "idle" });
      } else {
        shutdown.resolvePaused(decision);
        await vi.waitFor(() =>
          expect(shutdown.status()).toEqual(
            decision === "retry" ? { phase: "ready" } : { phase: "ready", checked: false },
          ),
        );
      }
      expect({ backedUp, checkedSpare, marked, removed }).toEqual({
        backedUp: 1,
        checkedSpare: decision === "retry" ? 2 : 1,
        marked: decision !== "cancel",
        removed: true,
      });
    } finally {
      await shutdown.close();
    }
  },
);

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
      archive: {
        name,
        path: "/private/checked-archive",
        bytes: 123,
        remove: async () => {
          removed = true;
        },
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
    const active = await shutdown.beginDownload(name);
    const started = vi.fn();
    const retry = shutdown.beginDownload(name);
    void retry.then(started, started);
    await Promise.resolve();
    const startedBeforeClose = started.mock.calls.length;
    active.finish(false);
    const transfer = await retry.catch(() => undefined);
    transfer?.finish(true);
    expect(startedBeforeClose).toBe(0);
    expect(transfer).toBeDefined();
    const repeat = await shutdown.beginDownload(name);
    try {
      expect(() => shutdown.confirmDownload(name)).toThrow(
        expect.objectContaining({ code: "box.shutdown_in_progress" }),
      );
    } finally {
      repeat.finish(false);
    }
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
      archive: {
        name,
        path: "/private/checked-archive",
        bytes: 123,
        remove: async () => {
          removed = true;
        },
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
      check: async () => ({ archive: { name, path, bytes, remove: async () => {} } }),
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
