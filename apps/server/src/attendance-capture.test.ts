import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, type Transaction, withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  attendanceDayWork,
  attendanceOperationFacts,
  WORKFORCE_MIGRATIONS,
} from "@waitron/workforce";
import type { AttendanceFact } from "@waitron/workforce";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(f: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, f);
let personId: string, other: string, locationId: string, elsewhere: string;
const fact = () => ({
  source: "whole-payment" as const,
  key: "attempt:one",
  personId,
  locationId,
  kind: "payment" as const,
  at: "2026-01-05T16:40:23.987Z",
  offsetMinutes: 0,
  outcome: "qualified" as const,
});
async function capture(input: AttendanceFact & { outcome: "pending" | "qualified" | "refused" }) {
  const { recordAttendanceFact } = await import("./attendance-capture.js");
  return run((tx) => recordAttendanceFact(tx, input));
}
beforeEach(async () => {
  await seedTenant(suite.db);
  const places = await suite.db
    .insert(locations)
    .values([
      {
        name: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "04:00",
        invoiceLocales: ["es"],
        operationDescription: "Restaurant",
      },
      {
        name: "Other",
        timeZone: "UTC",
        dayCutover: "04:00",
        invoiceLocales: ["en"],
        operationDescription: "Restaurant",
      },
    ])
    .returning({ id: locations.id });
  [locationId, elsewhere] = places.map((r) => r.id) as [string, string];
  const people = await suite.db
    .insert(persons)
    .values([
      { displayName: "Collector", pinHash: "scrypt$00$00" },
      { displayName: "Later operator", pinHash: "scrypt$00$00" },
    ])
    .returning({ id: persons.id });
  [personId, other] = people.map((r) => r.id) as [string, string];
});

describe("transactional attendance operation capture", () => {
  it("records the admitted human instant at whole seconds, using the venue-zone offset", async () => {
    await capture(fact());
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([
      {
        sequence: 1,
        source: "whole-payment",
        key: "attempt:one",
        personId,
        locationId,
        kind: "payment",
        at: "2026-01-05T16:40:23.000Z",
        offsetMinutes: 60,
        businessDay: "2026-01-05",
        outcome: "qualifying",
      },
    ]);
    expect(await suite.db.select().from(attendanceDayWork)).toMatchObject([
      {
        locationId,
        businessDay: "2026-01-05",
        startAt: "2026-01-05T03:00:00.000Z",
        endAt: "2026-01-06T03:00:00.000Z",
        dirtyRevision: 1,
      },
    ]);
  });
  it("replay cannot replace the original actor, location or human request instant", async () => {
    await capture({ ...fact(), outcome: "pending" });
    const original = (await suite.db.select().from(attendanceOperationFacts))[0]!;
    await capture({
      ...fact(),
      personId: other,
      locationId: elsewhere,
      at: "2026-01-06T19:00:00Z",
      outcome: "qualified",
    });
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([
      { ...original, outcome: "qualifying" },
    ]);
    expect(await suite.db.select().from(attendanceDayWork)).toMatchObject([
      { locationId, businessDay: "2026-01-05", dirtyRevision: 2 },
    ]);
  });
  it("unchanged replay leaves the saved day revision alone", async () => {
    await capture(fact());
    const before = await suite.db.select().from(attendanceDayWork);
    await capture(fact());
    expect(await suite.db.select().from(attendanceDayWork)).toEqual(before);
    expect(await suite.db.select().from(attendanceOperationFacts)).toHaveLength(1);
  });
  it("later refusal or refund retains an already qualifying original action", async () => {
    await capture(fact());
    const before = await suite.db.select().from(attendanceOperationFacts);
    const work = await suite.db.select().from(attendanceDayWork);
    await capture({ ...fact(), outcome: "refused", at: "2026-01-08T20:00:00Z" });
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual(before);
    expect(await suite.db.select().from(attendanceDayWork)).toEqual(work);
  });
  it("a pending-start replay does not revive a definitive refusal", async () => {
    await capture({ ...fact(), outcome: "pending" });
    await capture({ ...fact(), outcome: "refused" });
    const before = await suite.db.select().from(attendanceOperationFacts);
    await capture({ ...fact(), outcome: "pending" });
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual(before);
  });
  it("an accepted later outcome qualifies the original refused request without changing its time", async () => {
    await capture({ ...fact(), outcome: "refused" });
    await capture({ ...fact(), at: "2026-01-08T20:00:00Z", outcome: "qualified" });
    expect(await suite.db.select().from(attendanceOperationFacts)).toMatchObject([
      { at: "2026-01-05T16:40:23.000Z", outcome: "qualifying" },
    ]);
  });
  it("two different attempts keep separate human evidence", async () => {
    await capture(fact());
    await capture({ ...fact(), key: "attempt:two", personId: other, at: "2026-01-05T17:00:00Z" });
    expect(
      (await suite.db.select().from(attendanceOperationFacts)).map((r) => ({
        key: r.key,
        personId: r.personId,
        at: r.at,
      })),
    ).toEqual([
      { key: "attempt:one", personId, at: "2026-01-05T16:40:23.000Z" },
      { key: "attempt:two", personId: other, at: "2026-01-05T17:00:00.000Z" },
    ]);
  });
  it.each([
    ["2026-03-29T01:30:00.500Z", "2026-03-28", 120],
    ["2026-10-25T01:30:00.500Z", "2026-10-24", 60],
    ["2026-01-05T03:00:00.000Z", "2026-01-05", 60],
    ["2026-01-05T02:59:59.999Z", "2026-01-04", 60],
  ])(
    "saves the historical business day for %s rather than the callback's day",
    async (at, businessDay, offsetMinutes) => {
      await capture({ ...fact(), at });
      expect(await suite.db.select().from(attendanceOperationFacts)).toMatchObject([
        { businessDay, offsetMinutes },
      ]);
    },
  );
  it.each([{ at: "bad" }, { key: "" }, { personId: "" }, { kind: "sign-in" }])(
    "refuses invalid evidence %j without saving work",
    async (bad) => {
      await expect(
        capture({ ...fact(), ...bad } as Parameters<typeof capture>[0]),
      ).rejects.toMatchObject({ code: "attendance.invalid" });
      expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([]);
      expect(await suite.db.select().from(attendanceDayWork)).toEqual([]);
    },
  );
  it("a capture failure rolls back the surrounding accepted command", async () => {
    const { recordAttendanceFact } = await import("./attendance-capture.js");
    await expect(
      run(async (tx) => {
        await tx.update(persons).set({ displayName: "Changed" }).where(eq(persons.id, personId));
        await recordAttendanceFact(tx, { ...fact(), key: "" });
      }),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(
      (await suite.db.select().from(persons).where(eq(persons.id, personId)))[0]!.displayName,
    ).toBe("Collector");
    expect(await suite.db.select().from(attendanceOperationFacts)).toEqual([]);
  });
});
