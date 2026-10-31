import { describe, expect, it, vi } from "vitest";
import type {
  BootReading,
  ClockConfirmation,
  ClockProvedWrong,
  ClockStopState,
  TrustedReading,
  WaitingClockCheck,
} from "@waitron/fiscal";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { clockCorrection } from "./clock-correction.js";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";
import { createClockWitnessStore } from "./clock-witnesses.js";

const TX = { fake: "tx" } as unknown as Transaction;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
const DAY = 86_400_000;
const BOOT: BootReading = { ms: 9_000_000, id: "boot-anchor-test" };

const STOPPED: ClockStopState = {
  clockAt: "2026-10-31T10:00:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-10-31T11:00:00.000Z",
  lastRecordOffsetMinutes: 60,
  recordId: "record-1",
  gapMs: 3_600_000,
  proof: "none",
  agreeing: { authority: null, devices: [] },
  contrary: { authority: null, devices: [] },
  confirmation: null,
};

const CONFIRMATION: ClockConfirmation = {
  id: "confirmation-1",
  seq: 1,
  source: "authority",
  personId: null,
  confirmedAt: "2026-10-31T10:00:15.000Z",
  checkId: "check-1",
  recordId: null,
};

const diskFull = () => new AppError("storage.disk_full", {});

interface Note {
  input: ClockProvedWrong;
  /** The lifts in force when the seat recorded the disproof. */
  lifts: string[];
}

