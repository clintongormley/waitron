import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AttendanceCommand,
  AttendanceCommandResult,
  AttendanceDayView,
  AttendanceInbox,
} from "../api/client.js";
import type { AttendanceController, AttendanceSnapshot } from "./attendance.js";
import { SessionActivity } from "../session-activity.js";

const modules = import.meta.glob<typeof import("./attendance.js")>("./attendance.ts");
const command: AttendanceCommand = {
  action: "confirm",
  commandId: "command",
  questionId: "question",
  expectedRevision: "r1",
};
const saved: AttendanceCommandResult = {
  commandId: "command",
  entryIds: ["answer"],
  replayed: false,
};
function inbox(personId = "ana", revision = "r1"): AttendanceInbox {
  return {
    personId,
    revision,
    prompts: [],
    items: [],
    locations: [{ id: "venue", name: "Local", timeZone: "Europe/Madrid" }],
  };
}
function day(date = "2026-10-14", personId = "ana", locationId = "venue"): AttendanceDayView {
  return {
    personId,
    locationId,
    date,
    timeZone: "Europe/Madrid",
    revision: "r1",
    record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
    items: [],
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
const controllers: AttendanceController[] = [];
async function fixture() {
  expect(modules["./attendance.ts"], "attendance controller exists").toBeTypeOf("function");
  const { AttendanceController } = await modules["./attendance.ts"]!();
  const api = {
    getAttendanceInbox: vi.fn().mockResolvedValue(inbox()),
    getAttendanceDay: vi.fn().mockResolvedValue(day()),
    getAttendanceCommand: vi.fn().mockResolvedValue(null),
    listAttendanceApprovers: vi.fn().mockResolvedValue([]),
    sendAttendanceCommand: vi.fn().mockResolvedValue(saved),
  };
  const changed = vi.fn<(value: AttendanceSnapshot) => void>();
  const controller = new AttendanceController(api, changed);
  controllers.push(controller);
  return { api, controller, changed, snapshot: () => changed.mock.calls.at(-1)![0] };
}
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  }),
);
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  vi.useRealTimers();
});

