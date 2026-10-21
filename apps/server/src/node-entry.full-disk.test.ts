import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRESH, levelFor, type RecoveryState } from "./recovery-state.js";
import { escapeHtml } from "./recovery-surface.js";
import { runEntry } from "./node-entry.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close: () => Promise<void> }>;
type Lock = <T>(stateDir: string, body: () => Promise<T>) => Promise<T>;

const SHARED_LOG_DIR = mkdtempSync(join(tmpdir(), "wt-entry-full-log-"));

function deps(
  over: Partial<Parameters<typeof runEntry>[0]> = {},
  free: (dir: string) => number = () => 5000,
) {
  return {
    args: [] as readonly string[],
    baseEnv: {},
    stateDir: "/state",
    venueDir: "/venue",
    assertNotAhead: vi.fn(() => Promise.resolve()),
    clearReplacedDatabases: vi.fn(() => Promise.resolve()),
    lockVenue: vi.fn(() => Promise.resolve({ release: () => {} })),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn<(stateDir: string) => Promise<RecoveryState>>(() =>
      Promise.resolve(FRESH),
    ),
    writeRecoveryState: vi.fn<(stateDir: string, state: RecoveryState) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    withRecoveryLock: (<T>(_stateDir: string, body: () => Promise<T>) => body()) as Lock,
    startServer: vi.fn<StartServer>(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn<(app: Hono, opts: unknown) => Promise<void>>(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    logDir: SHARED_LOG_DIR,
    statfs: vi.fn((dir: string) => Promise.resolve({ bavail: free(dir), frsize: 1 })),
    freeSpaceFloor: 1000,
    ...over,
  };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A log folder holding a rotated log the start may delete. */
async function logsWithLeftover(): Promise<{ logDir: string; leftover: string }> {
  const logDir = await mkdtemp(join(tmpdir(), "wt-entry-full-"));
  dirs.push(logDir);
  const leftover = join(logDir, "waitron.log.2");
  await writeFile(leftover, "old lines");
  return { logDir, leftover };
}

const diskFull = () => Object.assign(new Error("database or disk is full"), { errcode: 13 });
const cannotOpen = () => Object.assign(new Error("unable to open database file"), { errcode: 14 });
const rejectingLock =
  (error: Error): Lock =>
  () =>
    Promise.reject(error);

function servedApp(d: ReturnType<typeof deps>): Hono {
  expect(d.serveRecovery).toHaveBeenCalledTimes(1);
  return vi.mocked(d.serveRecovery).mock.calls[0]![0];
}

const TITLE = escapeHtml("The box's disk is full, so Waitron cannot save anything.");
const DELETED = escapeHtml(
  "The box has deleted what it could make again, and that was not enough.",
);

describe("a start below the free-space floor", () => {
  it("deletes the leftovers before it reads the count", async () => {
    const { logDir, leftover } = await logsWithLeftover();
    const seen: boolean[] = [];
    const d = deps(
      {
        logDir,
        readRecoveryState: vi.fn(() => {
          seen.push(existsSync(leftover));
          return Promise.resolve(FRESH);
        }),
      },
      () => 10,
    );
    await runEntry(d);
    expect(seen[0]).toBe(false);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.writeRecoveryState).mock.calls.map(([, state]) => state.failures)).toContain(
      1,
    );
  });

  it("deletes nothing for a refused argument", async () => {
    const { logDir, leftover } = await logsWithLeftover();
    const d = deps({ args: ["x"], logDir }, () => 10);
    await expect(runEntry(d)).rejects.toMatchObject({ code: "server.entry_arguments_refused" });
    expect(existsSync(leftover)).toBe(true);
    expect(d.statfs).not.toHaveBeenCalled();
  });

  it("uses 256 MiB when no floor is given", async () => {
    for (const [free, deleted] of [
      [268_435_455, true],
      [268_435_456, false],
    ] as const) {
      const { logDir, leftover } = await logsWithLeftover();
      const d = deps({ logDir }, () => free);
      delete (d as Partial<typeof d>).freeSpaceFloor;
      await runEntry(d);
      expect(existsSync(leftover)).toBe(!deleted);
    }
  });

  it("serves the recovery page at once when the count cannot be written on a full disk", async () => {
    const exit = vi.fn();
    const d = deps({ withRecoveryLock: rejectingLock(diskFull()), exit }, () => 10);
    await runEntry(d);
    expect(d.startServer).not.toHaveBeenCalled();
    expect(d.writeRecoveryState).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const app = servedApp(d);
    const page = await (await app.request("/")).text();
    expect(page).toContain(TITLE);
    expect(page).toContain(DELETED);
    expect(page).toContain("Free space on the box&#39;s disk: 0 MB.");
    const status = (await (await app.request("/recovery-api/status")).json()) as Record<
      string,
      unknown
    >;
    expect(status).toMatchObject({ lastErrorCode: "storage.disk_full", level: "recovery" });
  });

  it("logs the free space it read after the write failed", async () => {
    let failed = false;
    const d = deps(
      {
        withRecoveryLock: () => {
          failed = true;
          return Promise.reject(diskFull());
        },
      },
      () => (failed ? 20 : 10),
    );
    await runEntry(d);
    expect(d.log).toHaveBeenCalledWith("warn", "recovery.serving_disk_full", { freeBytes: 20 });
  });

  it("serves it too when the lock cannot be opened on a nearly full disk", async () => {
    const d = deps({ withRecoveryLock: rejectingLock(cannotOpen()) }, () => 10);
    await runEntry(d);
    const page = await (await servedApp(d).request("/")).text();
    expect(page).toContain(
      escapeHtml("Level: recovery. This start was not counted: the disk is full."),
    );
    expect(page).not.toContain("Failed 0 times");
    expect(d.log).toHaveBeenCalledWith("warn", "recovery.state_write_failed", {
      errorCode: "unknown",
      errno: null,
    });
  });

  it("still fails the start as today when the count cannot be written and there is room", async () => {
    const error = diskFull();
    const d = deps({ withRecoveryLock: rejectingLock(error) }, () => 5000);
    await expect(runEntry(d)).rejects.toBe(error);
    expect(d.serveRecovery).not.toHaveBeenCalled();
  });

  it("fails as today when the write fails with 14 between 16 and 256 MiB free", async () => {
    const error = cannotOpen();
    const lock = vi.fn(rejectingLock(error));
    const d = deps({ withRecoveryLock: lock as Lock }, () => 100 * 1024 * 1024);
    delete (d as Partial<typeof d>).freeSpaceFloor;
    await expect(runEntry(d)).rejects.toBe(error);
    expect(d.serveRecovery).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
  });

  it("fails as today when the count is refused for permission or a busy lock, even on a nearly full disk", async () => {
    const readonly = Object.assign(new Error("attempt to write a readonly database"), {
      errcode: 1544,
    });
    const busy = Object.assign(new Error("database is locked"), { errcode: 5 });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    for (const over of [
      { error: readonly, d: deps({ withRecoveryLock: rejectingLock(readonly) }, () => 10) },
      { error: busy, d: deps({ withRecoveryLock: rejectingLock(busy) }, () => 10) },
      {
        error: denied,
        d: deps({ writeRecoveryState: vi.fn(() => Promise.reject(denied)) }, () => 10),
      },
    ]) {
      await expect(runEntry(over.d)).rejects.toBe(over.error);
      expect(over.d.serveRecovery).not.toHaveBeenCalled();
    }
  });

  it("boots on a nearly full disk whose count can still be written", async () => {
    const d = deps({}, () => 10);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.writeRecoveryState).mock.calls[0]![1]).toEqual(FRESH);
    expect(vi.mocked(d.writeRecoveryState).mock.calls[1]![1]).toMatchObject({ failures: 1 });
  });

  it("writes nothing back when there is room", async () => {
    const d = deps({}, () => 5000);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(d.writeRecoveryState).toHaveBeenCalledTimes(1);
  });

  it("serves the full-disk page, not first-setup resolution, to a box whose first setup finished", async () => {
    const f = await firstFiscalFixture();
    try {
      let state = (await f.store.read())!;
      for (const change of [
        { kind: "activation-started" },
        { kind: "committed", result: {} },
        { kind: "publication" },
        { kind: "complete" },
      ] as const)
        state = await f.store.update(state.frozen.attemptId, state.revision, change);
      await mkdir(join(f.stateDir, "logs"), { recursive: true });

      const full = deps(
        {
          stateDir: f.stateDir,
          venueDir: f.venueDir,
          logDir: undefined,
          withRecoveryLock: rejectingLock(diskFull()),
        },
        () => 10,
      );
      await runEntry(full);
      const fullApp = servedApp(full);
      expect(await (await fullApp.request("/")).text()).toContain(TITLE);
      expect((await fullApp.request("/setup-api/status")).status).toBe(404);

      const room = deps({ stateDir: f.stateDir, venueDir: f.venueDir }, () => 10);
      await runEntry(room);
      expect((await servedApp(room).request("/setup-api/status")).status).toBe(200);
    } finally {
      await f.dispose();
    }
  });

  it("the page's Retry clears the count and exits, and exits even when the clear cannot be written", async () => {
    let calls = 0;
    const exit = vi.fn();
    const d = deps(
      {
        withRecoveryLock: (<T>(_stateDir: string, body: () => Promise<T>) =>
          (calls += 1) === 1 ? Promise.reject(diskFull()) : body()) as Lock,
        exit,
      },
      () => 10,
    );
    await runEntry(d);
    await servedApp(d).request("/recovery-api/retry", { method: "POST" });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(d.writeRecoveryState).toHaveBeenCalledWith("/state", { ...FRESH, clears: 1 });

    const failingExit = vi.fn();
    const failing = deps(
      { withRecoveryLock: rejectingLock(diskFull()), exit: failingExit },
      () => 10,
    );
    await runEntry(failing);
    await servedApp(failing).request("/recovery-api/retry", { method: "POST" });
    await vi.waitFor(() => expect(failingExit).toHaveBeenCalledWith(0));
    const writeFailures = vi
      .mocked(failing.log)
      .mock.calls.filter(([, event]) => event === "recovery.state_write_failed");
    expect(writeFailures).toHaveLength(2);
    expect(failing.writeRecoveryState).not.toHaveBeenCalled();
  });

  it("shows free space on the page a box at the recovery level serves", async () => {
    const d = deps(
      {
        readRecoveryState: vi.fn(() =>
          Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
        ),
      },
      () => 2_000_000,
    );
    await runEntry(d);
    expect(await (await servedApp(d).request("/")).text()).toContain(
      "Free space on the box&#39;s disk: 2 MB.",
    );
  });
});
