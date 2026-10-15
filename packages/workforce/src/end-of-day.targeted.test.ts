import { describe, expect, it } from "vitest";
import { attendanceFixture } from "../test/attendance-fixture.js";
import { enqueueAttendanceDay } from "./index.js";

const f = attendanceFixture();

describe("a clock caller reconciles only its worker", () => {
  it("keeps later-day unclocked work separate from yesterday's automatic finish", async () => {
    await f.open();
    await f.process();
    const before = await f.entries();
    const day = {
      ...f.day(),
      businessDay: "2026-01-06",
      startAt: "2026-01-06T04:00:00.000Z",
      endAt: "2026-01-07T04:00:00.000Z",
    };
    await f.run((tx) => enqueueAttendanceDay(tx, day));
    await f.process({
      day,
      now: new Date(day.endAt),
      facts: [f.fact("2026-01-06T16:00:00Z", "next-day")],
    });
    expect(await f.entries()).toEqual(before);
    const questions = await f.questions();
    expect(questions).toHaveLength(2);
    expect(questions.find((q) => q.day.businessDay === "2026-01-06")).toMatchObject({
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["order:next-day"],
      openEntryId: null,
    });
  });
  it("leaves the shared day revision and other workers untouched until a complete pass", async () => {
    await f.open();
    await f.run((tx) =>
      f.backend.clockIn(tx, { ...f.event("2026-01-05T10:00:00Z"), personId: f.other }),
    );
    const before = await f.state();
    const input = { ...f.input(), personId: f.personId };
    const result = await f.run((tx) => f.processor(tx, input));
    expect(result.automaticEntryIds).toHaveLength(1);
    const targeted = await f.state();
    expect(targeted.work).toEqual(before.work);
    expect(targeted.questions.map((q) => q.personId)).toEqual([f.personId]);
    expect(targeted.entries.filter((e) => e.personId === f.other)).toEqual(
      before.entries.filter((e) => e.personId === f.other),
    );
    await f.process({ facts: [f.fact(), { ...f.fact(undefined, "other"), personId: f.other }] });
    const full = await f.state();
    expect(full.entries.filter((e) => e.personId === f.other).map((e) => e.entryKind)).toEqual([
      "in",
      "out",
    ]);
    expect(full.work[0]).toMatchObject({ dirtyRevision: 1, evaluatedRevision: 1 });
  });
  it("does not create another worker's rota or activity questions from a partial pass", async () => {
    const before = await f.state();
    const input = {
      ...f.input({
        facts: [{ ...f.fact(), personId: f.other }],
        planned: [
          {
            ...f.plan("other-shift", "2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
            personId: f.other,
          },
        ],
      }),
      personId: f.personId,
    };
    expect(await f.run((tx) => f.processor(tx, input))).toEqual({
      automaticEntryIds: [],
      questionIds: [],
    });
    expect(await f.state()).toEqual(before);
  });
});
