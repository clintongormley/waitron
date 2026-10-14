import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { seedLocation } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  attendanceDayWork,
  attendanceOperationFacts,
  attendanceSourceState,
  enqueueAttendanceDay,
} from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let locationId: string;
const day = () => ({
  locationId,
  businessDay: "2026-01-05",
  startAt: "2026-01-05T04:00:00.000Z",
  endAt: "2026-01-06T04:00:00.000Z",
});
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
});

describe("durable attendance day work", () => {
  it("re-enqueue preserves identity, bounds and deferred work while dirtying the revision", async () => {
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    const [first] = await suite.db.select().from(attendanceDayWork);
    expect(first).toMatchObject({
      ...day(),
      dirtyRevision: 1,
      evaluatedRevision: 0,
      nextDueAt: "2026-01-06T04:00:00.000Z",
      deferredShiftIds: [],
    });
    await suite.db
      .update(attendanceDayWork)
      .set({
        evaluatedRevision: 1,
        deferredShiftIds: ["overnight"],
        nextDueAt: "2026-01-06T06:00:00.000Z",
      })
      .where(eq(attendanceDayWork.id, first!.id));
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([
      {
        ...first,
        dirtyRevision: 2,
        evaluatedRevision: 1,
        deferredShiftIds: ["overnight"],
        nextDueAt: "2026-01-06T06:00:00.000Z",
      },
    ]);
  });
  it("keeps the same business date at two locations separate", async () => {
    const other = await seedLocation(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await enqueueAttendanceDay(tx, day());
      await enqueueAttendanceDay(tx, { ...day(), locationId: other });
    });
    expect(
      (await suite.db.select().from(attendanceDayWork)).map((r) => r.locationId).sort(),
    ).toEqual([locationId, other].sort());
  });
  it("refuses changed saved historical bounds without altering the work", async () => {
    await withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, day()));
    const before = await suite.db.select().from(attendanceDayWork);
    await expect(
      withTransaction(suite.db, (tx) =>
        enqueueAttendanceDay(tx, { ...day(), endAt: "2026-01-06T06:00:00.000Z" }),
      ),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceDayWork)).toEqual(before);
  });
  it.each([
    { businessDay: "2026-02-31" },
    { businessDay: "" },
    { startAt: "bad" },
    { endAt: "2026-01-05T04:00:00.000Z" },
    { locationId: "" },
  ])("refuses malformed day %j before writing", async (bad) => {
    await expect(
      withTransaction(suite.db, (tx) => enqueueAttendanceDay(tx, { ...day(), ...bad })),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });
  it("rolls back an enqueued day with the caller's logical write", async () => {
    await expect(
      withTransaction(suite.db, async (tx) => {
        await enqueueAttendanceDay(tx, day());
        throw new Error("after enqueue");
      }),
    ).rejects.toThrow("after enqueue");
    expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
  });
  it("never reuses a captured operation sequence after its highest row is removed", async () => {
    const [person] = await suite.db
      .insert(persons)
      .values({ displayName: "Worker", pinHash: "scrypt$00$00" })
      .returning({ id: persons.id });
    const fact = {
      source: "order" as const,
      key: "one",
      personId: person!.id,
      locationId,
      kind: "order" as const,
      at: "2026-01-05T09:00:00.000Z",
      offsetMinutes: 0,
      businessDay: "2026-01-05",
      outcome: "qualifying" as const,
    };
    const [first] = await suite.db.insert(attendanceOperationFacts).values(fact).returning();
    const [second] = await suite.db
      .insert(attendanceOperationFacts)
      .values({ ...fact, key: "two" })
      .returning();
    expect([first!.sequence, second!.sequence]).toEqual([1, 2]);
    await suite.db
      .delete(attendanceOperationFacts)
      .where(eq(attendanceOperationFacts.sequence, second!.sequence));
    const [third] = await suite.db
      .insert(attendanceOperationFacts)
      .values({ ...fact, key: "three" })
      .returning();
    expect(third!.sequence).toBe(3);
  });
  it("keeps a source scan and row watch in separate namespaces even with identical keys", async () => {
    await suite.db.insert(attendanceSourceState).values([
      {
        locationId,
        source: "clock",
        key: "chain",
        recordKind: "scan",
        generation: "boot",
        cursor: 0,
        endpoint: 2,
        completed: false,
      },
      {
        locationId,
        source: "clock",
        key: "chain",
        recordKind: "watch",
        fingerprint: "before",
        previousDays: ["2026-01-05"],
        nextDueAt: "2026-01-06T04:00:00.000Z",
      },
    ]);
    expect(
      (await suite.db.select().from(attendanceSourceState)).map((r) => ({
        kind: r.recordKind,
        cursor: r.cursor,
        endpoint: r.endpoint,
        completed: r.completed,
      })),
    ).toEqual([
      { kind: "scan", cursor: 0, endpoint: 2, completed: false },
      { kind: "watch", cursor: null, endpoint: null, completed: null },
    ]);
  });
});
