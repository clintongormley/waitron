import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TillClockState } from "../api/client.js";
import { SessionActivity } from "../session-activity.js";
import { ClockingController, type ClockingSnapshot } from "./clocking.js";

function clock(
  state: TillClockState["state"] = "out",
  lastEntryId: string | null = null,
  personId = "ana",
): TillClockState {
  return {
    personId,
    locationId: "venue",
    businessDay: "2026-10-14",
    state,
    activeLocationId: state === "out" ? null : "venue",
    lastEntryId,
    firstClockIn: lastEntryId === null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const controllers: ClockingController[] = [];
function fixture() {
  const api = {
    getClockState: vi.fn().mockResolvedValue(clock()),
    clockIn: vi.fn().mockResolvedValue(clock("working", "in")),
    clockOut: vi.fn().mockResolvedValue(clock("out", "out")),
    startBreak: vi.fn().mockResolvedValue(clock("on_break", "break")),
    endBreak: vi.fn().mockResolvedValue(clock("working", "end-break")),
  };
  const changed = vi.fn<(snapshot: ClockingSnapshot) => void>();
  const settled = vi.fn();
  const controller = new ClockingController(api, changed, settled);
  controllers.push(controller);
  return { api, changed, settled, controller, snapshot: () => changed.mock.calls.at(-1)![0] };
}
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  }),
);
afterEach(() => {
  for (const c of controllers.splice(0)) c.stop();
  vi.useRealTimers();
});
async function flush() {
  for (let n = 0; n < 10; n++) await Promise.resolve();
}

