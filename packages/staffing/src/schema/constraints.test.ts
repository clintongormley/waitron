import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  seasons,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { STAFFING_MIGRATIONS } from "../migrations.js";
import { shiftAssignments, staffRoles, staffingBlocks, staffingDays } from "./staffing.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});

async function venue() {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Restaurant" })
      .returning({ id: locations.id });
    const locationId = location!.id;
    const [department] = await tx
      .insert(departments)
      .values({ locationId, name: "Dining room", tradingName: "Dining room" })
      .returning({ id: departments.id });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ locationId, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [season] = await tx
      .insert(seasons)
      .values({ locationId, name: "Summer", startsOn: "06-01" })
      .returning({ id: seasons.id });
    const [special] = await tx
      .insert(specialDays)
      .values({ locationId, name: "Christmas" })
      .returning({ id: specialDays.id });
    const [date] = await tx
      .insert(specialDayDates)
      .values({ specialDayId: special!.id, locationId, date: "2026-12-25" })
      .returning({ id: specialDayDates.id });
    const [role] = await tx
      .insert(staffRoles)
      .values({ locationId, name: "Waiter" })
      .returning({ id: staffRoles.id });
    return {
      locationId,
      departmentId: department!.id,
      stationId: station!.id,
      seasonId: season!.id,
      specialDayId: special!.id,
      dateId: date!.id,
      roleId: role!.id,
    };
  });
}

function insertDay(row: typeof staffingDays.$inferInsert) {
  return withTransaction(suite.db, (tx) =>
    tx.insert(staffingDays).values(row).returning({ id: staffingDays.id }),
  );
}

async function count(table: typeof staffingDays | typeof staffingBlocks) {
  return (await suite.db.select().from(table)).length;
}

it("refuses a staffing day for both a department and a station", async () => {
  const v = await venue();
  await expect(
    insertDay({
      departmentId: v.departmentId,
      stationId: v.stationId,
      seasonId: v.seasonId,
      weekday: 1,
    }),
  ).rejects.toThrow("CHECK constraint failed: staffing_days_one_area_ck");
});

it("refuses a staffing day for neither a department nor a station", async () => {
  const v = await venue();
  await expect(insertDay({ seasonId: v.seasonId, weekday: 1 })).rejects.toThrow(
    "CHECK constraint failed: staffing_days_one_area_ck",
  );
});

it("refuses a staffing day on both a season's weekday and a special day's date", async () => {
  const v = await venue();
  await expect(
    insertDay({
      departmentId: v.departmentId,
      seasonId: v.seasonId,
      weekday: 1,
      specialDayDateId: v.dateId,
    }),
  ).rejects.toThrow("CHECK constraint failed: staffing_days_one_day_ck");
});

it("refuses a second day for one department, season and weekday, and keeps a station's apart", async () => {
  const v = await venue();
  await insertDay({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 3 });
  await insertDay({ stationId: v.stationId, seasonId: v.seasonId, weekday: 3 });
  await expect(
    insertDay({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 3 }),
  ).rejects.toThrow(
    "UNIQUE constraint failed: staffing_days.department_id, staffing_days.season_id, staffing_days.weekday",
  );
  expect(await count(staffingDays)).toBe(2);
});

it("refuses a block with a headcount of 0 and one starting off the quarter hour", async () => {
  const v = await venue();
  const [day] = await insertDay({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 2 });
  const block = {
    dayId: day!.id,
    staffRoleId: v.roleId,
    headcount: 2,
    startsAt: "08:00",
    endsAt: "16:00",
  };
  const insertBlock = (row: typeof block) =>
    withTransaction(suite.db, (tx) => tx.insert(staffingBlocks).values(row));
  await expect(insertBlock({ ...block, headcount: 0 })).rejects.toThrow(
    "CHECK constraint failed: staffing_blocks_headcount_ck",
  );
  await expect(insertBlock({ ...block, startsAt: "08:10" })).rejects.toThrow(
    "CHECK constraint failed: staffing_blocks_step_ck",
  );
  await insertBlock(block);
  expect(await count(staffingBlocks)).toBe(1);
});

it("deleting a season deletes its staffing days and their blocks", async () => {
  const v = await venue();
  const [day] = await insertDay({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 4 });
  await insertDay({ departmentId: v.departmentId, specialDayDateId: v.dateId });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(staffingBlocks).values({
      dayId: day!.id,
      staffRoleId: v.roleId,
      headcount: 1,
      startsAt: "12:00",
      endsAt: "16:00",
    });
    await tx.delete(seasons).where(eq(seasons.id, v.seasonId));
  });
  expect(await suite.db.select({ date: staffingDays.specialDayDateId }).from(staffingDays)).toEqual(
    [{ date: v.dateId }],
  );
  expect(await count(staffingBlocks)).toBe(0);
});

it("deleting a special day's date deletes its staffing days and their blocks", async () => {
  const v = await venue();
  const [day] = await insertDay({ departmentId: v.departmentId, specialDayDateId: v.dateId });
  await insertDay({ departmentId: v.departmentId, seasonId: v.seasonId, weekday: 5 });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(staffingBlocks).values({
      dayId: day!.id,
      staffRoleId: v.roleId,
      headcount: 1,
      startsAt: "12:00",
      endsAt: "16:00",
    });
    await tx.delete(specialDayDates).where(eq(specialDayDates.id, v.dateId));
  });
  expect(await suite.db.select({ season: staffingDays.seasonId }).from(staffingDays)).toEqual([
    { season: v.seasonId },
  ]);
  expect(await count(staffingBlocks)).toBe(0);
});

async function assignedShift(v: Awaited<ReturnType<typeof venue>>) {
  return withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ada", role: "staff" })
      .returning({ id: persons.id });
    const [shift] = await tx
      .insert(shifts)
      .values({
        personId: person!.id,
        locationId: v.locationId,
        startsAt: "2026-10-14T08:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-10-14T16:00:00Z",
        endsOffsetMinutes: 120,
      })
      .returning({ id: shifts.id });
    await tx
      .insert(shiftAssignments)
      .values({ shiftId: shift!.id, departmentId: v.departmentId, staffRoleId: v.roleId });
    return shift!.id;
  });
}

it("deleting a shift deletes its assignment", async () => {
  const v = await venue();
  const shiftId = await assignedShift(v);
  await withTransaction(suite.db, (tx) => tx.delete(shifts).where(eq(shifts.id, shiftId)));
  expect(await suite.db.select().from(shiftAssignments)).toEqual([]);
});

it("refuses to delete a staff role a shift assignment names", async () => {
  const v = await venue();
  await assignedShift(v);
  await expect(
    withTransaction(suite.db, (tx) => tx.delete(staffRoles).where(eq(staffRoles.id, v.roleId))),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  expect(await suite.db.select({ id: staffRoles.id }).from(staffRoles)).toEqual([{ id: v.roleId }]);
});
