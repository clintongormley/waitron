import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";

import { seedFixtureVenue } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { attendanceDays, enqueueAttendanceDay } from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const day = () => ({
  businessDay: "2026-01-05",
  startAt: "2026-01-05T04:00:00.000Z",
  endAt: "2026-01-06T04:00:00.000Z",
});
beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedFixtureVenue(suite.db);
});

describe("durable attendance day work", () => {
  it("re-enqueue preserves identity, bounds and deferred work while dirtying the revision", async () => {
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    const [first] = await suite.db.select().from(attendanceDays);
    expect(first).toMatchObject({
      ...day(),
      dirtyRevision: 1,
      evaluatedRevision: 0,
      nextDueAt: "2026-01-06T04:00:00.000Z",
      deferredShiftIds: [],
    });
    await suite.db
      .update(attendanceDays)
      .set({
        evaluatedRevision: 1,
        deferredShiftIds: ["overnight"],
        nextDueAt: "2026-01-06T06:00:00.000Z",
      })
      .where(eq(attendanceDays.id, first!.id));
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    expect(await suite.db.select().from(attendanceDays)).toEqual([
      {
        ...first,
        dirtyRevision: 2,
        evaluatedRevision: 1,
        deferredShiftIds: ["overnight"],
        nextDueAt: "2026-01-06T06:00:00.000Z",
      },
    ]);
  });
  it("saves the venue's day", async () => {
    await withTransaction(suite.db, (tx) =>
      enqueueAttendanceDay(tx, {
        businessDay: "2026-01-05",
        startAt: "2026-01-05T04:00:00.000Z",
        endAt: "2026-01-06T04:00:00.000Z",
      }),
    );
    expect(await suite.db.select().from(attendanceDays)).toMatchObject([
      { businessDay: "2026-01-05" },
    ]);
  });
  it("refuses changed saved historical bounds without altering the work", async () => {
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    const before = await suite.db.select().from(attendanceDays);
    await expect(
      withTransaction(suite.db, (tx) =>
        enqueueAttendanceDay(tx, { ...day(), endAt: "2026-01-06T06:00:00.000Z" }),
      ),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceDays)).toEqual(before);
  });
  it.each([
    { businessDay: "2026-02-31" },
    { businessDay: "" },
    { startAt: "bad" },
    { endAt: "2026-01-05T04:00:00.000Z" },
  ])("refuses malformed day %j before writing", async (bad) => {
    await expect(
      withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, { ...day(), ...bad })),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceDays)).toEqual([]);
  });
  it("rolls back an enqueued day with the caller's logical write", async () => {
    await expect(
      withTransaction(suite.db, async (tx) => {
        await enqueueAttendanceDay(tx, day());
        throw new Error("after enqueue");
      }),
    ).rejects.toThrow("after enqueue");
    expect(await suite.db.select().from(attendanceDays)).toEqual([]);
  });
});
