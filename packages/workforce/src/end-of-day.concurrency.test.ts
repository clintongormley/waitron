import { describe, expect, it } from "vitest";
import { attendanceFixture } from "../test/attendance-fixture.js";
import { readChain, verifyChain } from "./index.js";

const f = attendanceFixture();
const gate = () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
};
const validChain = async () =>
  expect(
    verifyChain(await readChain(f.suite.db, { nodeId: f.nodeId, locationId: f.locationId })),
  ).toEqual({ ok: true });

describe("queued attendance processing and live clock transitions", () => {
  it("two passes queued behind a held writer commit one automatic end and question", async () => {
    await f.open();
    const started = gate(),
      held = gate();
    const holder = f.run(async () => {
      started.release();
      await held.waiting;
    });
    await started.waiting;
    const first = f.process(),
      second = f.process();
    held.release();
    await holder;
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.automaticEntryIds.length)).toEqual([1, 0]);
    expect(results[0]!.questionIds).toEqual(results[1]!.questionIds);
    expect((await f.entries()).map((r) => r.entryKind)).toEqual(["in", "out"]);
    expect(await f.questions()).toHaveLength(1);
    await validChain();
  });
  it("a real out committing first makes the waiting pass recheck and append nothing", async () => {
    await f.open();
    const started = gate(),
      held = gate();
    const live = f.run(async (tx) => {
      await f.backend.clockOut(tx, f.event("2026-01-05T17:00:00Z"));
      started.release();
      await held.waiting;
    });
    await started.waiting;
    const pass = f.process();
    held.release();
    await live;
    expect(await pass).toEqual({ automaticEntryIds: [], questionIds: [] });
    expect((await f.entries()).at(-1)).toMatchObject({
      eventAt: "2026-01-05T17:00:00.000Z",
      authorKind: "worker",
    });
    expect(await f.questions()).toEqual([]);
    await validChain();
  });
  it("a processor committing first leaves its end intact when the stale live out is refused", async () => {
    await f.open();
    const started = gate(),
      held = gate();
    const pass = f.run(async (tx) => {
      const result = await f.processor(tx, f.input());
      started.release();
      await held.waiting;
      return result;
    });
    await started.waiting;
    const live = f
      .run((tx) => f.backend.clockOut(tx, f.event("2026-01-06T09:00:00Z")))
      .then(
        () => ({ code: "ok" }),
        (error: unknown) => error,
      );
    held.release();
    const result = await pass;
    expect(await live).toMatchObject({ code: "attendance.no_open_entry" });
    expect(result.automaticEntryIds).toHaveLength(1);
    expect((await f.entries()).at(-1)).toMatchObject({
      eventAt: "2026-01-05T16:40:00.000Z",
      authorKind: "automatic",
    });
    expect(await f.questions()).toHaveLength(1);
    await validChain();
  });
  it("admits an ordinary next-day clock-in arriving after the processor transaction starts", async () => {
    await f.open();
    const started = gate(),
      held = gate();
    const pass = f.run(async (tx) => {
      await f.processor(tx, f.input());
      started.release();
      await held.waiting;
    });
    await started.waiting;
    const live = f
      .run((tx) => f.backend.clockIn(tx, f.event("2026-01-06T09:00:00Z")))
      .then(
        () => "ok",
        (error: unknown) => error,
      );
    held.release();
    await pass;
    expect(await live).toBe("ok");
    expect((await f.entries()).map((r) => ({ kind: r.entryKind, at: r.eventAt }))).toEqual([
      { kind: "in", at: "2026-01-05T09:00:00.000Z" },
      { kind: "out", at: "2026-01-05T16:40:00.000Z" },
      { kind: "in", at: "2026-01-06T09:00:00.000Z" },
    ]);
    await validChain();
  });
});
