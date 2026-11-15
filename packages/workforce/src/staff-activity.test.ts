import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { dayCutoverChanges } from "@waitron/db";
import { attendanceFixture } from "../test/attendance-fixture.js";
import { shifts } from "./schema/shifts.js";
import { recordStaffActivity, readStaffActivityFacts } from "./staff-activity.js";
import { staffActivity } from "./schema/attendance.js";
import { attendanceDayWork } from "./schema/attendance.js";
import { appendToChain } from "./chain.js";

const f = attendanceFixture();
beforeEach(() => seedBusinessDay(f.suite.db, { timeZone: "UTC", dayCutover: "04:00" }));
const record = (at: string) => f.run((tx) => recordStaffActivity(tx, f.personId, new Date(at)));
const rows = () => f.suite.db.select().from(staffActivity).orderBy(staffActivity.firstAt);
const facts = () => f.run((tx) => readStaffActivityFacts(tx, f.day()));
async function rota(ranges: [string, string][]) {
  return f.run(async (tx) => {
    const versionId = await f.backend.createRosterVersion(tx, { period: "2026-01-05" });
    const ids = [];
    for (const [startsAt, endsAt] of ranges)
      ids.push(
        await f.backend.addShift(tx, {
          personId: f.personId,
          versionId,
          startsAt,
          endsAt,
          startsOffsetMinutes: 0,
          endsOffsetMinutes: 0,
        }),
      );
    await f.backend.publishRoster(tx, { versionId });
    return ids;
  });
}

it("many unscheduled actions keep one pair, with replay and intermediate actions leaving it alone", async () => {
  await record("2026-01-05T09:00:00.987Z");
  await record("2026-01-05T17:00:00Z");
  const before = await rows();
  for (let n = 0; n < 100; n++) await record("2026-01-05T12:00:00Z");
  expect(await rows()).toEqual(before);
  expect(before).toMatchObject([
    {
      personId: f.personId,
      businessDay: "2026-01-05",
      firstAt: "2026-01-05T09:00:00.000Z",
      lastAt: "2026-01-05T17:00:00.000Z",
      shiftStartAt: null,
      shiftEndAt: null,
    },
  ]);
  expect((await facts()).map((row) => row.at)).toEqual([
    "2026-01-05T09:00:00.000Z",
    "2026-01-05T17:00:00.000Z",
  ]);
});

it("keeps separate first/latest pairs for split shifts and each gap, including an overrun", async () => {
  await rota([
    ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z"],
    ["2026-01-05T18:00:00Z", "2026-01-05T22:00:00Z"],
  ]);
  for (const time of ["08:00", "09:00", "12:30", "13:00", "13:30", "18:00", "21:30", "22:00"])
    await record(`2026-01-05T${time}:00Z`);
  expect((await rows()).map((r) => [r.firstAt.slice(11, 16), r.lastAt.slice(11, 16)])).toEqual([
    ["08:00", "08:00"],
    ["09:00", "12:30"],
    ["13:00", "13:30"],
    ["18:00", "21:30"],
    ["22:00", "22:00"],
  ]);
});

it("overnight endpoints stay on the shift-start day, without clipping at the cutover", async () => {
  await rota([["2026-01-06T02:00:00Z", "2026-01-06T06:00:00Z"]]);
  await record("2026-01-06T02:30:00Z");
  await record("2026-01-06T05:30:00Z");
  expect(await rows()).toMatchObject([
    {
      businessDay: "2026-01-05",
      firstAt: "2026-01-06T02:30:00.000Z",
      lastAt: "2026-01-06T05:30:00.000Z",
    },
  ]);
  expect((await facts()).map((r) => r.at)).toEqual([
    "2026-01-06T02:30:00.000Z",
    "2026-01-06T05:30:00.000Z",
  ]);
});

it("moving a rota reassigns real endpoints without inventing activity between them", async () => {
  const [id] = await rota([["2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"]]);
  await record("2026-01-05T10:00:00Z");
  await record("2026-01-05T16:00:00Z");
  const before = await facts();
  await f.run((tx) =>
    tx
      .update(shifts)
      .set({ startsAt: "2026-01-05T12:00:00Z", endsAt: "2026-01-05T14:00:00Z" })
      .where(eq(shifts.id, id!)),
  );
  expect((await facts()).map((r) => r.at)).toEqual(before.map((r) => r.at));
  await record("2026-01-05T13:00:00Z");
  const after = await facts();
  expect(after.map((r) => r.at)).toEqual([
    "2026-01-05T10:00:00.000Z",
    "2026-01-05T13:00:00.000Z",
    "2026-01-05T16:00:00.000Z",
  ]);
  expect(after.map((r) => r.key)).toEqual(expect.arrayContaining(before.map((r) => r.key)));
});

it("records activity while a changed future cutover awaits the day-bounds refresh", async () => {
  await record("2026-01-05T10:00:00Z");
  await f.suite.db
    .insert(dayCutoverChanges)
    .values({ effectiveBusinessDay: "2026-01-06", dayCutover: "06:00:00" });
  await record("2026-01-05T11:00:00Z");
  expect(await rows()).toMatchObject([
    { firstAt: "2026-01-05T10:00:00.000Z", lastAt: "2026-01-05T11:00:00.000Z" },
  ]);
});

it("a legal clock entry marks its day, and a later correction marks every corrected day", async () => {
  const original = await f.open();
  expect((await f.suite.db.select().from(attendanceDayWork))[0]?.dirtyRevision).toBe(2);
  const correction = await f.run((tx) =>
    appendToChain(
      tx,
      { nodeId: f.nodeId },
      {
        personId: f.personId,
        entryKind: "correction",
        eventAt: "2026-01-06T10:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: f.manager,
        origin: f.event("").origin,
        correctsEntryId: original,
        correctionReason: "Wrong time",
        correctionStatus: "requested",
        correctionActorId: f.manager,
      },
    ),
  );
  await f.run((tx) =>
    appendToChain(
      tx,
      { nodeId: f.nodeId },
      {
        personId: f.personId,
        entryKind: "correction",
        eventAt: "2026-01-07T10:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: f.manager,
        origin: f.event("").origin,
        correctsEntryId: correction.id,
        correctionReason: "Corrected time",
        correctionStatus: "requested",
        correctionActorId: f.manager,
      },
    ),
  );
  expect(
    (await f.suite.db.select().from(attendanceDayWork).orderBy(attendanceDayWork.businessDay)).map(
      (r) => [r.businessDay, r.dirtyRevision],
    ),
  ).toEqual([
    ["2026-01-05", 4],
    ["2026-01-06", 2],
    ["2026-01-07", 1],
  ]);
});

it("questions retain only current endpoints as the latest activity moves", async () => {
  await record("2026-01-05T09:00:00Z");
  for (const hour of [17, 18, 19, 20]) {
    await record(`2026-01-05T${hour}:00:00Z`);
    await f.process({ facts: await facts() });
  }
  const [row] = await rows();
  expect((await f.questions()).map((q) => q.evidenceKeys)).toEqual([
    [
      `order:staff:${row!.id}:first:2026-01-05T09:00:00.000Z`,
      `order:staff:${row!.id}:latest:2026-01-05T20:00:00.000Z`,
    ],
  ]);
});
