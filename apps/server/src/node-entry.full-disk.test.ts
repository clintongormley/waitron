import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { FRESH, levelFor, type RecoveryState } from "./recovery-state.js";
import { escapeHtml } from "./recovery-surface.js";
import { AppError } from "@waitron/shared";
import { lockVenueDatabase } from "@waitron/db";
import { dumpFileName } from "./backup-keys.js";
import { startFailureCode } from "./boot-failure.js";
import { recordedStartFailureCode, runEntry } from "./node-entry.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close: () => Promise<void> }>;
type Lock = <T>(stateDir: string, body: () => Promise<T>) => Promise<T>;

const SHARED_LOG_DIR = mkdtempSync(join(tmpdir(), "wt-entry-full-log-"));
// Real folders: below the floor the start deletes under the state folder's backup staging.
const STATE_DIR = realpathSync(mkdtempSync(join(tmpdir(), "wt-entry-full-state-")));
const VENUE_DIR = realpathSync(mkdtempSync(join(tmpdir(), "wt-entry-full-venue-")));
afterAll(async () => {
  for (const path of [SHARED_LOG_DIR, STATE_DIR, VENUE_DIR])
    await rm(path, { recursive: true, force: true });
});

function deps(
  over: Partial<Parameters<typeof runEntry>[0]> = {},
  free: (dir: string) => number = () => 5000,
) {
  return {
    args: [] as readonly string[],
    baseEnv: {},
    stateDir: STATE_DIR,
    venueDir: VENUE_DIR,
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
    expect(d.writeRecoveryState).toHaveBeenCalledWith(STATE_DIR, { ...FRESH, clears: 1 });

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
    expect(writeFailures.map(([, , fields]) => fields)).toEqual([
      { errorCode: "unknown", errno: null },
      { errorCode: "unknown", errno: null },
    ]);
    expect(failing.writeRecoveryState).not.toHaveBeenCalled();
  });

  it("logs a free-space read that finds nothing on either page it serves", async () => {
    let started = false;
    const atOnce = deps(
      {
        withRecoveryLock: () => {
          started = true;
          return Promise.reject(diskFull());
        },
      },
      () => 10,
    );
    vi.mocked(atOnce.statfs).mockImplementation(() =>
      started
        ? Promise.reject(new Error("statfs failed"))
        : Promise.resolve({ bavail: 10, frsize: 1 }),
    );
    await runEntry(atOnce);
    await servedApp(atOnce).request("/");
    expect(atOnce.log).toHaveBeenCalledWith("warn", "recovery.free_space_unreadable", {
      errno: null,
    });

    const level = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
    });
    await runEntry(level);
    vi.mocked(level.statfs).mockRejectedValue(new Error("statfs failed"));
    await servedApp(level).request("/");
    expect(level.log).toHaveBeenCalledWith("warn", "recovery.free_space_unreadable", {
      errno: null,
    });
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

/** A cut-off backup run's copy in the state folder's backup staging. */
async function stagedLeftover(): Promise<string> {
  const staged = join(STATE_DIR, "backup-staging", dumpFileName(new Date("2026-10-20T00:00:00Z")));
  await mkdir(join(STATE_DIR, "backup-staging"), { recursive: true });
  await writeFile(staged, "copy");
  dirs.push(join(STATE_DIR, "backup-staging"));
  return staged;
}

describe("an ordinary start with room", () => {
  it("deletes a cut-off backup run's copy in backup staging", async () => {
    const staged = await stagedLeftover();
    const d = deps({}, () => 100 * MIB);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(existsSync(staged)).toBe(false);
    expect(d.log).toHaveBeenCalledWith("info", "storage.backup_leftovers_deleted", { deleted: 1 });
  });

  it("keeps it while another process's holder is fresh", async () => {
    const staged = await stagedLeftover();
    const heartbeatAt = new Date().toISOString();
    const d = deps(
      {
        readVenueHolder: () => ({
          kind: "server",
          pid: process.pid + 1,
          host: "box",
          lockedAt: heartbeatAt,
          heartbeatAt,
        }),
      },
      () => 100 * MIB,
    );
    await runEntry(d);
    expect(existsSync(staged)).toBe(true);
  });
});

/** A state volume holding one `recovery.json`, so the test reads what the start persisted. */
function recoveryVolume() {
  let stored: RecoveryState = FRESH;
  return {
    current: () => stored,
    deps: {
      readRecoveryState: vi.fn(() => Promise.resolve(stored)),
      writeRecoveryState: vi.fn((_stateDir: string, next: RecoveryState) => {
        stored = next;
        return Promise.resolve();
      }),
    },
  };
}

/** The shape a full disk printed in F5 and F14. */
const diskIoError = () =>
  Object.assign(new Error("disk I/O error"), { errcode: 4874, code: "ERR_SQLITE_ERROR" });

const MIB = 1024 * 1024;

