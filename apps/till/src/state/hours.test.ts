import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HoursSelection, PersonHours } from "@waitron/workforce/attendance-contract";
import type { ReadOptions } from "../api/client.js";
import type { HoursController, HoursSnapshot } from "./hours.js";
const modules = import.meta.glob<typeof import("./hours.js")>("./hours.ts");
const selection: HoursSelection = { kind: "week", date: "2026-01-05" };
function view(personId = "ana", locationId = "venue", selected = selection): PersonHours {
  return {
    personId,
    locationId,
    selection: { ...selected },
    period: { start: "2026-01-05", end: "2026-01-12" },
    businessDay: "2026-01-06",
    clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
    asOf: "2026-01-06T09:00:00Z",
    days: [],
    workedMinutes: 480,
    record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
    openShifts: [],
    pending: { prompts: [], items: [], automaticEntryIds: [] },
    closures: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const controllers: HoursController[] = [];
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
afterEach(() => {
  for (const controller of controllers.splice(0)) controller?.stop();
  vi.useRealTimers();
});
async function fixture() {
  const load = modules["./hours.ts"];
  expect(load, "hours read controller").toBeTypeOf("function");
  const { HoursController } = await load!();
  const getHours = vi
    .fn<
      (locationId: string, selected: HoursSelection, options?: ReadOptions) => Promise<PersonHours>
    >()
    .mockResolvedValue(view());
  const changed = vi.fn<(snapshot: HoursSnapshot) => void>();
  const controller = new HoursController({ getHours }, changed);
  controllers.push(controller);
  return { controller, getHours, changed, snapshot: () => changed.mock.calls.at(-1)![0] };
}
it("reads only on entry, selection or explicit refresh and supplies an abort signal", async () => {
  const f = await fixture();
  await f.controller.refresh();
  expect(f.getHours).not.toHaveBeenCalled();
  await f.controller.start("ana", "venue", selection);
  expect(f.snapshot()).toEqual({ view: view(), reading: false, readError: null });
  expect(f.getHours.mock.calls[0]).toEqual([
    "venue",
    selection,
    { signal: expect.any(AbortSignal) },
  ]);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.getHours).toHaveBeenCalledTimes(1);
  await f.controller.refresh();
  expect(f.getHours).toHaveBeenCalledTimes(2);
});
it("an old selection cannot replace a newer location/date or clear its reading state", async () => {
  const f = await fixture();
  await f.controller.start("ana", "venue", selection);
  const a = deferred<PersonHours>(),
    b = deferred<PersonHours>();
  f.getHours.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const old = f.controller.refresh();
  const oldSignal = f.getHours.mock.calls.at(-1)![2]!.signal!;
  const selected = { kind: "month" as const, date: "2026-02-01" };
  const current = f.controller.select("other", selected);
  expect(oldSignal.aborted).toBe(true);
  expect(f.snapshot()).toEqual({ view: null, reading: true, readError: null });
  a.resolve(view());
  await old;
  expect(f.snapshot()).toEqual({ view: null, reading: true, readError: null });
  b.resolve(view("ana", "other", selected));
  await current;
  expect(f.snapshot().view).toEqual(view("ana", "other", selected));
});
it("a late refresh cannot replace a newer response or its refusal", async () => {
  const f = await fixture();
  await f.controller.start("ana", "venue", selection);
  const old = deferred<PersonHours>();
  f.getHours.mockReturnValueOnce(old.promise);
  const pending = f.controller.refresh();
  f.getHours.mockRejectedValueOnce({
    code: "attendance.not_permitted",
    params: { personId: "ana" },
    status: 403,
  });
  await f.controller.refresh();
  old.resolve({ ...view(), workedMinutes: 999 });
  await pending;
  expect(f.snapshot()).toEqual({
    view: view(),
    reading: false,
    readError: { code: "attendance.not_permitted", params: { personId: "ana" } },
  });
  await f.controller.refresh();
  expect(f.snapshot().readError).toBeNull();
});
it.each(["person", "same-person-session", "server-profile", "stop"] as const)(
  "%s teardown aborts and forgets every old read",
  async (kind) => {
    const f = await fixture();
    await f.controller.start("ana", "venue", selection);
    const pending = deferred<PersonHours>();
    f.getHours.mockReturnValueOnce(pending.promise);
    const old = f.controller.refresh();
    const signal = f.getHours.mock.calls.at(-1)![2]!.signal!;
    if (kind === "stop" || kind === "server-profile") f.controller.stop();
    else {
      const person = kind === "person" ? "bea" : "ana";
      f.getHours.mockResolvedValueOnce(view(person));
      await f.controller.start(person, "venue", selection);
    }
    expect(signal.aborted).toBe(true);
    const current = f.snapshot();
    pending.resolve({ ...view(), workedMinutes: 999 });
    await old;
    expect(f.snapshot()).toEqual(current);
    if (kind === "stop" || kind === "server-profile")
      expect(current).toEqual({ view: null, reading: false, readError: null });
  },
);
it.each(["person", "location", "selection"] as const)(
  "rejects a view for the wrong %s",
  async (kind) => {
    const f = await fixture();
    f.getHours.mockResolvedValueOnce(
      view(
        kind === "person" ? "bea" : "ana",
        kind === "location" ? "other" : "venue",
        kind === "selection" ? { kind: "month" } : selection,
      ),
    );
    await f.controller.start("ana", "venue", selection);
    expect(f.snapshot()).toEqual({
      view: null,
      reading: false,
      readError: { code: "attendance.read_failed" },
    });
  },
);
it("times out a transport that ignores abort at25 seconds and permits retry", async () => {
  const f = await fixture();
  const held = deferred<PersonHours>();
  f.getHours.mockReturnValueOnce(held.promise);
  const reading = f.controller.start("ana", "venue", selection);
  const signal = f.getHours.mock.calls.at(-1)![2]!.signal!;
  await vi.advanceTimersByTimeAsync(24_999);
  expect(f.snapshot().reading).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  await reading;
  expect(signal.aborted).toBe(true);
  expect(f.snapshot()).toEqual({
    view: null,
    reading: false,
    readError: { code: "attendance.read_failed" },
  });
  await f.controller.refresh();
  expect(f.snapshot().view).toEqual(view());
});
it("a selection is captured by value and a stopped changed callback prevents the transport", async () => {
  const f = await fixture();
  const selected = { ...selection };
  await f.controller.start("ana", "venue", selected);
  selected.date = "2026-02-01";
  await f.controller.refresh();
  expect(f.getHours.mock.calls.at(-1)![1]).toEqual(selection);
  f.changed.mockImplementation((value) => {
    if (value.reading) f.controller.stop();
  });
  await f.controller.refresh();
  expect(f.getHours).toHaveBeenCalledTimes(2);
  expect(f.snapshot()).toEqual({ view: null, reading: false, readError: null });
});
