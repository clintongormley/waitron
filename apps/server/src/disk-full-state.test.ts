import { describe, expect, it } from "vitest";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import {
  createDiskFullState,
  diskFullRefusal,
  type DiskFullState,
  noteFullAtStart,
  watchForDiskFull,
} from "./disk-full-state.js";
import type { Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";

const DIR = "/venue";

function stubStatfs() {
  const stub = {
    calls: 0,
    answer: async (): Promise<{ bavail: number; frsize: number }> => ({ bavail: 0, frsize: 1 }),
    statfs: (async () => {
      stub.calls += 1;
      return stub.answer();
    }) as Statfs,
    free(bytes: number) {
      stub.answer = async () => ({ bavail: bytes, frsize: 1 });
    },
    fail() {
      stub.answer = async () => {
        throw new Error("statfs failed");
      };
    },
  };
  return stub;
}

function recordingLog() {
  const lines: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  return { log, lines, events: (event: string) => lines.filter((line) => line.event === event) };
}

function setup(options: { spareReleased?: () => Promise<boolean> } = {}) {
  const disk = stubStatfs();
  const logs = recordingLog();
  let current = new Date("2026-10-21T10:00:00.000Z");
  const clock = {
    now: () => current,
    set(at: Date) {
      current = at;
    },
  };
  const state = createDiskFullState({
    dir: DIR,
    now: clock.now,
    log: logs.log,
    statfs: disk.statfs,
    ...options,
  });
  return { disk, logs, clock, state };
}

/** A release marker the case sets and clears. */
function marker(present: boolean) {
  const flag = { present, spareReleased: async () => flag.present };
  return flag;
}

describe("createDiskFullState", () => {
  it("is not full, and reads nothing, until a refusal is noted", async () => {
    const { disk, state } = setup();
    expect(await state.full()).toBe(false);
    expect(disk.calls).toBe(0);
    expect(state.since()).toBeNull();
    expect(state.noted()).toBe(false);
  });

  it("is full after a refusal while the folder has less than 16 MiB free", async () => {
    const { disk, clock, state } = setup();
    state.noteRefused();
    disk.free(FULL_DISK_BYTES - 1);
    expect(state.noted()).toBe(true);
    expect(await state.full()).toBe(true);
    expect(state.since()).toEqual(clock.now());
  });

  it("forgets the refusal at exactly 16 MiB free, and logs it once", async () => {
    const { disk, logs, state } = setup();
    state.noteRefused();
    disk.free(FULL_DISK_BYTES);
    expect(await state.full()).toBe(false);
    expect(state.since()).toBeNull();
    expect(state.noted()).toBe(false);
    expect(logs.events("storage.disk_space_back")).toEqual([
      { level: "info", event: "storage.disk_space_back", fields: { freeBytes: FULL_DISK_BYTES } },
    ]);
    const callsBefore = disk.calls;
    expect(await state.full()).toBe(false);
    expect(disk.calls).toBe(callsBefore);
  });

  it("logs the clearing once when two reads find space together", async () => {
    const { disk, logs, state } = setup();
    state.noteRefused();
    disk.answer = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { bavail: FULL_DISK_BYTES, frsize: 1 };
    };
    expect(await Promise.all([state.full(), state.full()])).toEqual([false, false]);
    expect(disk.calls).toBe(2);
    expect(logs.events("storage.disk_space_back")).toHaveLength(1);
  });

  it("stays full when the folder's free space cannot be read", async () => {
    const { disk, state } = setup();
    state.noteRefused();
    disk.fail();
    expect(await state.full()).toBe(true);
    expect(state.noted()).toBe(true);
  });

  it("keeps the first time across later refusals, and logs the first only", () => {
    const { clock, logs, state } = setup();
    const first = clock.now();
    state.noteRefused();
    clock.set(new Date("2026-10-21T10:05:00.000Z"));
    state.noteRefused();
    expect(state.since()).toEqual(first);
    expect(logs.events("storage.disk_full_noted")).toEqual([
      { level: "warn", event: "storage.disk_full_noted", fields: {} },
    ]);
  });

  function heldReadings(disk: ReturnType<typeof stubStatfs>) {
    const pending: ((bytes: number) => void)[] = [];
    disk.answer = () =>
      new Promise((resolve) => {
        pending.push((bytes) => resolve({ bavail: bytes, frsize: 1 }));
      });
    return {
      answer(index: number, bytes: number) {
        pending[index]?.(bytes);
      },
    };
  }

  it("keeps a refusal noted while a read was in flight", async () => {
    const { disk, logs, state } = setup();
    const readings = heldReadings(disk);
    state.noteRefused();
    const reading = state.full();
    state.noteRefused();
    readings.answer(0, FULL_DISK_BYTES);
    expect(await reading).toBe(true);
    expect(state.noted()).toBe(true);
    expect(logs.events("storage.disk_space_back")).toHaveLength(0);
  });

  it("keeps a refusal noted after one read cleared and before a slower read returns", async () => {
    const { disk, logs, state } = setup();
    const readings = heldReadings(disk);
    state.noteRefused();
    const first = state.full();
    const second = state.full();
    readings.answer(0, FULL_DISK_BYTES);
    expect(await first).toBe(false);
    state.noteRefused();
    readings.answer(1, FULL_DISK_BYTES);
    expect(await second).toBe(true);
    expect(state.noted()).toBe(true);
    expect(logs.events("storage.disk_space_back")).toHaveLength(1);
  });

  it("clears when no refusal is noted while its read is in flight", async () => {
    const { disk, state } = setup();
    const readings = heldReadings(disk);
    state.noteRefused();
    const reading = state.full();
    readings.answer(0, FULL_DISK_BYTES);
    expect(await reading).toBe(false);
    expect(state.noted()).toBe(false);
  });

  it("notes again after it cleared", async () => {
    const { disk, logs, state } = setup();
    state.noteRefused();
    disk.free(FULL_DISK_BYTES);
    expect(await state.full()).toBe(false);
    state.noteRefused();
    disk.free(0);
    expect(await state.full()).toBe(true);
    expect(logs.events("storage.disk_full_noted")).toHaveLength(2);
  });
});

