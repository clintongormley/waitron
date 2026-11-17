import { seedRosterWeek } from "@waitron/workforce/test/fixtures.js";
import { staffRoles } from "@waitron/db";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, kitchenStations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";

import { departments, seasons, specialDayDates, specialDays } from "@waitron/venue-service";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { WORKFORCE_MIGRATIONS, shifts, staffingBlocks, staffingDays } from "@waitron/workforce";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

async function venue() {
  return withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, {
      name: "Main",
      invoiceLocales: ["en"],
    });
    const [department] = await tx
      .insert(departments)
      .values({ name: "Dining room", tradingName: "Dining room" })
      .returning({ id: departments.id });
    const [station] = await tx
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [season] = await tx
      .insert(seasons)
      .values({ name: "Summer", startsOn: "06-01" })
      .returning({ id: seasons.id });
    const [special] = await tx
      .insert(specialDays)
      .values({ name: "Christmas" })
      .returning({ id: specialDays.id });
    const [date] = await tx
      .insert(specialDayDates)
      .values({ specialDayId: special!.id, date: "2026-12-25" })
      .returning({ id: specialDayDates.id });
    const [role] = await tx
      .insert(staffRoles)
      .values({ name: "Waiter" })
      .returning({ id: staffRoles.id });
    return {
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

it("lets the colour CHECK take every calendar colour and refuses an unknown one", async () => {
  await venue();
  const insert = (colour: string) =>
    withTransaction(suite.db, (tx) =>
      tx.insert(staffRoles).values({ name: `Role ${colour}`, colour: colour as never }),
    );
  for (const colour of CALENDAR_COLOURS) await insert(colour);
  await expect(insert("beige")).rejects.toThrow("CHECK constraint failed: staff_roles_colour_ck");
});

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
    const [person] = await seedPersons(tx, { displayName: "Ada", role: "staff", jobRoles: [] });
    const [shift] = await tx
      .insert(shifts)
      .values({
        rosterVersionId: await seedRosterWeek(tx, "2026-10-14"),
        personId: person!.id,
        startsAt: "2026-10-14T08:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-10-14T16:00:00Z",
        endsOffsetMinutes: 120,
      })
      .returning({ id: shifts.id });
    await tx
      .update(shifts)
      .set({ departmentId: v.departmentId, staffRoleId: v.roleId })
      .where(eq(shifts.id, shift!.id));
    return shift!.id;
  });
}

it("deleting a shift deletes its assignment", async () => {
  const v = await venue();
  const shiftId = await assignedShift(v);
  await withTransaction(suite.db, (tx) => tx.delete(shifts).where(eq(shifts.id, shiftId)));
  expect(await suite.db.select().from(shifts)).toEqual([]);
});

it("refuses to delete a staff role a shift assignment names", async () => {
  const v = await venue();
  await assignedShift(v);
  await expect(
    withTransaction(suite.db, (tx) => tx.delete(staffRoles).where(eq(staffRoles.id, v.roleId))),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  expect(await suite.db.select({ id: staffRoles.id }).from(staffRoles)).toEqual([{ id: v.roleId }]);
});

it.each([
  ["no slot", false, false, false],
  ["a role in a department", true, true, false],
  ["a role in a station", true, false, true],
] as const)("accepts a shift with %s", async (_name, role, department, station) => {
  const v = await venue();
  const shiftId = await assignedShift(v);
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`
    update shifts set staff_role_id=${role ? v.roleId : null},
      department_id=${department ? v.departmentId : null},
      station_id=${station ? v.stationId : null} where id=${shiftId}`),
  );
  const result = await suite.db.execute(sql`
    select staff_role_id, department_id, station_id from shifts where id=${shiftId}`);
  expect(result.rows).toEqual([
    {
      staff_role_id: role ? v.roleId : null,
      department_id: department ? v.departmentId : null,
      station_id: station ? v.stationId : null,
    },
  ]);
});

it.each([
  ["a role with no area", true, false, false],
  ["a role in both areas", true, true, true],
  ["a department with no role", false, true, false],
  ["a station with no role", false, false, true],
  ["both areas with no role", false, true, true],
] as const)("refuses a shift with %s", async (_name, role, department, station) => {
  const v = await venue();
  const shiftId = await assignedShift(v);
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.execute(sql`
    update shifts set staff_role_id=${role ? v.roleId : null},
      department_id=${department ? v.departmentId : null},
      station_id=${station ? v.stationId : null} where id=${shiftId}`),
    ),
  ).rejects.toThrow("CHECK constraint failed: shifts_one_area_ck");
});

it("refuses a shift's missing role or area, and keeps used areas from being deleted", async () => {
  const v = await venue();
  const shiftId = await assignedShift(v);
  for (const slot of [
    { role: "missing", department: v.departmentId, station: null },
    { role: v.roleId, department: "missing", station: null },
    { role: v.roleId, department: null, station: "missing" },
  ]) {
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.execute(sql`
      update shifts set staff_role_id=${slot.role}, department_id=${slot.department},
        station_id=${slot.station} where id=${shiftId}`),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
  }
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`
    update shifts set staff_role_id=${v.roleId}, department_id=${v.departmentId}
    where id=${shiftId}`),
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.delete(departments).where(eq(departments.id, v.departmentId)),
    ),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`
    update shifts set department_id=null, station_id=${v.stationId} where id=${shiftId}`),
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      tx.delete(kitchenStations).where(eq(kitchenStations.id, v.stationId)),
    ),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
  await expect(
    withTransaction(suite.db, (tx) => tx.delete(staffRoles).where(eq(staffRoles.id, v.roleId))),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
});
