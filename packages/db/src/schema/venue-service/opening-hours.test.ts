import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { captureError, engineErrorMessage } from "../../testing/errors.js";
import { seedVenue, seedZone } from "../../testing/seed.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { departments } from "./service.js";
import { menus } from "../menus.js";
import { menuPeriods } from "./menus.js";
import { seasons, specialDays, specialDayDates } from "./seasons.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let zoneId: string;
let departmentId: string;
let otherDepartmentId: string;
let seasonId: string;
let dateId: string;
let periodId: string;
type Row = {
  department: string | null;
  zone: string | null;
  season: string | null;
  weekday: number | null;
  date: string | null;
  kind: string;
  period: string | null;
  start: string;
  end: string;
};
const zoneWeek = (): Row => ({
  department: null,
  zone: zoneId,
  season: seasonId,
  weekday: 1,
  date: null,
  kind: "closed",
  period: null,
  start: "10:00:00",
  end: "12:00:00",
});
const zoneDate = (): Row => ({ ...zoneWeek(), season: null, weekday: null, date: dateId });
const departmentWeek = (): Row => ({
  ...zoneWeek(),
  zone: null,
  department: departmentId,
  kind: "period",
  period: periodId,
});
const departmentDate = (): Row => ({
  ...departmentWeek(),
  season: null,
  weekday: null,
  date: dateId,
  kind: "closed",
  period: null,
});
async function insert(row: Row) {
  const key = randomUUID();
  await suite.db.execute(sql`insert into opening_hours
    (id, department_id, zone_id, season_id, weekday, special_day_date_id, kind, period_id, starts_at, ends_at)
    values (${key}, ${row.department}, ${row.zone}, ${row.season}, ${row.weekday}, ${row.date},
    ${row.kind}, ${row.period}, ${row.start}, ${row.end})`);
  return key;
}
beforeEach(async () => {
  await seedVenue(suite.db, { name: "Hours", invoiceLocales: ["en"] });
  ({ id: zoneId, departmentId } = await seedZone(suite.db, { name: "Dining" }));
  const [other] = await suite.db
    .insert(departments)
    .values({ name: "Other", tradingName: "Other" })
    .returning();
  otherDepartmentId = other!.id;
  const [season] = await suite.db
    .insert(seasons)
    .values({ name: "Winter", startsOn: "01-01" })
    .returning();
  seasonId = season!.id;
  const [day] = await suite.db.insert(specialDays).values({ name: "Holiday" }).returning();
  const [date] = await suite.db
    .insert(specialDayDates)
    .values({ specialDayId: day!.id, date: "2030-12-25" })
    .returning();
  dateId = date!.id;
  const [menu] = await suite.db.insert(menus).values({ name: "Lunch" }).returning();
  const [period] = await suite.db
    .insert(menuPeriods)
    .values({ departmentId, name: "Lunch", menuId: menu!.id })
    .returning();
  periodId = period!.id;
});

describe("opening hours constraints", () => {
  it.each([
    ["both owners", "one_owner", () => ({ ...zoneWeek(), department: departmentId }), zoneWeek],
    ["neither owner", "one_owner", () => ({ ...zoneWeek(), zone: null }), zoneWeek],
    ["weekday without season", "one_day", () => ({ ...zoneDate(), weekday: 1 }), zoneDate],
    ["season and date", "one_day", () => ({ ...zoneWeek(), date: dateId }), zoneWeek],
    ["weekday outside week", "weekday", () => ({ ...zoneWeek(), weekday: 7 }), zoneWeek],
    ["unknown kind", "kind", () => ({ ...zoneWeek(), kind: "other" }), zoneWeek],
    ["zone period", "kind_by_owner", () => ({ ...zoneWeek(), period: periodId }), zoneWeek],
    [
      "open season zone",
      "kind_by_owner",
      () => ({ ...zoneWeek(), kind: "open" }),
      () => ({ ...zoneDate(), kind: "open" }),
    ],
    [
      "department period missing",
      "kind_by_owner",
      () => ({ ...departmentWeek(), period: null }),
      departmentWeek,
    ],
    [
      "closed season department",
      "kind_by_owner",
      () => ({ ...departmentWeek(), period: null, kind: "closed" }),
      departmentDate,
    ],
  ] as const)("refuses %s and accepts its legitimate twin", async (_name, rule, bad, good) => {
    const error = await captureError(() => insert(bad()));
    expect(engineErrorMessage(error)).toContain(`opening_hours_${rule}_ck`);
    const key = await insert(good());
    expect(
      (await suite.db.execute(sql`select id from opening_hours where id = ${key}`)).rows,
    ).toEqual([{ id: key }]);
  });

  it("refuses a period belonging to another department", async () => {
    const error = await captureError(() =>
      insert({ ...departmentWeek(), department: otherDepartmentId }),
    );
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
    const key = await insert(departmentWeek());
    expect(
      (await suite.db.execute(sql`select id from opening_hours where id = ${key}`)).rows,
    ).toEqual([{ id: key }]);
  });

  it.each(["zone", "season", "date", "department"] as const)(
    "deleting the %s cascades its hours",
    async (owner) => {
      const key = await insert(
        owner === "date" ? zoneDate() : owner === "department" ? departmentDate() : zoneWeek(),
      );
      if (owner === "zone")
        await suite.db.execute(sql`delete from floor_zones where id = ${zoneId}`);
      if (owner === "season")
        await suite.db.execute(sql`delete from seasons where id = ${seasonId}`);
      if (owner === "date")
        await suite.db.execute(sql`delete from special_day_dates where id = ${dateId}`);
      if (owner === "department") {
        await suite.db.execute(sql`delete from floor_zones where id = ${zoneId}`);
        await suite.db.execute(sql`delete from menu_periods where id = ${periodId}`);
        await suite.db.execute(sql`delete from departments where id = ${departmentId}`);
      }
      expect(
        (await suite.db.execute(sql`select id from opening_hours where id = ${key}`)).rows,
      ).toEqual([]);
    },
  );
});
