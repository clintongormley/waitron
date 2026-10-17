import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuStatePoll } from "./menu-state-poll.js";
import type { MenuState } from "../api/client.js";

function state(versionId: string): MenuState {
  return {
    service: {
      open: true,
      zoneOpen: true,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
      zoneKeepOpen: null,
    },
    menus: [{ menuId: "lunch", versionId, orderable: true, sendable: true }],
    unavailable: { products: [], optionLabels: [] },
  };
}

/** A read the test answers by hand, recording the signal it was given. */
function pendingRead() {
  const reads: {
    zoneId: string;
    signal: AbortSignal;
    answer: (value: MenuState) => void;
    fail: (error: unknown) => void;
  }[] = [];
  const read = vi.fn(
    (zoneId: string, signal: AbortSignal) =>
      new Promise<MenuState>((answer, fail) => reads.push({ zoneId, signal, answer, fail })),
  );
  return { read, reads };
}

/** Lets the answered promises' continuations run under fake timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MenuStatePoll", () => {
  it("bounds its extra read to one in flight even with no menu zones", async () => {
    let answer!: () => void;
    const signals: AbortSignal[] = [];
    const onTick = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => {
        answer = resolve;
      });
    });
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledOnce();
    expect(signals[0]!.aborted).toBe(false);
    answer();
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    poll.stop();
    expect(signals[1]!.aborted).toBe(true);
    answer();
    await settle();
  });

  it("cancels an extra read after 25 seconds and starts a replacement on the next tick", async () => {
    const signals: AbortSignal[] = [];
    const onTick = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => {});
    });
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(40_000);
    expect(signals[0]?.aborted).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(signals).toHaveLength(2);
    poll.stop();
    await settle();
  });

  it("an old extra read finishing after stop cannot release a new session's read", async () => {
    const answers: (() => void)[] = [];
    const onTick = vi.fn(() => new Promise<void>((resolve) => answers.push(resolve)));
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    poll.start();
    vi.advanceTimersByTime(15_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    answers[0]!();
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    poll.stop();
    answers[1]!();
    await settle();
  });

  it("contains an extra read's refusal and keeps the next tick usable", async () => {
    const onTick = vi.fn().mockRejectedValue(new TypeError("offline"));
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(15_000);
    await settle();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(poll.running).toBe(true);
    poll.stop();
  });

  it("a session.required extra read stops polling even without menu zones", async () => {
    const onTick = vi.fn().mockRejectedValue({ code: "session.required" });
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(poll.running).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledOnce();
  });

  it("a cancelled extra read's session refusal cannot stop the replacement session", async () => {
    let fail!: (reason: unknown) => void;
    const onTick = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const poll = new MenuStatePoll({ read: vi.fn(), zones: () => [], onState: vi.fn(), onTick });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    poll.start();
    fail({ code: "session.required" });
    await settle();
    expect(poll.running).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it("reads each named zone every 15 seconds once started, and reports each answer with its zone", async () => {
    const { read, reads } = pendingRead();
    const onState = vi.fn();
    const poll = new MenuStatePoll({ read, zones: () => ["counter", "terrace"], onState });
    poll.start();
    vi.advanceTimersByTime(14_999);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reads.map((r) => r.zoneId)).toEqual(["counter", "terrace"]);
    reads[1]!.answer(state("v2"));
    await settle();
    expect(onState).toHaveBeenCalledWith("terrace", state("v2"));
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  it("does not read before it is started, nor start a second timer when started twice", () => {
    const { read } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    vi.advanceTimersByTime(30_000);
    expect(read).not.toHaveBeenCalled();
    poll.start();
    poll.start();
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it("stops reading on stop, cancels a read still out, and reports nothing it answers", async () => {
    const { read, reads } = pendingRead();
    const onState = vi.fn();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    expect(reads[0]!.signal.aborted).toBe(true);
    reads[0]!.answer(state("v2"));
    await settle();
    vi.advanceTimersByTime(60_000);
    expect(read).toHaveBeenCalledOnce();
    expect(onState).not.toHaveBeenCalled();
    expect(poll.running).toBe(false);
  });

  it("treats a session.required answer as signed out and stops", async () => {
    const { read, reads } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    reads[0]!.fail({ code: "session.required", status: 401 });
    await settle();
    expect(poll.running).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(read).toHaveBeenCalledOnce();
  });

  it("keeps polling after any other failure", async () => {
    const { read, reads } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    reads[0]!.fail(new TypeError("Failed to fetch"));
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(poll.running).toBe(true);
    poll.stop();
  });

  it("a read cancelled by a stop that then fails session.required does not stop the poll started again", async () => {
    const { read, reads } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    poll.start();
    reads[0]!.fail({ code: "session.required", status: 401 });
    await settle();
    expect(poll.running).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it("an older read failing session.required after a newer one for its zone answered does not stop the poll", async () => {
    const { read, reads } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(30_000);
    reads[1]!.answer(state("v3"));
    await settle();
    reads[0]!.fail({ code: "session.required", status: 401 });
    await settle();
    expect(poll.running).toBe(true);
    poll.stop();
  });

  it("cancels a read that has been out for 25 seconds", () => {
    const { read, reads } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(24_999);
    expect(reads[0]!.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(reads[0]!.signal.aborted).toBe(true);
    poll.stop();
  });

  it("never lets an older read that answers late overwrite a newer answer for its zone", async () => {
    const { read, reads } = pendingRead();
    const onState = vi.fn();
    const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState });
    poll.start();
    vi.advanceTimersByTime(30_000);
    reads[1]!.answer(state("v3"));
    await settle();
    reads[0]!.answer(state("v2"));
    await settle();
    expect(onState.mock.calls).toEqual([["counter", state("v3")]]);
    poll.stop();
  });

  it("reads nothing while there is no zone to read", () => {
    const { read } = pendingRead();
    const poll = new MenuStatePoll({ read, zones: () => [], onState: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(30_000);
    expect(read).not.toHaveBeenCalled();
    poll.stop();
  });
});

it("reads only the requested zone immediately and reports its answer without waiting for a tick", async () => {
  const { read, reads } = pendingRead();
  const onState = vi.fn();
  const poll = new MenuStatePoll({ read, zones: () => ["counter", "terrace"], onState });
  poll.start();
  const done = poll.readNow("terrace");
  expect(reads.map((r) => r.zoneId)).toEqual(["terrace"]);
  reads[0]!.answer(state("v2"));
  await done;
  expect(onState.mock.calls).toEqual([["terrace", state("v2")]]);
  poll.stop();
});

it("keeps the immediate result when an older periodic read answers afterwards", async () => {
  const { read, reads } = pendingRead();
  const onState = vi.fn();
  const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState });
  poll.start();
  vi.advanceTimersByTime(15_000);
  const done = poll.readNow("counter");
  reads[1]!.answer(state("v3"));
  await done;
  reads[0]!.answer(state("v2"));
  await settle();
  expect(onState.mock.calls).toEqual([["counter", state("v3")]]);
  poll.stop();
});

it("ignores an immediate read after stop and does not start reads while stopped", async () => {
  const { read, reads } = pendingRead();
  const onState = vi.fn();
  const poll = new MenuStatePoll({ read, zones: () => ["counter"], onState });
  await poll.readNow("counter");
  expect(reads).toEqual([]);
  poll.start();
  const done = poll.readNow("counter");
  poll.stop();
  reads[0]!.answer(state("v2"));
  await done;
  expect(reads[0]!.signal.aborted).toBe(true);
  expect(onState).not.toHaveBeenCalled();
});