describe("attendance state ownership", () => {
  it("stop aborts every outstanding inbox, day and picker read", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.getAttendanceInbox.mockReturnValueOnce(new Promise(() => {}));
    f.api.getAttendanceDay.mockReturnValueOnce(new Promise(() => {}));
    f.api.listAttendanceApprovers.mockReturnValueOnce(new Promise(() => {}));
    const reads = [
      f.controller.refresh(),
      f.controller.readDay("2026-10-14", "venue"),
      f.controller.readApprovers("item", "approve"),
    ];
    const signals = [
      f.api.getAttendanceInbox.mock.calls.at(-1)![0].signal,
      f.api.getAttendanceDay.mock.calls[0]![2].signal,
      f.api.listAttendanceApprovers.mock.calls[0]![2].signal,
    ] as AbortSignal[];
    f.controller.stop();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, true]);
    await Promise.all(reads);
    expect(f.snapshot()).toMatchObject({
      reading: false,
      dayReading: false,
      approversReading: false,
    });
  });

  it.each(["inbox", "day", "write", "receipt"] as const)(
    "a %s completion queued beside logout cannot publish or return the old result",
    async (phase) => {
      const f = await fixture();
      await f.controller.start("ana");
      function completeAtLogout<T>(answer: T): Promise<T> {
        return Promise.resolve(answer).then((value) => {
          queueMicrotask(() => f.controller.stop());
          return value;
        });
      }
      if (phase === "inbox") {
        f.api.getAttendanceInbox.mockImplementationOnce(() => completeAtLogout(inbox()));
        await f.controller.refresh();
      } else if (phase === "day") {
        f.api.getAttendanceDay.mockImplementationOnce(() => completeAtLogout(day()));
        expect(await f.controller.readDay("2026-10-14", "venue")).toBeNull();
      } else {
        if (phase === "receipt") {
          f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
          f.api.getAttendanceCommand.mockImplementationOnce(() => completeAtLogout(saved));
        } else f.api.sendAttendanceCommand.mockImplementationOnce(() => completeAtLogout(saved));
        expect(await f.controller.act(command)).toBeNull();
      }
      expect(f.snapshot()).toMatchObject({
        inbox: null,
        day: null,
        reading: false,
        busy: false,
        result: null,
        actionError: null,
      });
    },
  );

  it("a forced logout on a lost-answer notification prevents even the recovery GET", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    f.changed.mockImplementation((snapshot) => {
      if (snapshot.uncertainCommandId !== null) f.controller.stop();
    });
    expect(await f.controller.act(command)).toBeNull();
    expect(f.api.getAttendanceCommand).not.toHaveBeenCalled();
    expect(f.snapshot().uncertainCommandId).toBeNull();
  });

  it.each([
    "inbox-start",
    "day-start",
    "write-start",
    "receipt-start",
    "receipt-found",
    "receipt-absent",
    "write-success",
    "day-success",
  ] as const)("a synchronous forced logout at %s prevents continuation", async (phase) => {
    const f = await fixture();
    await f.controller.start("ana");
    if (phase.startsWith("receipt"))
      f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    if (phase === "receipt-found") f.api.getAttendanceCommand.mockResolvedValueOnce(saved);
    let stopped = false;
    f.changed.mockImplementation((snapshot) => {
      const mustStop =
        phase === "inbox-start"
          ? snapshot.reading
          : phase === "day-start"
            ? snapshot.dayReading
            : phase === "write-start"
              ? snapshot.busy
              : phase === "receipt-start"
                ? snapshot.uncertainCommandId !== null && snapshot.reading
                : phase === "receipt-absent"
                  ? snapshot.retryCommand !== null
                  : phase === "day-success"
                    ? snapshot.day !== null
                    : snapshot.result !== null;
      if (mustStop && !stopped) {
        stopped = true;
        f.controller.stop();
      }
    });
    if (phase === "inbox-start") await f.controller.refresh();
    else if (phase.startsWith("day"))
      expect(await f.controller.readDay("2026-10-14", "venue")).toBeNull();
    else expect(await f.controller.act(command)).toBeNull();
    expect(stopped).toBe(true);
    expect(f.snapshot()).toMatchObject({
      inbox: null,
      result: null,
      busy: false,
      reading: false,
      day: null,
      uncertainCommandId: null,
    });
    if (phase.endsWith("start")) {
      if (phase === "inbox-start") expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
      if (phase === "day-start") expect(f.api.getAttendanceDay).not.toHaveBeenCalled();
      if (phase === "write-start") expect(f.api.sendAttendanceCommand).not.toHaveBeenCalled();
      if (phase === "receipt-start") expect(f.api.getAttendanceCommand).not.toHaveBeenCalled();
    }
    if (phase === "receipt-absent") expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
  });

  it("coalesces refreshes while an inbox or recovery read is already pending", async () => {
    const f = await fixture();
    const initial = deferred<AttendanceInbox>();
    f.api.getAttendanceInbox.mockReturnValueOnce(initial.promise);
    const start = f.controller.start("ana");
    await f.controller.refresh();
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
    initial.resolve(inbox());
    await start;
    const receipt = deferred<AttendanceCommandResult | null>();
    f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    f.api.getAttendanceCommand.mockReturnValueOnce(receipt.promise);
    const action = f.controller.act(command);
    await vi.waitFor(() => expect(f.api.getAttendanceCommand).toHaveBeenCalledTimes(1));
    await f.controller.refresh();
    await f.controller.retryRead();
    expect(f.api.getAttendanceCommand).toHaveBeenCalledTimes(1);
    receipt.resolve(saved);
    expect(await action).toEqual(saved);
  });

  it("does not read or write without an operator", async () => {
    const f = await fixture();
    await f.controller.refresh();
    await f.controller.retryRead();
    expect(await f.controller.act(command)).toBeNull();
    expect(await f.controller.readDay("2026-10-14", "venue")).toBeNull();
    expect(await f.controller.readApprovers("item", "approve")).toBeNull();
    for (const method of Object.values(f.api)) expect(method).not.toHaveBeenCalled();
  });

  it.each([null, "unknown", { code: 12 }, { code: "correction.not_pending", status: 409 }])(
    "keeps a recoverable refusal for %j without a receipt lookup",
    async (error) => {
      const f = await fixture();
      await f.controller.start("ana");
      f.api.sendAttendanceCommand.mockRejectedValueOnce(error);
      expect(await f.controller.act(command)).toBeNull();
      expect(f.snapshot().actionError).toEqual({
        code:
          typeof error === "object" && error !== null && typeof error.code === "string"
            ? "correction.not_pending"
            : "attendance.write_failed",
      });
      expect(f.api.getAttendanceCommand).not.toHaveBeenCalled();
    },
  );
  it("reads on entry and explicit refresh, without polling full attendance history", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    expect(f.snapshot()).toMatchObject({
      inbox: inbox(),
      reading: false,
      busy: false,
      uncertainCommandId: null,
      readError: null,
      actionError: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
    await f.controller.refresh();
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(2);
  });

  it("two taps send once; successful writes return before a separate refresh can fail", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    const write = deferred<AttendanceCommandResult>();
    f.api.sendAttendanceCommand.mockReturnValueOnce(write.promise);
    const first = f.controller.act(command);
    expect(await f.controller.act(command)).toBeNull();
    await f.controller.refresh();
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
    write.resolve(saved);
    expect(await first).toEqual(saved);
    expect(f.snapshot()).toMatchObject({ busy: false, result: saved, actionError: null });
    expect(f.api.getAttendanceInbox).toHaveBeenCalledTimes(1);
    f.api.getAttendanceInbox.mockRejectedValueOnce(new TypeError("refresh lost"));
    await f.controller.refresh();
    expect(f.snapshot()).toMatchObject({
      result: saved,
      actionError: null,
      readError: { code: "attendance.read_failed" },
    });
  });

  it("invalidates old reads before a write and ignores old finally after an operator switch", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    const old = deferred<AttendanceInbox>();
    f.api.getAttendanceInbox.mockReturnValueOnce(old.promise);
    const read = f.controller.refresh();
    const signal = f.api.getAttendanceInbox.mock.calls.at(-1)![0].signal as AbortSignal;
    expect(await f.controller.act(command)).toEqual(saved);
    expect(signal.aborted).toBe(true);
    old.resolve(inbox("ana", "old"));
    await read;
    expect(f.snapshot().result).toEqual(saved);
    const pending = deferred<AttendanceInbox>();
    f.api.getAttendanceInbox.mockReturnValueOnce(pending.promise);
    const next = f.controller.start("luis");
    expect(f.snapshot()).toMatchObject({ inbox: null, reading: true, result: null });
    pending.resolve(inbox("luis"));
    await next;
    expect(f.snapshot().inbox?.personId).toBe("luis");
  });

  it.each(["read", "write", "receipt"] as const)(
    "stopping a pending %s cannot change a new operator's state",
    async (phase) => {
      const f = await fixture();
      await f.controller.start("ana");
      const old = deferred<never>();
      if (phase === "read") f.api.getAttendanceInbox.mockReturnValueOnce(old.promise);
      if (phase === "write") f.api.sendAttendanceCommand.mockReturnValueOnce(old.promise);
      if (phase === "receipt") {
        f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
        f.api.getAttendanceCommand.mockReturnValueOnce(old.promise);
      }
      const previous = phase === "read" ? f.controller.refresh() : f.controller.act(command);
      if (phase === "receipt")
        await vi.waitFor(() => expect(f.api.getAttendanceCommand).toHaveBeenCalledTimes(1));
      f.api.getAttendanceInbox.mockResolvedValue(inbox("luis"));
      await f.controller.start("luis");
      const current = deferred<AttendanceCommandResult>();
      f.api.sendAttendanceCommand.mockReturnValueOnce(current.promise);
      const newWrite = f.controller.act({ ...command, commandId: "luis-command" });
      old.reject({ code: "pin.invalid" });
      await previous;
      expect(f.snapshot()).toMatchObject({
        busy: true,
        inbox: inbox("luis"),
        actionError: null,
        readError: null,
        result: null,
      });
      current.resolve({ ...saved, commandId: "luis-command" });
      await newWrite;
      expect(f.snapshot().result?.commandId).toBe("luis-command");
    },
  );

  it("recovers a lost response by its receipt without replaying a POST or retaining the PIN", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    f.api.getAttendanceCommand.mockResolvedValueOnce({ ...saved, replayed: true });
    const override = { personId: "manager", pin: "1234" };
    expect(await f.controller.act(command, override)).toEqual({ ...saved, replayed: true });
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
    expect(f.api.getAttendanceCommand).toHaveBeenCalledWith("command", {
      signal: expect.any(AbortSignal),
    });
    expect(f.snapshot()).toMatchObject({
      uncertainCommandId: null,
      result: { ...saved, replayed: true },
    });
    expect(JSON.stringify(f.snapshot())).not.toContain("1234");
  });

  it("keeps uncertainty after a failed receipt read and Retry read settles only that command", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    f.api.getAttendanceCommand.mockRejectedValueOnce(new TypeError("still offline"));
    expect(await f.controller.act(command)).toBeNull();
    expect(f.snapshot()).toMatchObject({
      uncertainCommandId: "command",
      busy: false,
      readError: { code: "attendance.read_failed" },
    });
    expect(await f.controller.act({ ...command, commandId: "other" })).toBeNull();
    f.api.getAttendanceCommand.mockResolvedValueOnce({ ...saved, replayed: true });
    await f.controller.retryRead();
    expect(f.snapshot()).toMatchObject({
      uncertainCommandId: null,
      result: { ...saved, replayed: true },
      readError: null,
    });
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
  });

  it("a known absent receipt refreshes before offering an explicit retry of the same command", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.sendAttendanceCommand.mockRejectedValueOnce(new TypeError("lost"));
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox("ana", "r2"));
    expect(await f.controller.act(command)).toBeNull();
    expect(f.snapshot()).toMatchObject({
      uncertainCommandId: null,
      retryCommand: command,
      inbox: inbox("ana", "r2"),
      result: null,
    });
    expect(f.api.sendAttendanceCommand).toHaveBeenCalledTimes(1);
    expect(await f.controller.act(command)).toEqual(saved);
    expect(f.api.sendAttendanceCommand.mock.calls[1]![0]).toEqual(command);
  });

  it("read recovery preserves an action refusal and its parameters", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    f.api.sendAttendanceCommand.mockRejectedValueOnce({
      code: "pin.throttled",
      retryAfterSeconds: 12,
      status: 429,
    });
    expect(await f.controller.act(command)).toBeNull();
    f.api.getAttendanceInbox.mockRejectedValueOnce(new TypeError("read"));
    await f.controller.refresh();
    await f.controller.retryRead();
    expect(f.snapshot()).toMatchObject({
      readError: null,
      actionError: { code: "pin.throttled", params: { retryAfterSeconds: 12 } },
    });
    expect(f.api.getAttendanceCommand).not.toHaveBeenCalled();
  });

  it("bounds reads and writes at 25 seconds, then resolves an uncertain timeout by receipt", async () => {
    const f = await fixture();
    const read = deferred<AttendanceInbox>();
    f.api.getAttendanceInbox.mockReturnValueOnce(read.promise);
    const first = f.controller.start("ana");
    await vi.advanceTimersByTimeAsync(25_000);
    await first;
    expect(f.api.getAttendanceInbox.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(f.snapshot().readError?.code).toBe("attendance.read_failed");
    await f.controller.retryRead();
    f.api.sendAttendanceCommand.mockReturnValueOnce(new Promise(() => {}));
    f.api.getAttendanceCommand.mockResolvedValueOnce(saved);
    const write = f.controller.act(command);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await write).toEqual(saved);
    expect(f.api.sendAttendanceCommand.mock.calls[0]![2].signal.aborted).toBe(true);
  });

  it("rejects an inbox or command receipt for another person or command", async () => {
    const f = await fixture();
    f.api.getAttendanceInbox.mockResolvedValueOnce(inbox("foreign"));
    await f.controller.start("ana");
    expect(f.snapshot()).toMatchObject({
      inbox: null,
      readError: { code: "attendance.read_failed" },
    });
    await f.controller.retryRead();
    f.api.sendAttendanceCommand.mockResolvedValueOnce({ ...saved, commandId: "foreign-command" });
    f.api.getAttendanceCommand.mockResolvedValueOnce({ ...saved, commandId: "foreign-command" });
    expect(await f.controller.act(command)).toBeNull();
    expect(f.snapshot()).toMatchObject({ result: null, uncertainCommandId: "command" });
  });

  it("a newer day selection wins, and the older completion cannot release its reading flag", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    const old = deferred<AttendanceDayView>();
    const current = deferred<AttendanceDayView>();
    f.api.getAttendanceDay.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = f.controller.readDay("2026-10-13", "venue");
    const oldSignal = f.api.getAttendanceDay.mock.calls[0]![2].signal as AbortSignal;
    const second = f.controller.readDay("2026-10-14", "venue");
    old.resolve(day("2026-10-13"));
    expect(await first).toBeNull();
    expect(oldSignal.aborted).toBe(true);
    expect(f.snapshot()).toMatchObject({ day: null, dayReading: true });
    current.resolve(day());
    expect(await second).toEqual(day());
    expect(f.snapshot()).toMatchObject({ day: day(), dayReading: false, dayError: null });
  });

  it.each(["person", "date", "location"] as const)(
    "rejects a day response with a different %s",
    async (scope) => {
      const f = await fixture();
      await f.controller.start("ana");
      const foreign = {
        ...day(),
        ...(scope === "person"
          ? { personId: "other" }
          : scope === "date"
            ? { date: "2026-10-13" }
            : { locationId: "other" }),
      };
      f.api.getAttendanceDay.mockResolvedValueOnce(foreign);
      expect(await f.controller.readDay("2026-10-14", "venue")).toBeNull();
      expect(f.snapshot()).toMatchObject({
        day: null,
        dayError: { code: "attendance.read_failed" },
      });
      expect(await f.controller.readDay("2026-10-14", "venue")).toEqual(day());
      expect(f.snapshot().dayError).toBeNull();
    },
  );

  it("a write invalidates day and approver reads while a stopped editor cannot publish over a new session", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    const oldDay = deferred<AttendanceDayView>();
    const oldPicker = deferred<{ personId: string; displayName: string }[]>();
    f.api.getAttendanceDay.mockReturnValueOnce(oldDay.promise);
    f.api.listAttendanceApprovers.mockReturnValueOnce(oldPicker.promise);
    const read = f.controller.readDay("2026-10-14", "venue");
    const picker = f.controller.readApprovers("item", "approve");
    expect(await f.controller.act(command)).toEqual(saved);
    oldDay.resolve(day());
    oldPicker.resolve([{ personId: "manager", displayName: "Marta" }]);
    expect(await read).toBeNull();
    expect(await picker).toBeNull();
    expect(f.snapshot()).toMatchObject({
      day: null,
      dayReading: false,
      approvers: null,
      approversReading: false,
    });
    f.api.getAttendanceDay.mockReturnValueOnce(new Promise(() => {}));
    const stopped = f.controller.readDay("2026-10-14", "venue");
    f.controller.stop();
    expect(await stopped).toBeNull();
    expect(f.snapshot().day).toBeNull();
  });

  it("keeps only the current approver selection and recovers its read refusal", async () => {
    const f = await fixture();
    await f.controller.start("ana");
    const old = deferred<{ personId: string; displayName: string }[]>();
    f.api.listAttendanceApprovers
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce({ code: "correction.not_pending" });
    const first = f.controller.readApprovers("old", "approve");
    expect(await f.controller.readApprovers("current", "decline")).toBeNull();
    old.resolve([{ personId: "old-manager", displayName: "Old" }]);
    expect(await first).toBeNull();
    expect(f.snapshot()).toMatchObject({
      approvers: null,
      approversError: { code: "correction.not_pending" },
      approversReading: false,
    });
    f.api.listAttendanceApprovers.mockResolvedValueOnce([
      { personId: "manager", displayName: "Marta" },
    ]);
    expect(await f.controller.readApprovers("current", "approve")).toEqual([
      { personId: "manager", displayName: "Marta" },
    ]);
    expect(f.snapshot().approversError).toBeNull();
  });

  it("attendance reads do not postpone idle logout or reacquire the wake lock", async () => {
    const idle = vi.fn();
    const wakeLock = {
      request: vi
        .fn()
        .mockResolvedValue({ released: false, release: vi.fn().mockResolvedValue(undefined) }),
    };
    const activity = new SessionActivity({ wakeLock });
    activity.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: 30, onIdle: idle });
    await activity.start();
    try {
      const f = await fixture();
      await f.controller.start("ana");
      await vi.advanceTimersByTimeAsync(20_000);
      await f.controller.refresh();
      await f.controller.readDay("2026-10-14", "venue");
      expect(wakeLock.request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(idle).toHaveBeenCalledTimes(1);
    } finally {
      await activity.stop();
    }
  });
});
