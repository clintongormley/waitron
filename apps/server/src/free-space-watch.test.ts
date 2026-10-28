import { describe, expect, it, vi } from "vitest";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { createDiskFullState, type DiskFullState } from "./disk-full-state.js";
import type { Statfs } from "./free-bytes.js";
import {
  createFreeSpaceState,
  FREE_SPACE_CHECK_MS,
  SPACE_LOW_BYTES,
  SPACE_OK_BYTES,
  startFreeSpaceWatch,
  type FreeSpaceState,
} from "./free-space-watch.js";
import type { Logger, LogLevel } from "./logger.js";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const DIR = "/venue";

type Line = [LogLevel, string, Record<string, unknown> | undefined];

function logSpy() {
  const lines: Line[] = [];
  const log: Logger = (level, event, fields) => lines.push([level, event, fields]);
  const events = (event: string) => lines.filter((line) => line[1] === event);
  return { lines, log, events };
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 22, 12, minute));
}

describe("createFreeSpaceState", () => {
  it("starts with nothing read", () => {
    const { lines, log } = logSpy();
    const state = createFreeSpaceState({ log });
    expect(state.current()).toEqual({ freeBytes: null, readAt: null, lowSince: null });
    expect(lines).toEqual([]);
  });

  it("warns from just under 2 GiB, not at it, since that reading", () => {
    const { lines, log } = logSpy();
    const state = createFreeSpaceState({ log });
    state.record(SPACE_LOW_BYTES, at(1));
    expect(state.current().lowSince).toBeNull();
    state.record(SPACE_LOW_BYTES - 1, at(2));
    expect(state.current()).toEqual({
      freeBytes: SPACE_LOW_BYTES - 1,
      readAt: at(2),
      lowSince: at(2),
    });
    expect(lines).toEqual([
      ["info", "storage.free_space_read", { freeBytes: SPACE_LOW_BYTES }],
      ["warn", "storage.space_low", { freeBytes: SPACE_LOW_BYTES - 1 }],
    ]);
  });

  it("keeps the warning, and when it began, until 2.5 GiB is free", () => {
    const { lines, log } = logSpy();
    const state = createFreeSpaceState({ log });
    state.record(GIB, at(1));
    state.record(SPACE_OK_BYTES - 1, at(2));
    expect(state.current().lowSince).toEqual(at(1));
    expect(state.current().freeBytes).toBe(SPACE_OK_BYTES - 1);
    state.record(SPACE_OK_BYTES, at(3));
    expect(state.current().lowSince).toBeNull();
    expect(lines.at(-1)).toEqual(["info", "storage.space_ok", { freeBytes: SPACE_OK_BYTES }]);
  });

  it("a disk hovering at 2 GiB warns once", () => {
    const { log, events } = logSpy();
    const state = createFreeSpaceState({ log });
    for (let i = 0; i < 3; i += 1) {
      state.record(SPACE_LOW_BYTES - 1, at(2 * i + 1));
      state.record(SPACE_LOW_BYTES + 1, at(2 * i + 2));
    }
    expect(state.current().lowSince).toEqual(at(1));
    expect(events("storage.space_low")).toHaveLength(1);
    expect(events("storage.space_ok")).toHaveLength(0);
  });

  it("an unreadable reading keeps the last reading and the warning, and says so once", () => {
    const { log, events } = logSpy();
    const state = createFreeSpaceState({ log });
    state.record(GIB, at(1));
    state.record(null, at(2));
    state.record(null, at(3));
    expect(state.current()).toEqual({ freeBytes: GIB, readAt: at(1), lowSince: at(1) });
    expect(events("storage.free_space_unread")).toEqual([
      ["warn", "storage.free_space_unread", {}],
    ]);
    state.record(3 * GIB, at(4));
    expect(events("storage.free_space_read")).toEqual([
      ["info", "storage.free_space_read", { freeBytes: GIB }],
      ["info", "storage.free_space_read", { freeBytes: 3 * GIB }],
    ]);
    expect(events("storage.space_ok")).toEqual([
      ["info", "storage.space_ok", { freeBytes: 3 * GIB }],
    ]);

    const first = logSpy();
    createFreeSpaceState({ log: first.log }).record(null, at(1));
    expect(first.lines).toEqual([["warn", "storage.free_space_unread", {}]]);
  });

  it("logs nothing for readings that change nothing", () => {
    const { lines, log } = logSpy();
    const state = createFreeSpaceState({ log });
    for (let i = 0; i < 10; i += 1) state.record(10 * GIB, at(i));
    expect(lines).toEqual([["info", "storage.free_space_read", { freeBytes: 10 * GIB }]]);
  });

  it("turns on below 2,147,483,648 bytes and off at 2,684,354,560, as literal numbers", () => {
    const { log } = logSpy();
    const state = createFreeSpaceState({ log });
    state.record(2_147_483_648, at(1));
    expect(state.current().lowSince).toBeNull();
    state.record(2_147_483_647, at(2));
    expect(state.current().lowSince).toEqual(at(2));
    state.record(2_684_354_559, at(3));
    expect(state.current().lowSince).toEqual(at(2));
    state.record(2_684_354_560, at(4));
    expect(state.current().lowSince).toBeNull();
  });
});

