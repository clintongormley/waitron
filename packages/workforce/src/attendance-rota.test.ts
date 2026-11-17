import { seedAttendanceDay } from "../test/fixtures.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { attendanceMailRows, setAttendanceMail } from "../test/fixtures.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  withTransaction,
  type Transaction,
  withFoldedPersonChanges,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTaxpayer } from "@waitron/db/testing/seed.js";
import { persons } from "@waitron/identity";
import { jobOrigin } from "@waitron/shared";
import { seedFixtureVenue } from "../test/fixtures.js";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceQuestions,
  listPendingAttendanceQuestions,
  upsertAttendanceQuestion,
  mergeAttendanceQuestions,
  rosterVersions,
  shifts,
  timeEntries,
} from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
const now = new Date("2026-01-06T04:01:00.000Z");
let personId: string, other: string, nodeId: string, versionId: string, shiftId: string;
let attendanceDayId: string, previousDayId: string;
const day = () => ({
  businessDay: "2026-01-05",
  startAt: "2026-01-05T04:00:00.000Z",
  endAt: "2026-01-06T04:00:00.000Z",
});
const input = () => ({
  personId,
  day: day(),
  shiftKey: `rota:${shiftId}`,
  kind: "missing-times" as const,
  missingKinds: ["in", "out"] as ("in" | "out")[],
  openEntryId: null,
  automaticEntryId: null,
  evidenceKeys: ["order:original"],
});
async function retire(tx: Transaction) {
  const { retireObsoleteRotaQuestions } = await import("./attendance-rota.js");
  await retireObsoleteRotaQuestions(tx, day());
}
const own = () => run((tx) => listPendingAttendanceQuestions(tx, personId));
beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedFixtureVenue(suite.db);
  nodeId = await seedNode(suite.db);
  const workers = await seedPersons(suite.db, [
    { displayName: "Ana", pinHash: "scrypt$00$00", role: "staff" },
    { displayName: "Bea", pinHash: "scrypt$00$00", role: "staff" },
  ]);
  [personId, other] = workers.map((worker) => worker.id) as [string, string];
  versionId = await run((tx) => backend.createRosterVersion(tx, { period: "2026-01-05" }));
  shiftId = await run((tx) =>
    backend.addShift(tx, {
      personId,
      versionId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
      startsOffsetMinutes: 0,
      endsOffsetMinutes: 0,
    }),
  );
  await run((tx) => backend.publishRoster(tx, { versionId }));
});

