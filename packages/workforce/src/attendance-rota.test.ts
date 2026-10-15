import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceQuestions,
  attendanceMail,
  listPendingAttendanceQuestions,
  upsertAttendanceQuestion,
  mergeAttendanceQuestions,
  rosterVersions,
  shifts,
  timeEntries,
} from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
const now = new Date("2026-01-06T04:01:00.000Z");
let locationId: string,
  personId: string,
  other: string,
  nodeId: string,
  versionId: string,
  shiftId: string;
const day = () => ({
  locationId,
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
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const workers = await suite.db
    .insert(persons)
    .values([
      { displayName: "Ana", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Bea", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [personId, other] = workers.map((worker) => worker.id) as [string, string];
  versionId = await run((tx) =>
    backend.createRosterVersion(tx, { locationId, period: "2026-01-05" }),
  );
  shiftId = await run((tx) =>
    backend.addShift(tx, {
      personId,
      locationId,
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
    await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    const replacement = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-01-05" }),
    );
    await run((tx) =>
      backend.addShift(tx, {
        versionId: replacement,
        locationId,
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
    expect((await suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
  });
  it("replacement publication removes the former question without deleting evidence, even if email is added later", async () => {
    const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    const before = (await suite.db.select().from(attendanceQuestions))[0]!;
    const replacement = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-01-05" }),
    );
    await run((tx) =>
      backend.addShift(tx, {
        versionId: replacement,
        personId,
        locationId,
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
    expect((await suite.db.select().from(attendanceMail))[0]).toMatchObject({
      questionId: id,
      status: "cancelled",
    });
    await suite.db
      .update(persons)
      .set({ email: "ana@example.test" })
      .where(eq(persons.id, personId));
    await run(retire);
    expect(await own()).toEqual([]);
    expect((await suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
  });
  it.each(["pending", "rejected", "sending", "sent", "unknown"] as const)(
    "reassignment retires the former worker while retaining %s delivery facts",
    async (status) => {
      const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now));
      await suite.db
        .update(attendanceMail)
        .set({
          status,
          claimToken: "old-claim",
          claimedAt: now.toISOString(),
          recipient: "ana@example.test",
          outcome: status === "pending" || status === "sending" ? null : status,
        })
        .where(eq(attendanceMail.questionId, id));
      const before = (await suite.db.select().from(attendanceMail))[0]!;
      await suite.db.update(shifts).set({ personId: other }).where(eq(shifts.id, shiftId));
      const current = await run((tx) =>
        upsertAttendanceQuestion(tx, { ...input(), personId: other }, now),
      );
      await run(retire);
      expect(await own()).toEqual([]);
      expect(
        (await run((tx) => listPendingAttendanceQuestions(tx, other))).map((q) => q.id),
      ).toEqual([current]);
      expect(
        (await suite.db.select().from(attendanceMail)).find((mail) => mail.questionId === id),
      ).toEqual({
        ...before,
        status: status === "pending" || status === "rejected" ? "cancelled" : status,
      });
    },
  );
  it.each([
    "deleted",
    "detached",
    "draft",
    "other-location",
    "other-version-location",
    "before-day",
    "at-end",
  ])("retires a question when its shift becomes %s", async (change) => {
    await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    if (change === "deleted") await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    else if (change === "detached")
      await suite.db.update(shifts).set({ rosterVersionId: null }).where(eq(shifts.id, shiftId));
    else if (change === "draft")
      await suite.db
        .update(rosterVersions)
        .set({ status: "draft", publishedAt: null })
        .where(eq(rosterVersions.id, versionId));
    else if (change === "other-location")
      await suite.db
        .update(shifts)
        .set({ locationId: await seedLocation(suite.db) })
        .where(eq(shifts.id, shiftId));
    else if (change === "other-version-location") {
      const elsewhere = await seedLocation(suite.db);
      const otherVersion = await run((tx) =>
        backend.createRosterVersion(tx, { locationId: elsewhere, period: "2026-01-05" }),
      );
      await run((tx) => backend.publishRoster(tx, { versionId: otherVersion }));
      await suite.db
        .update(shifts)
        .set({ rosterVersionId: otherVersion })
        .where(eq(shifts.id, shiftId));
    } else
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
    expect((await suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
  });
  it("retains a current shift at the inclusive day start without consuming its reminder", async () => {
    await suite.db.update(shifts).set({ startsAt: day().startAt }).where(eq(shifts.id, shiftId));
    const id = await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    const before = await suite.db.select().from(attendanceMail);
    await run(retire);
    expect((await own()).map((q) => q.id)).toEqual([id]);
    expect(await suite.db.select().from(attendanceMail)).toEqual(before);
  });
  it("leaves other days, locations, actual clock starts and unscheduled activity alone", async () => {
    const elsewhere = await seedLocation(suite.db);
    await run((tx) =>
      backend.clockIn(tx, {
        personId,
        locationId,
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
      );
      await upsertAttendanceQuestion(
        tx,
        { ...input(), day: { ...day(), locationId: elsewhere } },
        now,
      );
      await upsertAttendanceQuestion(
        tx,
        { ...input(), shiftKey: "activity:2026-01-05:order:original" },
        now,
      );
      await upsertAttendanceQuestion(
        tx,
        { ...input(), shiftKey: `in:${open}`, openEntryId: open, missingKinds: ["out"] },
        now,
      );
    });
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await suite.db.select().from(attendanceMail);
    await run(retire);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await suite.db.select().from(attendanceMail)).toEqual(mail);
  });
  it("rolls back retirement and mail cancellation with its caller", async () => {
    await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const questions = await suite.db.select().from(attendanceQuestions);
    const mail = await suite.db.select().from(attendanceMail);
    await expect(
      run(async (tx) => {
        await retire(tx);
        throw new Error("after retirement");
      }),
    ).rejects.toThrow("after retirement");
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(questions);
    expect(await suite.db.select().from(attendanceMail)).toEqual(mail);
  });
  it("keeps a missing finish backed by an actual clock start after its rota disappears", async () => {
    await run((tx) =>
      backend.clockIn(tx, {
        nodeId,
        locationId,
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
      ),
    );
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await suite.db.select().from(attendanceMail);
    await run(retire);
    expect((await own()).map((q) => q.id)).toEqual([id]);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await suite.db.select().from(attendanceMail)).toEqual(mail);
  });
  it("does not overwrite a merged alias's reason or canonical reminder", async () => {
    const oldRota = await run((tx) => upsertAttendanceQuestion(tx, input(), now));
    const activity = await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        {
          ...input(),
          shiftKey: "activity:2026-01-05:order:original",
        },
        now,
      ),
    );
    await run((tx) => mergeAttendanceQuestions(tx, activity, oldRota));
    await suite.db.delete(shifts).where(eq(shifts.id, shiftId));
    const before = await suite.db.select().from(attendanceQuestions);
    const mail = await suite.db.select().from(attendanceMail);
    await run(retire);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await suite.db.select().from(attendanceMail)).toEqual(mail);
    expect((await own()).map((q) => q.id)).toEqual([activity]);
  });
});
