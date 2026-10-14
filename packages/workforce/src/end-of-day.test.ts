import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { attendanceFixture } from "../test/attendance-fixture.js";
import {
  attendanceDayWork,
  attendanceMail,
  enqueueAttendanceDay,
  readChain,
  verifyChain,
  timeEntries,
} from "./index.js";

const f = attendanceFixture();
const record = () =>
  f.run((tx) =>
    f.backend.timeRecord(tx, {
      personId: f.personId,
      period: { start: "2026-01-05", end: "2026-01-08" },
    }),
  );

describe("completed attendance day", () => {
  it("closes at last qualifying activity, counts immediately and replays one question and end", async () => {
    const open = await f.open();
    const first = await f.process({ facts: [f.fact("2026-01-05T10:00:00Z", "early"), f.fact()] });
    const end = first.automaticEntryIds[0]!;
    expect(first.automaticEntryIds).toHaveLength(1);
    expect(await f.entries()).toMatchObject([
      { id: open, entryKind: "in" },
      {
        id: end,
        entryKind: "out",
        eventAt: "2026-01-05T16:40:00.000Z",
        recordedByPersonId: null,
        authorKind: "automatic",
      },
    ]);
    const projected = await record();
    expect(projected.sessions[0]!.workedMinutes).toBe(460);
    expect(projected.entries.find((e) => e.entry.entryId === end)).toMatchObject({
      confirmed: true,
      confirmedByWorker: false,
    });
    expect(await f.questions()).toMatchObject([
      {
        id: first.questionIds[0],
        shiftKey: `in:${open}`,
        kind: "automatic-out",
        openEntryId: open,
        automaticEntryId: end,
        evidenceKeys: ["order:early", "order:last"],
      },
    ]);
    expect(await f.suite.db.select().from(attendanceMail)).toEqual([]);
    const before = await f.entries();
    expect(await f.process()).toEqual({ automaticEntryIds: [], questionIds: first.questionIds });
    expect(await f.entries()).toEqual(before);
    const [work] = await f.suite.db.select().from(attendanceDayWork);
    expect(work).toMatchObject({ dirtyRevision: 1, evaluatedRevision: 1, deferredShiftIds: [] });
    expect(
      verifyChain(await readChain(f.suite.db, { nodeId: f.nodeId, locationId: f.locationId })),
    ).toEqual({ ok: true });
  });
  it.each([
    { times: [] },
    { times: ["2026-01-05T09:00:00.999Z"] },
    { times: ["2026-01-06T04:00:00.000Z"] },
  ])("does not invent a later second for no eligible later activity %j", async ({ times }) => {
    const open = await f.open();
    const before = await f.entries();
    expect(await f.process({ facts: times.map((at) => f.fact(at)) })).toMatchObject({
      automaticEntryIds: [],
    });
    expect(await f.entries()).toEqual(before);
    const [q] = await f.questions();
    expect(q).toMatchObject({
      shiftKey: `in:${open}`,
      kind: "missing-times",
      missingKinds: ["out"],
    });
    expect(await f.suite.db.select().from(attendanceMail)).toMatchObject([
      { questionId: q!.id, status: "pending" },
    ]);
  });
  it("excludes another person, another location and both sides of the business-day window", async () => {
    await f.open();
    await f.process({
      facts: [
        f.fact(),
        { ...f.fact("2026-01-05T20:00:00Z", "other"), personId: f.other },
        { ...f.fact("2026-01-05T21:00:00Z", "elsewhere"), locationId: f.elsewhere },
        f.fact("2026-01-05T03:59:59Z", "before"),
        f.fact("2026-01-06T04:00:00Z", "after"),
      ],
    });
    expect((await f.entries()).at(-1)!.eventAt).toBe("2026-01-05T16:40:00.000Z");
    expect((await f.questions()).map((q) => q.evidenceKeys)).toEqual([["order:last"]]);
  });
  it.each(["2026-01-05T17:00:00.000Z", null])(
    "closes a trailing break using %s without a fabricated break end",
    async (at) => {
      await f.open();
      await f.run((tx) => f.backend.breakStart(tx, f.event("2026-01-05T16:00:00Z")));
      await f.process({ facts: at === null ? [] : [f.fact(at)] });
      expect((await f.entries()).map((e) => e.entryKind)).toEqual(["in", "break_start", "out"]);
      expect((await f.entries()).at(-1)!.eventAt).toBe(at ?? "2026-01-05T16:00:00.000Z");
      expect((await record()).sessions[0]!.workedMinutes).toBe(420);
    },
  );
  it("appends a past-time end at the current head without changing another worker's newer row", async () => {
    await f.open();
    await f.run((tx) =>
      f.backend.clockIn(tx, { ...f.event("2026-01-06T09:00:00Z"), personId: f.other }),
    );
    const before = await f.entries();
    await f.process();
    const after = await f.entries();
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toMatchObject({
      sequenceNo: 3,
      eventAt: "2026-01-05T16:40:00.000Z",
      prevEntryHash: before[1]!.entryHash,
    });
    expect(
      verifyChain(await readChain(f.suite.db, { nodeId: f.nodeId, locationId: f.locationId })),
    ).toEqual({ ok: true });
  });
  it("leaves a corrected start after the proposed end as missing, with unchanged rows and head", async () => {
    const open = await f.open();
    const request = await f.run((tx) =>
      f.backend.requestCorrection(tx, {
        nodeId: f.nodeId,
        correctsEntryId: open,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "Started later",
        actorPersonId: f.personId,
        origin: f.event("").origin,
      }),
    );
    await f.run((tx) =>
      f.backend.approveCorrection(tx, {
        nodeId: f.nodeId,
        correctionId: request,
        approverPersonId: f.manager,
      }),
    );
    const before = await f.state();
    await f.process();
    expect((await f.state()).entries).toEqual(before.entries);
    expect((await f.state()).chains).toEqual(before.chains);
    expect(await f.questions()).toMatchObject([
      { openEntryId: open, kind: "missing-times", missingKinds: ["out"] },
    ]);
  });
  it("preserves a next-day same-person break rather than appending an old finish behind it", async () => {
    await f.open();
    await f.run((tx) => f.backend.breakStart(tx, f.event("2026-01-06T09:00:00Z")));
    const before = await f.state();
    await f.process();
    expect((await f.state()).entries).toEqual(before.entries);
    expect((await f.state()).chains).toEqual(before.chains);
    expect(await f.questions()).toMatchObject([{ kind: "missing-times", missingKinds: ["out"] }]);
  });
  it("does not add an end when a real later out already exists", async () => {
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-06T09:00:00Z")));
    const before = await f.state();
    expect(await f.process()).toEqual({ automaticEntryIds: [], questionIds: [] });
    expect((await f.state()).entries).toEqual(before.entries);
    expect((await f.state()).chains).toEqual(before.chains);
    expect(await f.questions()).toEqual([]);
  });
  it("keeps an old no-activity question across tomorrow instead of using tomorrow's activity", async () => {
    const open = await f.open();
    const first = await f.process({ facts: [] });
    const next = {
      ...f.day(),
      businessDay: "2026-01-06",
      startAt: "2026-01-06T04:00:00.000Z",
      endAt: "2026-01-07T04:00:00.000Z",
    };
    await f.run((tx) => enqueueAttendanceDay(tx, next));
    await f.process({
      day: next,
      now: new Date(next.endAt),
      facts: [f.fact("2026-01-06T17:00:00Z", "tomorrow")],
    });
    expect(await f.entries()).toMatchObject([{ id: open, entryKind: "in" }]);
    expect((await f.questions()).find((q) => q.id === first.questionIds[0])).toMatchObject({
      openEntryId: open,
      day: f.day(),
      missingKinds: ["out"],
    });
  });
  it("retains late evidence against the original automatic end without changing counted time", async () => {
    await f.open();
    const first = await f.process();
    const before = await f.entries();
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    const later = await f.process({ facts: [f.fact(), f.fact("2026-01-05T18:00:00Z", "late")] });
    expect(later).toEqual({ automaticEntryIds: [], questionIds: first.questionIds });
    expect(await f.entries()).toEqual(before);
    expect((await f.questions())[0]).toMatchObject({
      automaticEntryId: first.automaticEntryIds[0],
      evidenceKeys: ["order:last", "order:late"],
    });
    expect((await record()).sessions[0]!.workedMinutes).toBe(460);
  });
  it("creates one missing-shift question for matching rota and work, and separate split shifts", async () => {
    const planned = [
      f.plan("morning", "2026-01-05T09:00:00Z", "2026-01-05T12:00:00Z"),
      f.plan("evening", "2026-01-05T16:00:00Z", "2026-01-05T20:00:00Z"),
    ];
    await f.process({ planned, facts: [f.fact("2026-01-05T10:00:00Z", "morning")] });
    expect(await f.entries()).toEqual([]);
    expect(
      (await f.questions())
        .map((q) => ({
          shiftKey: q.shiftKey,
          missingKinds: q.missingKinds,
          evidenceKeys: q.evidenceKeys,
        }))
        .sort((a, b) => a.shiftKey.localeCompare(b.shiftKey)),
    ).toEqual([
      { shiftKey: "rota:evening", missingKinds: ["in", "out"], evidenceKeys: [] },
      { shiftKey: "rota:morning", missingKinds: ["in", "out"], evidenceKeys: ["order:morning"] },
    ]);
    expect(await f.suite.db.select().from(attendanceMail)).toHaveLength(2);
  });
  it("creates unscheduled work questions for separate gaps around real clock intervals", async () => {
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    await f.process({
      facts: [
        f.fact("2026-01-05T08:00:00Z", "before"),
        f.fact("2026-01-05T11:00:00Z", "inside"),
        f.fact("2026-01-05T13:00:00Z", "after"),
      ],
    });
    expect(await f.entries()).toHaveLength(2);
    const qs = await f.questions();
    expect(qs).toHaveLength(2);
    expect(qs.map((q) => q.evidenceKeys).sort()).toEqual([["order:after"], ["order:before"]]);
    const after = qs.find((q) => q.evidenceKeys.includes("order:after"))!;
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    await f.process({
      facts: [f.fact("2026-01-05T12:30:00Z", "earlier"), f.fact("2026-01-05T13:00:00Z", "after")],
    });
    expect((await f.questions()).find((q) => q.id === after.id)!.evidenceKeys).toEqual([
      "order:after",
      "order:earlier",
    ]);
    expect(await f.suite.db.select().from(attendanceMail)).toHaveLength(2);
  });
  it("matches each real interval to at most one plan, excluding an exact touching endpoint", async () => {
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    await f.process({
      facts: [],
      planned: [
        f.plan("first", "2026-01-05T09:00:00Z", "2026-01-05T12:00:00Z"),
        f.plan("overlap", "2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z"),
        f.plan("touching", "2026-01-05T12:00:00Z", "2026-01-05T13:00:00Z"),
      ],
    });
    expect((await f.questions()).map((q) => q.shiftKey).sort()).toEqual([
      "rota:overlap",
      "rota:touching",
    ]);
  });
  it("defers an overnight no-show until its shift end, then retains one reminder on replay", async () => {
    const planned = [f.plan("overnight", "2026-01-06T02:00:00Z", "2026-01-06T06:00:00Z")];
    await f.process({ facts: [], planned });
    expect(await f.questions()).toEqual([]);
    expect(await f.suite.db.select().from(attendanceDayWork)).toMatchObject([
      {
        evaluatedRevision: 1,
        nextDueAt: "2026-01-06T06:00:00.000Z",
        deferredShiftIds: ["overnight"],
      },
    ]);
    const first = await f.process({ facts: [], planned, now: new Date("2026-01-06T06:00:00Z") });
    expect((await f.questions())[0]).toMatchObject({
      shiftKey: "rota:overnight",
      missingKinds: ["in", "out"],
    });
    expect(await f.process({ facts: [], planned, now: new Date("2026-01-06T07:00:00Z") })).toEqual({
      automaticEntryIds: [],
      questionIds: first.questionIds,
    });
    expect(await f.suite.db.select().from(attendanceMail)).toHaveLength(1);
    expect(await f.suite.db.select().from(attendanceDayWork)).toMatchObject([
      { deferredShiftIds: [] },
    ]);
  });
  it("creates nothing for an empty day and refuses an unfinished day without writes", async () => {
    expect(await f.process({ facts: [] })).toEqual({ automaticEntryIds: [], questionIds: [] });
    await f.open();
    const before = await f.state();
    await expect(f.process({ now: new Date("2026-01-06T03:59:59Z") })).rejects.toMatchObject({
      code: "attendance.invalid",
    });
    expect(await f.state()).toEqual(before);
  });
  it("refuses changed saved bounds and rolls back an append if question persistence fails", async () => {
    await f.open();
    const before = await f.state();
    await expect(
      f.process({ day: { ...f.day(), startAt: "2026-01-05T05:00:00Z" } }),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await f.state()).toEqual(before);
    await f.suite.db.run(
      sql`create temp trigger refuse_attendance_question before insert on attendance_questions begin select raise(abort, 'question test refusal'); end`,
    );
    try {
      await expect(f.process()).rejects.toThrow("question test refusal");
      expect(await f.state()).toEqual(before);
    } finally {
      await f.suite.db.run(sql`drop trigger refuse_attendance_question`);
    }
    expect((await f.process()).automaticEntryIds).toHaveLength(1);
    expect(
      await f.suite.db.select().from(timeEntries).where(eq(timeEntries.entryKind, "out")),
    ).toHaveLength(1);
  });
});