describe("createDiskFullState with the spare's marker", () => {
  it("stays full at 16 MiB free while the marker exists, and lifts at the next reading once it is gone, logging storage.disk_space_back once", async () => {
    const spare = marker(true);
    const { disk, logs, state } = setup({ spareReleased: spare.spareReleased });
    state.noteRefused();
    disk.free(FULL_DISK_BYTES);
    expect(await state.full()).toBe(true);
    expect(state.noted()).toBe(true);
    expect(logs.events("storage.disk_space_back")).toHaveLength(0);
    spare.present = false;
    expect(await state.full()).toBe(false);
    expect(state.noted()).toBe(false);
    expect(await state.full()).toBe(false);
    expect(logs.events("storage.disk_space_back")).toEqual([
      { level: "info", event: "storage.disk_space_back", fields: { freeBytes: FULL_DISK_BYTES } },
    ]);
  });

  it("keeps the stop when a refusal is noted while the marker is read", async () => {
    let state!: DiskFullState;
    const spareReleased = async () => {
      state.noteRefused();
      return false;
    };
    const set = setup({ spareReleased });
    state = set.state;
    state.noteRefused();
    set.disk.free(FULL_DISK_BYTES);
    expect(await state.full()).toBe(true);
    expect(state.noted()).toBe(true);
  });
});

describe("noteFullAtStart", () => {
  it("starts full when the spare's marker exists, whatever the free space", async () => {
    const spare = marker(true);
    const { disk, logs, state } = setup({ spareReleased: spare.spareReleased });
    disk.free(1024 ** 3);
    await noteFullAtStart(state, {
      dir: DIR,
      log: logs.log,
      statfs: disk.statfs,
      spareReleased: spare.spareReleased,
    });
    expect(state.noted()).toBe(true);
  });

  it("starts full when the marker exists and free space cannot be read", async () => {
    const spare = marker(true);
    const { disk, logs, state } = setup({ spareReleased: spare.spareReleased });
    disk.fail();
    await noteFullAtStart(state, {
      dir: DIR,
      log: logs.log,
      statfs: disk.statfs,
      spareReleased: spare.spareReleased,
    });
    expect(state.noted()).toBe(true);
  });

  it("starts clear with plenty of room when the marker does not exist", async () => {
    const spare = marker(false);
    const { disk, logs, state } = setup({ spareReleased: spare.spareReleased });
    disk.free(1024 ** 3);
    await noteFullAtStart(state, {
      dir: DIR,
      log: logs.log,
      statfs: disk.statfs,
      spareReleased: spare.spareReleased,
    });
    expect(state.noted()).toBe(false);
  });

  it("starts full on a folder with less than 16 MiB free", async () => {
    const { disk, logs, state } = setup();
    disk.free(FULL_DISK_BYTES - 1);
    await noteFullAtStart(state, { dir: DIR, log: logs.log, statfs: disk.statfs });
    expect(state.noted()).toBe(true);
  });

  it("starts clear at exactly 16 MiB free", async () => {
    const { disk, logs, state } = setup();
    disk.free(FULL_DISK_BYTES);
    await noteFullAtStart(state, { dir: DIR, log: logs.log, statfs: disk.statfs });
    expect(state.noted()).toBe(false);
    expect(logs.events("storage.disk_full_noted")).toHaveLength(0);
  });

  it("starts clear, and says so, when free space cannot be read", async () => {
    const { disk, logs, state } = setup();
    disk.fail();
    await noteFullAtStart(state, { dir: DIR, log: logs.log, statfs: disk.statfs });
    expect(state.noted()).toBe(false);
    expect(logs.events("storage.start_space_unread")).toEqual([
      { level: "warn", event: "storage.start_space_unread", fields: {} },
    ]);
  });
});

describe("watchForDiskFull", () => {
  it("notes every refusal a watched store reports, until unsubscribed", () => {
    const { state } = setup();
    function fakeStore() {
      const fake = {
        listener: null as (() => void) | null,
        unsubscribed: false,
        onDiskFull(listener: () => void) {
          fake.listener = listener;
          return () => {
            fake.unsubscribed = true;
          };
        },
      };
      return fake;
    }
    const first = fakeStore();
    const second = fakeStore();
    let notes = 0;
    const unsubscribe = watchForDiskFull(
      {
        ...state,
        noteRefused: () => {
          notes += 1;
          state.noteRefused();
        },
      },
      [first, second],
    );

    first.listener?.();
    second.listener?.();
    second.listener?.();
    expect(notes).toBe(3);
    expect(state.noted()).toBe(true);

    unsubscribe();
    expect(first.unsubscribed).toBe(true);
    expect(second.unsubscribed).toBe(true);
  });
});

describe("diskFullRefusal", () => {
  it("refuses with storage.disk_full", () => {
    const refusal = diskFullRefusal();
    expect(refusal).toMatchObject({ code: "storage.disk_full", params: {} });
    expect(refusal.reason).toBeUndefined();
  });
});