describe("obsolete rota attendance obligations", () => {
  it("a different current shift cannot satisfy the deleted shift's obligation", async () => {
    await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
    const replacement = await run((tx) =>
      backend.createRosterVersion(tx, { period: "2026-01-05" }),
    );
    await run((tx) =>
      backend.addShift(tx, {
        versionId: replacement,
        personId,
        startsAt: "2026-01-05T09:00:00Z",
        endsAt: "2026-01-05T17:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      }),
    );
    await run((tx) => backend.publishRoster(tx, { versionId: replacement }));
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    await run(retire);
    expect(await own()).toEqual([]);
    expect((await attendanceMailRows(suite.db))[0]!.status).toBe("cancelled");
  });
  it("replacement publication removes the former question without deleting evidence, even if email is added later", async () => {
    const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
    const before = (await suite.db.select().from(attendanceQuestions))[0]!;
    const replacement = await run((tx) =>
      backend.createRosterVersion(tx, { period: "2026-01-05" }),
    );
    await run((tx) =>
      backend.addShift(tx, {
        versionId: replacement,
        personId,
        startsAt: "2026-01-05T09:00:00Z",
        endsAt: "2026-01-05T17:00:00Z",
        startsOffsetMinutes: 0,
        endsOffsetMinutes: 0,
      }),
    );
    await run((tx) => backend.publishRoster(tx, { versionId: replacement }));
    await run(retire);
    expect(await own()).toEqual([]);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([
      { ...before, active: false, inactiveReason: "rota_superseded" },
    ]);
    expect((await attendanceMailRows(suite.db))[0]).toMatchObject({
      questionId: id,
      status: "cancelled",
    });
    await suite.db
      .update(persons)
      .set(withFoldedPersonChanges({ email: "ana@example.test" }))
      .where(eq(persons.id, personId));
    await run(retire);
    expect(await own()).toEqual([]);
    expect((await attendanceMailRows(suite.db))[0]!.status).toBe("cancelled");
  });
  it.each(["pending", "rejected", "sending", "sent", "unknown"] as const)(
    "reassignment retires the former worker while retaining %s delivery facts",
    async (status) => {
      const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
      await setAttendanceMail(suite.db, id, {
        status,
        claimToken: "old-claim",
        claimedAt: now.toISOString(),
        recipient: "ana@example.test",
        outcome: status === "pending" || status === "sending" ? null : status,
      });
      const before = (await attendanceMailRows(suite.db))[0]!;
      await suite.db.update(shifts).set({ personId: other }).where(eq(shifts.id, shiftId));
      const current = await run((tx) =>
        upsertAttendanceQuestion(tx, { ...input(), personId: other }, now, attendanceDayId),
      );
      await run(retire);
      expect(await own()).toEqual([]);
      expect(
        (await run((tx) => listPendingAttendanceQuestions(tx, other))).map((q) => q.id),
      ).toEqual([current]);
      expect((await attendanceMailRows(suite.db)).find((mail) => mail.questionId === id)).toEqual({
        ...before,
        status: status === "pending" || status === "rejected" ? "cancelled" : status,
      });
    },
  );
  it.each(["deleted", "draft", "before-day", "at-end"])(
    "retires a question when its shift becomes %s",
    async (change) => {
      await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
      if (change === "deleted") await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
      else if (change === "draft")
        await suite.db
          .update(rosterVersions)
          .set({ status: "draft", publishedAt: null })
          .where(eq(rosterVersions.id, versionId));
      else
        await suite.db
          .update(shifts)
          .set({
            startsAt:
              change === "before-day" ? "2026-01-05T03:59:59.000Z" : "2026-01-06T04:00:00.000Z",
            endsAt: "2026-01-06T10:00:00.000Z",
          })
          .where(eq(shifts.id, shiftId));
      await run(retire);
      expect(await own()).toEqual([]);
      expect((await attendanceMailRows(suite.db))[0]!.status).toBe("cancelled");
    },
  );
  it("retains a current shift at the inclusive day start without consuming its reminder", async () => {
    await suite.db.update(shifts).set({ startsAt: day().startAt }).where(eq(shifts.id, shiftId));
    const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
    const before = await attendanceMailRows(suite.db);
    await run(retire);
    expect((await own()).map((q) => q.id)).toEqual([id]);
    expect(await attendanceMailRows(suite.db)).toEqual(before);
  });
  it("leaves other days, actual clock starts and unscheduled activity alone", async () => {
    await run((tx) =>
      backend.clockIn(tx, {
        personId,
        nodeId,
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 0,
        origin: jobOrigin("dashboard"),
      }),
    );
    const open = (await suite.db.select({ id: timeEntries.id }).from(timeEntries))[0]!.id;
    await run(async (tx) => {
      await upsertAttendanceQuestion(
        tx,
        {
          ...input(),
          shiftKey: "rota:another-day",
          day: {
            ...day(),
            businessDay: "2026-01-04",
            startAt: "2026-01-04T04:00:00.000Z",
            endAt: day().startAt,
          },
        },
        now,
        previousDayId,
      );
      await upsertAttendanceQuestion(
        tx,
        { ...input(), shiftKey: "activity:2026-01-05:order:original" },
        now,
        attendanceDayId,
      );
      await upsertAttendanceQuestion(
        tx,
        { ...input(), shiftKey: `in:${open}`, openEntryId: open, missingKinds: ["out"] },
        now,
        attendanceDayId,
      );
    });
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await attendanceMailRows(suite.db);
    await run(retire);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await attendanceMailRows(suite.db)).toEqual(mail);
  });
  it("rolls back retirement and mail cancellation with its caller", async () => {
    await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const questions = await suite.db.select().from(attendanceQuestions);
    const mail = await attendanceMailRows(suite.db);
    await expect(
      run(async (tx) => {
        await retire(tx);
        throw new Error("after retirement");
      }),
    ).rejects.toThrow("after retirement");
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(questions);
    expect(await attendanceMailRows(suite.db)).toEqual(mail);
  });
  it("keeps a missing finish backed by an actual clock start after its rota disappears", async () => {
    await run((tx) =>
      backend.clockIn(tx, {
        nodeId,
        personId,
        at: "2026-01-05T09:00:00Z",
        offsetMinutes: 0,
        origin: jobOrigin("dashboard"),
      }),
    );
    const open = (await suite.db.select({ id: timeEntries.id }).from(timeEntries))[0]!.id;
    const id = await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        {
          ...input(),
          openEntryId: open,
          missingKinds: ["out"],
        },
        now,
        attendanceDayId,
      ),
    );
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await attendanceMailRows(suite.db);
    await run(retire);
    expect((await own()).map((q) => q.id)).toEqual([id]);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await attendanceMailRows(suite.db)).toEqual(mail);
  });
  it("does not overwrite a merged alias's reason or canonical reminder", async () => {
    const oldRota = await run((tx) => upsertAttendanceQuestion(tx, input(), now, attendanceDayId));
    const activity = await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        {
          ...input(),
          shiftKey: "activity:2026-01-05:order:original",
        },
        now,
        attendanceDayId,
      ),
    );
    await run((tx) => mergeAttendanceQuestions(tx, activity, oldRota));
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await attendanceMailRows(suite.db);
    await run(retire);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await attendanceMailRows(suite.db)).toEqual(mail);
    expect((await own()).map((q) => q.id)).toEqual([activity]);
  });
});

beforeEach(async () => {
  attendanceDayId = await seedAttendanceDay(suite.db, day());
  previousDayId = await seedAttendanceDay(suite.db, {
    businessDay: "2026-01-04",
    startAt: "2026-01-04T04:00:00.000Z",
    endAt: "2026-01-05T04:00:00.000Z",
  });
});