describe("ClockingController", () => {
  it.each([
    ["in", "clockIn", "working"],
    ["out", "clockOut", "out"],
    ["break-start", "startBreak", "on_break"],
    ["break-end", "endBreak", "working"],
  ] as const)(
    "settles %s once with the server state and the last server entry",
    async (action, method, status) => {
      const f = fixture();
      f.api.getClockState.mockResolvedValue(clock("working", "previous"));
      await f.controller.start("ana");
      const answer = await f.controller.act(action);
      expect(f.api[method]).toHaveBeenCalledWith("previous", { signal: expect.any(AbortSignal) });
      expect(answer?.state).toBe(status);
      expect(f.settled.mock.calls).toEqual([[action, answer]]);
      expect(f.snapshot()).toMatchObject({ busy: false, error: null, state: answer });
    },
  );

  it("two taps submit once and neither explicit refresh nor a poll overlaps the write", async () => {
    const f = fixture();
    await f.controller.start("ana");
    const write = deferred<TillClockState>();
    f.api.clockIn.mockReturnValue(write.promise);
    const first = f.controller.act("in");
    expect(f.snapshot().busy).toBe(true);
    expect(await f.controller.act("in")).toBeNull();
    await f.controller.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.api.getClockState).toHaveBeenCalledTimes(1);
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
    write.resolve(clock("working", "one"));
    await first;
    expect(f.settled.mock.calls).toEqual([["in", clock("working", "one")]]);
  });

  it("drops an old person's response and a stopped read cannot release a restarted read", async () => {
    const f = fixture();
    const old = deferred<TillClockState>();
    const next = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const previous = f.controller.start("ana");
    const oldSignal = f.api.getClockState.mock.calls[0]![0].signal as AbortSignal;
    f.controller.stop();
    const current = f.controller.start("luis");
    old.resolve(clock("working", "old", "ana"));
    await previous;
    expect(oldSignal.aborted).toBe(true);
    expect(f.snapshot()).toMatchObject({ state: null, reading: true, busy: false });
    next.resolve(clock("on_break", "new", "luis"));
    await current;
    expect(f.snapshot().state?.personId).toBe("luis");
  });

  it("an old read cannot overwrite a write", async () => {
    const f = fixture();
    await f.controller.start("ana");
    const late = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(late.promise);
    const read = f.controller.refresh();
    const answer = await f.controller.act("in");
    late.resolve(clock());
    await read;
    expect(f.snapshot()).toMatchObject({ state: answer, reading: false, busy: false });
  });

  it("an old write cannot settle or release a new person's write", async () => {
    const f = fixture();
    await f.controller.start("ana");
    const old = deferred<TillClockState>();
    const next = deferred<TillClockState>();
    f.api.clockIn.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = f.controller.act("in");
    f.api.getClockState.mockResolvedValue(clock("out", null, "luis"));
    await f.controller.start("luis");
    const second = f.controller.act("in");
    old.resolve(clock("working", "old"));
    await first;
    expect(f.snapshot().busy).toBe(true);
    expect(f.settled).not.toHaveBeenCalled();
    next.resolve(clock("working", "new", "luis"));
    await second;
    expect(f.settled.mock.calls).toEqual([["in", clock("working", "new", "luis")]]);
  });

  it.each([
    ["in", "clockIn", "working"],
    ["out", "clockOut", "out"],
    ["break-start", "startBreak", "on_break"],
    ["break-end", "endBreak", "working"],
  ] as const)(
    "a lost %s response is read before retry and confirmed only by new state and entry",
    async (action, method, status) => {
      const f = fixture();
      f.api.getClockState
        .mockResolvedValueOnce(clock("working", "before"))
        .mockResolvedValueOnce(clock(status, "after"));
      f.api[method].mockRejectedValue(new TypeError("response lost"));
      await f.controller.start("ana");
      expect(await f.controller.act(action)).toEqual(clock(status, "after"));
      expect(f.api[method]).toHaveBeenCalledTimes(1);
      expect(f.api.getClockState).toHaveBeenCalledTimes(2);
      expect(f.settled.mock.calls).toEqual([[action, clock(status, "after")]]);
      expect(f.snapshot()).toMatchObject({
        error: null,
        busy: false,
        state: clock(status, "after"),
      });
    },
  );

  it("a failed reconciliation read retains action and generation for Retry read", async () => {
    const f = fixture();
    f.api.getClockState
      .mockResolvedValueOnce(clock())
      .mockRejectedValueOnce(new TypeError("read lost"))
      .mockResolvedValueOnce(clock("working", "saved"));
    f.api.clockIn.mockRejectedValue(new TypeError("write lost"));
    await f.controller.start("ana");
    expect(await f.controller.act("in")).toBeNull();
    expect(f.snapshot()).toMatchObject({ error: "uncertain", state: null, busy: false });
    expect(f.settled).not.toHaveBeenCalled();
    expect(await f.controller.act("in")).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.api.getClockState).toHaveBeenCalledTimes(2);
    await f.controller.refresh();
    expect(f.settled.mock.calls).toEqual([["in", clock("working", "saved")]]);
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
  });

  it.each([clock("out", "unchanged"), clock("working", "before")])(
    "an unconfirmed reconciliation clears intent before an unrelated transition (%j)",
    async (unconfirmed) => {
      const f = fixture();
      f.api.getClockState
        .mockResolvedValueOnce(clock("out", "before"))
        .mockResolvedValueOnce(unconfirmed)
        .mockResolvedValueOnce(clock("working", "future"));
      f.api.clockIn.mockRejectedValue(new TypeError("lost"));
      await f.controller.start("ana");
      expect(await f.controller.act("in")).toBeNull();
      expect(f.settled.mock.calls).toEqual([["in", null]]);
      expect(f.snapshot()).toMatchObject({ state: unconfirmed, error: null });
      await f.controller.refresh();
      expect(f.settled.mock.calls).toEqual([["in", null]]);
    },
  );

  it("read recovery preserves a write refusal until the next explicit action", async () => {
    const f = fixture();
    await f.controller.start("ana");
    f.api.clockIn.mockRejectedValueOnce({ code: "attendance.state_changed" });
    expect(await f.controller.act("in")).toBeNull();
    expect(f.settled.mock.calls).toEqual([["in", null]]);
    f.api.getClockState.mockRejectedValueOnce(new TypeError("offline"));
    await f.controller.refresh();
    await f.controller.refresh();
    expect(f.snapshot()).toMatchObject({
      error: "write",
      refusal: { code: "attendance.state_changed" },
    });
    await f.controller.act("in");
    expect(f.snapshot()).toMatchObject({ error: null, refusal: null });
  });

  it("aborts a read after 25 seconds without a second overlapping poll", async () => {
    const f = fixture();
    const held = deferred<TillClockState>();
    f.api.getClockState.mockReturnValueOnce(held.promise);
    const initial = f.controller.start("ana");
    await vi.advanceTimersByTimeAsync(24_999);
    expect(f.api.getClockState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await initial;
    expect(f.api.getClockState.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(f.snapshot()).toMatchObject({ state: null, reading: false, error: "read" });
    held.resolve(clock("working", "late"));
    await flush();
    expect(f.snapshot().state).toBeNull();
    await f.controller.refresh();
    expect(f.snapshot()).toMatchObject({ state: clock(), error: null });
  });

  it("an action deadline reconciles a possibly committed write without resending it", async () => {
    const f = fixture();
    await f.controller.start("ana");
    const held = deferred<TillClockState>();
    f.api.clockIn.mockReturnValue(held.promise);
    f.api.getClockState.mockResolvedValue(clock("working", "saved"));
    const action = f.controller.act("in");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await action).toEqual(clock("working", "saved"));
    expect(f.api.clockIn.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(f.api.clockIn).toHaveBeenCalledTimes(1);
    held.resolve(clock("working", "late"));
    await flush();
    expect(f.settled.mock.calls).toEqual([["in", clock("working", "saved")]]);
  });

  it("stop drops a retained uncertain completion and all timers", async () => {
    const f = fixture();
    await f.controller.start("ana");
    const held = deferred<TillClockState>();
    f.api.clockIn.mockRejectedValue(new TypeError("lost"));
    f.api.getClockState.mockReturnValueOnce(held.promise);
    const action = f.controller.act("in");
    await flush();
    f.controller.stop();
    held.resolve(clock("working", "saved"));
    await action;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.settled).not.toHaveBeenCalled();
    expect(f.api.getClockState).toHaveBeenCalledTimes(2);
    expect(f.snapshot()).toEqual({
      state: null,
      reading: false,
      busy: false,
      error: null,
      refusal: null,
    });
  });

  it("checks generation again after changed callback before settling", async () => {
    const f = fixture();
    await f.controller.start("ana");
    f.changed.mockImplementation((snapshot) => {
      if (snapshot.state?.lastEntryId === "in") f.controller.stop();
    });
    await f.controller.act("in");
    expect(f.settled).not.toHaveBeenCalled();
  });

  it("polling leaves the same idle deadline in place", async () => {
    const f = fixture();
    const idle = vi.fn();
    const activity = new SessionActivity({
      wakeLock: { request: async () => ({ released: false, release: async () => {} }) },
    });
    activity.configure({ loggedIn: true, kind: "till", timeoutSeconds: 60, onIdle: idle });
    await activity.start();
    await f.controller.start("ana");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(idle).not.toHaveBeenCalled();
    expect(f.api.getClockState.mock.calls.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toHaveBeenCalledTimes(1);
    await activity.stop();
  });
});