function harness(
  options: {
    /** Replaces the seat's disproof write; `notes` still lists the writes that succeeded. */
    note?: (input: ClockProvedWrong, call: number) => Promise<void>;
    stop?: ClockStopState | null;
    waiting?: WaitingClockCheck | null;
    read?: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
    transaction?: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
    correction?: { inTurn: <T>(fn: () => Promise<T>) => Promise<T> };
  } = {},
) {
  let wallMs = START_MS;
  let monoMs = 1_000;
  const timers: { fn: () => void }[] = [];
  const notes: Note[] = [];
  const lifts: string[] = [];
  let calls = 0;
  const store = createClockWitnessStore({ wall: () => wallMs, monotonic: () => monoMs });
  const backend = {
    clockStopState: vi.fn(async () => (options.stop === undefined ? STOPPED : options.stop)),
    assertRecordableAt: () => {},
    noteClockProvedWrong: vi.fn(async (_tx: Transaction, input: ClockProvedWrong) => {
      calls++;
      await options.note?.(input, calls);
      notes.push({ input, lifts: [...lifts] });
      return { recorded: [...lifts], unused: [], held: [] };
    }),
    confirmClockStop: vi.fn(async () => ({ confirmation: CONFIRMATION })),
    ...(options.waiting === undefined
      ? {}
      : {
          waitingClockCheck: vi.fn(async () => options.waiting!),
          closeClockCheckByItself: vi.fn(async () => ({ confirmation: CONFIRMATION })),
        }),
  };
  const watch = startClockWatch({
    backend: backend as unknown as Parameters<typeof startClockWatch>[0]["backend"],
    store,
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => ({ ...BOOT }), elapsed: () => monoMs },
    nodeId: "node-1",
    read: options.read ?? (async (fn) => fn(TX)),
    transaction: options.transaction ?? (async (fn) => fn(TX)),
    ...(options.correction === undefined ? {} : { correction: options.correction }),
    filesRecords: () => false,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log: () => {},
    timer: (_ms, fn) => {
      timers.push({ fn });
      return { cancel: () => {} };
    },
  });

  /** Fires the armed look without waiting for it. */
  function fire(): void {
    timers.at(-1)!.fn();
  }

  /** Moves the steady clock a look's interval and the wall clock by as much plus `wallJumpMs`,
   * then fires the armed look and waits for the next one to be armed. */
  async function look(wallJumpMs = 0): Promise<void> {
    monoMs += CLOCK_WATCH_MS;
    wallMs += CLOCK_WATCH_MS + wallJumpMs;
    const count = timers.length;
    fire();
    await vi.waitFor(() => expect(timers.length).toBe(count + 1));
  }

  /** AEAT says the box's clock is `aheadMs` ahead of it, measured now. */
  function aeatSaysAhead(aheadMs: number): void {
    store.noteAuthority({
      authorityMs: wallMs - aheadMs,
      uncertaintyMs: 100,
      at: { wallMs, monoMs },
    });
  }

  return {
    watch,
    store,
    backend,
    notes,
    lifts,
    fire,
    look,
    aeatSaysAhead,
    stepWall: (ms: number) => {
      wallMs += ms;
    },
    wall: () => wallMs,
    reasons: () => notes.map((note) => note.input.reason),
    armed: () => timers.length,
  };
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe("the clock watch as a set's anchor", () => {
  it("takes no jump from the wall clock between stepComing and reanchor, on any look", async () => {
    const h = harness();
    await h.watch.stepComing();
    // A set still in flight can move the clock after a look has already run.
    await h.look(2 * DAY);
    await h.look(2 * DAY);
    expect(h.reasons()).toEqual([]);

    await h.watch.reanchor();
    await h.look(120_000);
    expect(h.reasons()).toEqual(["jump"]);
  });

  it("takes a jump when no set is coming (the control)", async () => {
    const h = harness();
    await h.look(2 * DAY);
    expect(h.reasons()).toEqual(["jump"]);
  });

  it("records a filing reply noted before a backward set before the set's lift exists", async () => {
    const h = harness();
    h.aeatSaysAhead(DAY);
    await h.watch.stepComing();
    expect(h.notes).toEqual([
      {
        input: expect.objectContaining({ reason: "authority" }) as unknown,
        lifts: [],
      },
    ]);
    h.stepWall(-DAY);
    h.lifts.push("lift-1");
    await h.watch.reanchor();
    await h.look();
    expect(h.notes.filter((note) => note.lifts.includes("lift-1"))).toEqual([]);

    // The control: a reply noted after the set, saying the new clock is wrong, disproves it.
    h.aeatSaysAhead(DAY);
    await h.look();
    expect(h.notes.filter((note) => note.lifts.includes("lift-1"))).toHaveLength(1);
  });

  it("refuses the set when the disproofs cannot be recorded before it", async () => {
    const h = harness({
      note: async () => {
        throw diskFull();
      },
    });
    h.aeatSaysAhead(DAY);
    await expect(h.watch.stepComing()).rejects.toThrow(AppError);
  });

  it("records a reply noted while the host was setting before the set's lift exists", async () => {
    const h = harness();
    await h.watch.stepComing();
    h.aeatSaysAhead(DAY);
    h.stepWall(-DAY);
    await h.watch.reanchor();
    expect(h.notes).toEqual([
      {
        input: expect.objectContaining({ reason: "authority" }) as unknown,
        lifts: [],
      },
    ]);
    h.lifts.push("lift-1");
    await h.look();
    expect(h.notes.filter((note) => note.lifts.includes("lift-1"))).toEqual([]);

    h.aeatSaysAhead(DAY);
    await h.look();
    expect(h.notes.filter((note) => note.lifts.includes("lift-1"))).toHaveLength(1);
  });

  it("rejects reanchor when the disproofs cannot be recorded, and still clears the hold", async () => {
    const h = harness({
      note: async (_input, call) => {
        if (call === 1) throw diskFull();
      },
    });
    await h.watch.stepComing();
    h.aeatSaysAhead(DAY);
    await expect(h.watch.reanchor()).rejects.toThrow(AppError);
    await h.look(120_000);
    expect(h.reasons()).toEqual(["authority", "jump"]);
  });

  describe("records its disproofs one call at a time", () => {
    async function twoPending(note: (input: ClockProvedWrong, call: number) => Promise<void>) {
      const h = harness({ note });
      h.aeatSaysAhead(DAY);
      h.stepWall(1_000);
      h.aeatSaysAhead(2 * DAY);
      return h;
    }

    it("so a set waits for a look's writes, and each is written once, in order", async () => {
      const held = deferred();
      const started = deferred();
      const h = await twoPending(async (_input, call) => {
        if (call === 1) {
          started.release();
          await held.promise;
        }
      });
      h.fire();
      await started.promise;
      let resolved = false;
      const coming = h.watch.stepComing().then(() => (resolved = true));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resolved).toBe(false);
      held.release();
      await coming;
      expect(h.notes.map((note) => note.input.trustedUntil.getTime())).toEqual([
        START_MS,
        START_MS + 1_000,
      ]);
    });

    it("so a failed second write rejects the set and is left for the next look", async () => {
      const held = deferred();
      const started = deferred();
      const h = await twoPending(async (_input, call) => {
        if (call === 1) {
          started.release();
          await held.promise;
        }
        if (call === 2 || call === 3) throw diskFull();
      });
      h.fire();
      await started.promise;
      const coming = h.watch.stepComing();
      held.release();
      await expect(coming).rejects.toThrow(AppError);
      expect(h.notes.map((note) => note.input.trustedUntil.getTime())).toEqual([START_MS]);
      await vi.waitFor(() => expect(h.armed()).toBe(2));
      await h.look();
      expect(h.notes.map((note) => note.input.trustedUntil.getTime())).toEqual([
        START_MS,
        START_MS + 1_000,
      ]);
    });
  });

  it("writes its confirmations in the correction's turn, around their whole transaction", async () => {
    const order: string[] = [];
    const correction = {
      inTurn: async <T>(fn: () => Promise<T>): Promise<T> => {
        order.push("turn");
        const result = await fn();
        order.push("turn ends");
        return result;
      },
    };
    const transaction = async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
      order.push("transaction");
      return fn(TX);
    };
    const confirming = harness({
      stop: { ...STOPPED, proof: "ready" },
      correction,
      transaction,
    });
    await confirming.look();
    expect(confirming.backend.confirmClockStop).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["turn", "transaction", "turn ends"]);

    order.length = 0;
    const closing = harness({
      stop: null,
      waiting: { checkId: "check-1", openedAt: "2026-10-31T09:00:00.000Z" },
      correction,
      transaction,
    });
    await closing.look();
    expect(closing.backend.closeClockCheckByItself).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["turn", "transaction", "turn ends"]);
  });

  describe("on a real venue database", () => {
    const suite = useVenueDb({ migrations: [] });

    async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`not finished within ${ms} ms`)), ms);
      });
      try {
        return await Promise.race([promise, deadline]);
      } finally {
        clearTimeout(timer);
      }
    }

    it.each([
      ["confirm", { stop: { ...STOPPED, proof: "ready" as const } }],
      [
        "closeWaiting",
        { stop: null, waiting: { checkId: "check-1", openedAt: "2026-10-31T09:00:00.000Z" } },
      ],
    ])(
      "finishes both a set holding the turn and the watch's %s, which takes the turn before the lock",
      async (_name, seat) => {
        const db = suite.db;
        const read = <T>(fn: (tx: Transaction) => Promise<T>) => db.withWriteLock(() => fn(db));
        const transaction = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);
        const hostHeld = deferred();
        const waiting = deferred();
        let wallMs = START_MS;
        const correction = clockCorrection({
          host: {
            clockStatus: async () => {
              await hostHeld.promise;
              return {
                available: true,
                service: "on",
                unit: "chrony.service",
                synchronised: false,
                lastSyncAt: null,
              };
            },
            setClock: async (input) => {
              const beforeMs = wallMs;
              wallMs = input.targetMs;
              return { available: true, beforeMs, afterMs: wallMs };
            },
          },
          backend: {
            clockStopState: async () => STOPPED,
            assertRecordableAt: () => {},
            confirmClockStep: async () => ({ confirmation: null, corrected: null }),
          },
          store: { clear: () => {}, witnesses: () => [] },
          clock: {
            now: () =>
              ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
          },
          wall: () => wallMs,
          monotonic: () => 1_000,
          boot: { readBoot: () => ({ ...BOOT }) },
          read,
          transaction,
          nodeId: "node-1",
          log: () => {},
        });
        const h = harness({
          ...seat,
          read,
          transaction,
          correction: {
            inTurn: (fn) => {
              waiting.release();
              return correction.inTurn(fn);
            },
          },
        });
        correction.addAnchor(h.watch);
        const set = correction.set({
          reason: "behind_chain",
          source: "authority",
          offsetMs: 3_600_000,
          measuredAt: { wallMs: START_MS, monoMs: 1_000 },
          stepsSeen: 0,
          witnesses: [],
          requester: {},
        });
        h.fire();
        await within(waiting.promise, 5_000);
        hostHeld.release();
        await within(set, 5_000);
        await within(
          vi.waitFor(() =>
            expect(
              seat.stop === null ? h.backend.closeClockCheckByItself : h.backend.confirmClockStop,
            ).toHaveBeenCalledTimes(1),
          ),
          5_000,
        );
        await h.watch.stop();
      },
    );
  });
});