async function pageEvents(logDir: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(logDir, "waitron.log"), "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("a start that fails on a full disk", () => {
  it("records storage.disk_full for a database the engine cannot open below the floor", async () => {
    const { logDir } = await logsWithLeftover();
    const volume = recoveryVolume();
    const error = diskIoError();
    const d = deps(
      { ...volume.deps, logDir, startServer: vi.fn<StartServer>(() => Promise.reject(error)) },
      () => 10,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(volume.current()).toMatchObject({ lastErrorCode: "storage.disk_full", failures: 1 });
    const failed = (await pageEvents(logDir)).find((line) => line.event === "server.boot_failed");
    expect(failed?.errorCode).toBe("storage.disk_full");
  });

  it("keeps database_unreachable when there is room", async () => {
    const volume = recoveryVolume();
    const error = cannotOpen();
    const d = deps(
      { ...volume.deps, startServer: vi.fn<StartServer>(() => Promise.reject(error)) },
      () => 100 * MIB,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(volume.current().lastErrorCode).toBe("provisioning.database_unreachable");
  });

  it("deletes the leftovers when the failure was a full disk, even with room", async () => {
    const { logDir, leftover } = await logsWithLeftover();
    const seen: boolean[] = [];
    const error = diskFull();
    const d = deps(
      {
        logDir,
        writeRecoveryState: vi.fn(() => {
          seen.push(existsSync(leftover));
          return Promise.resolve();
        }),
        startServer: vi.fn<StartServer>(() => Promise.reject(error)),
      },
      () => 100 * MIB,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(existsSync(leftover)).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("deletes backup staging after a full-disk failure once its own hold of the venue folder is released", async () => {
    const staged = join(
      STATE_DIR,
      "backup-staging",
      dumpFileName(new Date("2026-10-20T00:00:00Z")),
    );
    await mkdir(join(STATE_DIR, "backup-staging"), { recursive: true });
    dirs.push(join(STATE_DIR, "backup-staging"));
    const error = diskFull();
    let reads = 0;
    const d = deps(
      {
        // Written after the clean-up every start runs, so only the full-disk one can delete it.
        readRecoveryState: vi.fn(async () => {
          if ((reads += 1) === 1) await writeFile(staged, "copy");
          return FRESH;
        }),
        lockVenue: lockVenueDatabase,
        startServer: vi.fn<StartServer>(() => Promise.reject(error)),
      },
      () => 100 * MIB,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(reads).toBeGreaterThan(0);
    expect(existsSync(staged)).toBe(false);
  });

  it("keeps backup staging after a full-disk failure while another process's holder is fresh", async () => {
    const staged = join(
      STATE_DIR,
      "backup-staging",
      dumpFileName(new Date("2026-10-20T00:00:00Z")),
    );
    await mkdir(join(STATE_DIR, "backup-staging"), { recursive: true });
    await writeFile(staged, "copy");
    dirs.push(join(STATE_DIR, "backup-staging"));
    const error = diskFull();
    const heartbeatAt = new Date().toISOString();
    const d = deps(
      {
        runStagedRestore: () => Promise.reject(error),
        readVenueHolder: () => ({
          kind: "server",
          pid: process.pid + 1,
          host: "box",
          lockedAt: heartbeatAt,
          heartbeatAt,
        }),
      },
      () => 100 * MIB,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(d.log).toHaveBeenCalledWith(
      "warn",
      "storage.start_space_low",
      expect.objectContaining({ deleted: expect.any(Number) }),
    );
    expect(existsSync(staged)).toBe(true);
  });

  it("deletes nothing for any other failure", async () => {
    const { logDir, leftover } = await logsWithLeftover();
    const error = new AppError("migrations.set_missing", { name: "core", folder: "/missing" });
    const d = deps(
      { logDir, startServer: vi.fn<StartServer>(() => Promise.reject(error)) },
      () => 100 * MIB,
    );
    await expect(runEntry(d)).rejects.toBe(error);
    expect(existsSync(leftover)).toBe(true);
  });

  it("hands on the code it recorded, even when deleting freed more than 16 MiB", async () => {
    const { logDir, leftover } = await logsWithLeftover();
    await writeFile(leftover, Buffer.alloc(20 * MIB));
    const volume = recoveryVolume();
    const statfs = vi.fn(() =>
      Promise.resolve({ bavail: existsSync(leftover) ? 10 : 100 * MIB, frsize: 1 }),
    );
    const d = deps({
      ...volume.deps,
      logDir,
      statfs,
      // Below the 10 bytes free, so the start's own clean-up leaves the leftover in place for the attempt to fail on.
      freeSpaceFloor: 1,
      startServer: vi.fn<StartServer>(() => Promise.reject(diskIoError())),
    });
    const error: unknown = await runEntry(d).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect(existsSync(leftover)).toBe(false);
    expect(volume.current().lastErrorCode).toBe("storage.disk_full");
    expect(recordedStartFailureCode(error)).toBe("storage.disk_full");
    // Why it is handed on: read again now, the freed space names the same failure unknown.
    expect(await startFailureCode(error, [STATE_DIR, VENUE_DIR], statfs)).toBe("unknown");

    const refused: unknown = await runEntry(deps({ args: ["x"] })).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(refused).toMatchObject({ code: "server.entry_arguments_refused" });
    expect(recordedStartFailureCode(refused)).toBeUndefined();
    expect(recordedStartFailureCode("a thrown string")).toBeUndefined();
  });
});