describe("startFreeSpaceWatch", () => {
  function watch(
    options: {
      disk?: Pick<DiskFullState, "noted" | "full">;
      statfs?: Statfs;
      log?: Logger;
      restoreSpare?: () => Promise<boolean>;
    } = {},
  ) {
    const spy = logSpy();
    const log = options.log ?? spy.log;
    const armed: { ms: number; fn: () => void; cancelled: boolean }[] = [];
    const seen: string[] = [];
    const reading = { free: 10 * GIB };
    const now = at(30);
    const state: FreeSpaceState = createFreeSpaceState({ log });
    const statfs: Statfs =
      options.statfs ??
      (async (dir) => {
        seen.push(dir);
        return { bavail: reading.free, frsize: 1 };
      });
    const handle = startFreeSpaceWatch({
      dir: DIR,
      state,
      disk: options.disk ?? { noted: () => false, full: async () => false },
      intervalMs: FREE_SPACE_CHECK_MS,
      now: () => now,
      log,
      statfs,
      ...(options.restoreSpare ? { restoreSpare: options.restoreSpare } : {}),
      timer: (ms, fn) => {
        const entry = { ms, fn, cancelled: false };
        armed.push(entry);
        return { cancel: () => (entry.cancelled = true) };
      },
    });
    const tick = async () => {
      const n = armed.length;
      armed.at(-1)!.fn();
      await vi.waitFor(() => expect(armed.length).toBe(n + 1));
    };
    return { handle, armed, seen, reading, now, state, tick, ...spy };
  }

  function realStop(free: { value: number | Promise<number> }) {
    const spy = logSpy();
    const diskStatfs = vi.fn<Statfs>(async () => ({ bavail: await free.value, frsize: 1 }));
    const disk = createDiskFullState({
      dir: DIR,
      now: () => at(0),
      log: spy.log,
      statfs: diskStatfs,
    });
    return { disk, diskStatfs, ...spy };
  }

  it("reads at once, then a minute after each reading", async () => {
    const w = watch();
    expect(w.armed).toEqual([{ ms: 0, fn: expect.any(Function), cancelled: false }]);
    await w.tick();
    expect(w.armed).toHaveLength(2);
    expect(w.armed[1]!.ms).toBe(60_000);
    await w.tick();
    await w.tick();
    expect(w.armed.map((entry) => entry.ms)).toEqual([0, 60_000, 60_000, 60_000]);
    expect(w.seen).toEqual([DIR, DIR, DIR]);
  });

  it("records each reading on the state", async () => {
    const w = watch();
    w.reading.free = GIB;
    await w.tick();
    expect(w.state.current().lowSince).toEqual(w.now);
    w.reading.free = 3 * GIB;
    await w.tick();
    expect(w.state.current().lowSince).toBeNull();
  });

  it("asks the stop to re-check only while it is noted", async () => {
    let noted = false;
    const disk = { noted: () => noted, full: vi.fn(async () => false) };
    const w = watch({ disk });
    await w.tick();
    await w.tick();
    expect(disk.full).not.toHaveBeenCalled();
    noted = true;
    await w.tick();
    expect(disk.full).toHaveBeenCalledTimes(1);
  });

  it("a noted stop lifts on the next reading once 16 MiB is free, with no write", async () => {
    const free: { value: number | Promise<number> } = { value: FULL_DISK_BYTES - 1 };
    const stop = realStop(free);
    const w = watch({ disk: stop.disk });
    stop.disk.noteRefused();
    await w.tick();
    expect(stop.disk.noted()).toBe(true);
    free.value = FULL_DISK_BYTES;
    await w.tick();
    expect(stop.disk.noted()).toBe(false);
    expect(stop.events("storage.disk_space_back")).toHaveLength(1);
  });

  it("never notes a refusal, however little is free", async () => {
    const stop = realStop({ value: 0 });
    const w = watch({ disk: stop.disk });
    w.reading.free = 0;
    await w.tick();
    await w.tick();
    expect(stop.disk.noted()).toBe(false);
  });

  it("stop cancels the armed timer, and a reading whose free-space read is in flight records and arms nothing", async () => {
    const first = watch();
    first.handle.stop();
    expect(first.armed[0]!.cancelled).toBe(true);

    let release!: (free: number) => void;
    const held = new Promise<number>((resolve) => (release = resolve));
    const w = watch({ statfs: async () => ({ bavail: await held, frsize: 1 }) });
    w.armed[0]!.fn();
    w.handle.stop();
    release(GIB);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(w.armed).toHaveLength(1);
    expect(w.state.current().freeBytes).toBeNull();
    expect(w.events("storage.space_low")).toHaveLength(0);
  });

  it("the watch's re-check goes through the stop's in-flight rule", async () => {
    let release!: (free: number) => void;
    const held = new Promise<number>((resolve) => (release = resolve));
    const stop = realStop({ value: held });
    const w = watch({ disk: stop.disk });
    stop.disk.noteRefused();
    w.armed[0]!.fn();
    await vi.waitFor(() => expect(stop.diskStatfs).toHaveBeenCalled());
    stop.disk.noteRefused();
    release(FULL_DISK_BYTES);
    await vi.waitFor(() => expect(w.armed).toHaveLength(2));
    expect(stop.disk.noted()).toBe(true);
    expect(stop.events("storage.disk_space_back")).toHaveLength(0);
  });

  it("each reading writes the spare back before it asks the stop to re-check", async () => {
    const calls: string[] = [];
    const disk = {
      noted: () => true,
      full: async () => {
        calls.push("full");
        return false;
      },
    };
    const restoreSpare = async () => {
      calls.push("restore");
      return false;
    };
    const w = watch({ disk, restoreSpare });
    await w.tick();
    await w.tick();
    expect(calls).toEqual(["restore", "full", "restore", "full"]);
  });

  it("a reading calls restoreSpare whether or not a stop is noted", async () => {
    const restoreSpare = vi.fn(async () => false);
    const w = watch({ restoreSpare });
    await w.tick();
    await w.tick();
    expect(restoreSpare).toHaveBeenCalledTimes(2);
  });

  it("a reading whose restore answered true records the free space read after it", async () => {
    let w: ReturnType<typeof watch> | undefined;
    const restoreSpare = async () => {
      w!.reading.free = 3 * GIB - 8 * MIB;
      return true;
    };
    w = watch({ restoreSpare });
    w.reading.free = 3 * GIB;
    await w.tick();
    expect(w.state.current().freeBytes).toBe(3 * GIB - 8 * MIB);
    expect(w.seen).toEqual([DIR, DIR]);
  });

  it("a reading whose restore answered false reads free space once", async () => {
    const w = watch({ restoreSpare: async () => false });
    await w.tick();
    expect(w.seen).toEqual([DIR]);
    expect(w.state.current().freeBytes).toBe(10 * GIB);
  });

  it("a restore that throws is logged as storage.spare_restore_failed, and the same reading still records and asks the stop to re-check", async () => {
    const disk = { noted: () => true, full: vi.fn(async () => true) };
    const restoreSpare = async (): Promise<boolean> => {
      throw Object.assign(new Error("no space"), { code: "ENOSPC" });
    };
    const w = watch({ disk, restoreSpare });
    await w.tick();
    expect(w.lines).toContainEqual(["warn", "storage.spare_restore_failed", { errno: "ENOSPC" }]);
    expect(w.state.current().freeBytes).toBe(10 * GIB);
    expect(disk.full).toHaveBeenCalledTimes(1);
    await w.tick();
    expect(disk.full).toHaveBeenCalledTimes(2);
  });

  it("after stop(), a reading in flight writes nothing back", async () => {
    let release!: (free: number) => void;
    const held = new Promise<number>((resolve) => (release = resolve));
    const restoreSpare = vi.fn(async () => true);
    const w = watch({ statfs: async () => ({ bavail: await held, frsize: 1 }), restoreSpare });
    w.armed[0]!.fn();
    w.handle.stop();
    release(GIB);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(restoreSpare).not.toHaveBeenCalled();
  });

  it("a stop during the restore records and arms nothing", async () => {
    let w: ReturnType<typeof watch> | undefined;
    const restoreSpare = async () => {
      w!.handle.stop();
      return true;
    };
    w = watch({ restoreSpare });
    w.armed[0]!.fn();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(w.armed).toHaveLength(1);
    expect(w.state.current().freeBytes).toBeNull();
  });

  it("a reading that throws is logged and the next is still armed", async () => {
    const disk = {
      noted: () => true,
      full: async (): Promise<boolean> => {
        throw new Error("boom");
      },
    };
    const w = watch({ disk });
    await w.tick();
    expect(w.lines).toContainEqual([
      "warn",
      "storage.free_space_check_failed",
      { errorCode: "unknown" },
    ]);
    expect(w.armed[1]!.ms).toBe(60_000);
  });
});
