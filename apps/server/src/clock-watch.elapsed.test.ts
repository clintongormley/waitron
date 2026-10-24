import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";

// The clocks the watch reads when none is injected: Linux's /proc/uptime (the boot-time clock,
// which counts a suspend) and performance.now() (which, on Linux, does not). Both are replaced so
// the default can be observed on any development machine.
const host = vi.hoisted(() => ({
  uptime: (): string => {
    throw Object.assign(new Error("no /proc/uptime"), { code: "ENOENT" });
  },
  readPaths: [] as unknown[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: unknown, ...rest: unknown[]) => {
      host.readPaths.push([path, ...rest]);
      return host.uptime();
    }),
  };
});

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-07-20T18:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;

afterEach(() => {
  vi.restoreAllMocks();
});

/** A watch on the default elapsed-time clock, with `/proc/uptime` reading `uptimeS` seconds
 * (`null`: the file cannot be read; `uptimeText`: the file holds that text instead) and
 * performance.now() reading `perfMs`. */
function watched(initial: { uptimeS: number | null; perfMs: number; uptimeText?: string }) {
  const clocks = {
    wallMs: START_MS,
    uptimeS: initial.uptimeS,
    perfMs: initial.perfMs,
    uptimeText: initial.uptimeText ?? null,
  };
  host.readPaths = [];
  host.uptime = () => {
    if (clocks.uptimeText !== null) return clocks.uptimeText;
    if (clocks.uptimeS === null) {
      throw Object.assign(new Error("no /proc/uptime"), { code: "ENOENT" });
    }
    return `${clocks.uptimeS.toFixed(2)} 1234.56\n`;
  };
  vi.spyOn(performance, "now").mockImplementation(() => clocks.perfMs);
  const timers: (() => void)[] = [];
  const note = vi.fn(async () => ({ recorded: [], unused: [], held: [] }));
  const clockStopState = vi.fn(async () => null);
  startClockWatch({
    backend: { assertRecordableAt: () => {}, clockStopState, noteClockProvedWrong: note },
    store: {
      noteAuthority: vi.fn(),
      witnesses: vi.fn(() => []),
      takeNewAuthority: vi.fn(() => []),
      endStop: vi.fn(),
      clear: vi.fn(),
    },
    nodeId: "node-1",
    clock: { now: () => ({ instant: new Date(clocks.wallMs), offsetMinutes: 120 }) as never },
    wall: () => clocks.wallMs,
    read: (fn) => fn(TX),
    transaction: (fn) => fn(TX),
    filesRecords: () => true,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log: () => {},
    timer: (_ms, fn) => {
      timers.push(fn);
      return { cancel: () => {} };
    },
  });

  /** Moves the clocks by the given amounts, runs one check and waits for it to finish. */
  async function tick(by: { wallMs: number; uptimeMs: number; perfMs: number }) {
    clocks.wallMs += by.wallMs;
    if (clocks.uptimeS !== null) clocks.uptimeS += by.uptimeMs / 1000;
    clocks.perfMs += by.perfMs;
    const count = timers.length;
    timers.at(-1)!();
    await vi.waitFor(() => expect(timers.length).toBe(count + 1));
  }

  return { clocks, note, clockStopState, tick };
}

describe("the clock watch's elapsed-time clock when none is injected", () => {
  it("records nothing after the box sleeps an hour: wall and boot-time clocks move an hour, performance.now() a minute", async () => {
    const w = watched({ uptimeS: 5_000, perfMs: 1_000 });
    await w.tick({ wallMs: HOUR, uptimeMs: HOUR, perfMs: MINUTE });
    expect(w.clockStopState).toHaveBeenCalledTimes(1);
    expect(w.note).not.toHaveBeenCalled();
    expect(host.readPaths).toContainEqual(["/proc/uptime", "utf8"]);
  });

  it("still records a forward step of the wall clock, measured on the boot-time clock", async () => {
    const w = watched({ uptimeS: 5_000, perfMs: 1_000 });
    await w.tick({ wallMs: HOUR, uptimeMs: MINUTE, perfMs: MINUTE });
    expect(w.note).toHaveBeenCalledExactlyOnceWith(TX, {
      trustedUntil: new Date(START_MS + MINUTE),
      observedAt: new Date(START_MS + HOUR),
      reason: "jump",
    });
  });

  it("measures on performance.now() where /proc/uptime cannot be read", async () => {
    const w = watched({ uptimeS: null, perfMs: 1_000 });
    await w.tick({ wallMs: HOUR, uptimeMs: HOUR, perfMs: MINUTE });
    expect(w.note).toHaveBeenCalledExactlyOnceWith(TX, {
      trustedUntil: new Date(START_MS + MINUTE),
      observedAt: new Date(START_MS + HOUR),
      reason: "jump",
    });
    const quiet = watched({ uptimeS: null, perfMs: 1_000 });
    await quiet.tick({ wallMs: MINUTE, uptimeMs: HOUR, perfMs: MINUTE });
    expect(quiet.note).not.toHaveBeenCalled();
  });

  it.each(["", "not a number\n"])(
    "measures on performance.now() where /proc/uptime holds %j",
    async (uptimeText) => {
      const w = watched({ uptimeS: 5_000, perfMs: 1_000, uptimeText });
      await w.tick({ wallMs: HOUR, uptimeMs: HOUR, perfMs: MINUTE });
      expect(w.note).toHaveBeenCalledTimes(1);
    },
  );

  it("skips the jump check, not the rest of the watch, across later reads of /proc/uptime that fail", async () => {
    const w = watched({ uptimeS: 5_000, perfMs: 1_000 });
    const uptimeS = w.clocks.uptimeS;
    w.clocks.uptimeS = null;
    await w.tick({ wallMs: HOUR, uptimeMs: MINUTE, perfMs: MINUTE });
    w.clocks.uptimeS = uptimeS! + 60;
    w.clocks.uptimeText = "garbage";
    await w.tick({ wallMs: HOUR, uptimeMs: MINUTE, perfMs: MINUTE });
    w.clocks.uptimeText = null;
    await w.tick({ wallMs: HOUR, uptimeMs: MINUTE, perfMs: MINUTE });
    expect(w.clockStopState).toHaveBeenCalledTimes(3);
    expect(w.note).not.toHaveBeenCalled();
    await w.tick({ wallMs: HOUR, uptimeMs: MINUTE, perfMs: MINUTE });
    expect(w.note).toHaveBeenCalledTimes(1);
  });
});
