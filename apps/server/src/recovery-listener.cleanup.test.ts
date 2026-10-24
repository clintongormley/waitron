import { mkdtemp, rm, unlink, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { serveRecovery } from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";
import { freePorts } from "./testing/free-ports.js";

const roots: string[] = [];
const listeners: Awaited<ReturnType<typeof serveRecovery>>[] = [];
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  for (const listener of listeners.splice(0)) await closeListener(listener).catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function listen(onClose: () => Promise<void>, log = vi.fn()) {
  const stateDir = await mkdtemp(join(tmpdir(), "repair-listener-cleanup-"));
  roots.push(stateDir);
  const [port] = await freePorts(1);
  const listener = await serveRecovery(new Hono(), {
    stateDir,
    port: port!,
    httpHost: "127.0.0.1",
    log,
    onClose,
  });
  listeners.push(listener);
  return { listener, stateDir, log };
}

it("does not finish closing until repair cleanup settles", async () => {
  const started = barrier(),
    release = barrier();
  const f = await listen(async () => {
    started.resolve();
    await release.promise;
  });
  let closed = false;
  const closing = closeListener(f.listener).then(() => {
    closed = true;
  });
  try {
    await started.promise;
    expect(closed).toBe(false);
  } finally {
    release.resolve();
    await closing;
  }
  expect(closed).toBe(true);
});

it("repeated closure removes an owned resource exactly once", async () => {
  const f = await listen(async () => {
    await unlink(marker);
  });
  const marker = join(f.stateDir, "private-copy");
  await writeFile(marker, "private bytes");
  await expect(closeListener(f.listener)).resolves.toBeUndefined();
  await expect(closeListener(f.listener)).resolves.toBeUndefined();
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([new Error("private cleanup detail"), "private cleanup detail"])(
  "reports cleanup failure to a waiting close caller (%j)",
  async (failure) => {
    const f = await listen(async () => {
      throw failure;
    });
    const closing = closeListener(f.listener);
    if (failure instanceof Error) await expect(closing).rejects.toBe(failure);
    else await expect(closing).rejects.toThrow("Recovery cleanup failed");
    expect(f.log.mock.calls.flat().join(" ")).not.toContain("private cleanup detail");
  },
);

it("logs only the fixed tag if cleanup fails without a close callback", async () => {
  const f = await listen(async () => {
    throw new Error("private cleanup detail");
  });
  f.listener.close();
  await vi.waitFor(() => expect(f.log).toHaveBeenCalledWith("warn", "recovery.cleanup_failed", {}));
  expect(JSON.stringify(f.log.mock.calls)).not.toContain("private cleanup detail");
});
