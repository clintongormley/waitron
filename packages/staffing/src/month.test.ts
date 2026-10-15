import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, kitchenStations, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { readStaffingMonth } from "./month.js";
import { saveSeasonStaffing, saveSpecialDayStaffing } from "./paint.js";
import { staffRoles } from "./schema/staffing.js";
import type { AreaRef, StaffingBlock } from "./slots.js";

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

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);
const AT = new Date("2026-08-10T12:00:00Z");

const block = (staffRoleId: string, over: Partial<StaffingBlock> = {}): StaffingBlock => ({
  staffRoleId,
  headcount: 2,
  startsAt: "12:00",
  endsAt: "16:00",
  ...over,
});

/** The seeded venue with Friday paint for its department and station and Saturday paint for its
 *  department, and a three-date special day: Friday 2026-08-14 painted for the department only,
 *  Saturday 2026-08-15 closed all day with no row of its own, and Friday 2026-08-21 an empty row
 *  for the department. */
async function painted() {
  const v = await seedVenue(suite.db);
  return inTx(async (tx) => {
    const [waiter] = await tx
      .insert(staffRoles)
      .values({ locationId: v.cfg.locationId, name: "Waiter" })
      .returning({ id: staffRoles.id });
    const [special] = await tx
      .insert(specialDays)
      .values({ locationId: v.cfg.locationId, name: "Fiesta" })
      .returning({ id: specialDays.id });
    const dates = await tx
      .insert(specialDayDates)
      .values([
        { specialDayId: special!.id, locationId: v.cfg.locationId, date: "2026-08-14" },
        {
          specialDayId: special!.id,
          locationId: v.cfg.locationId,
          date: "2026-08-15",
          closedAllDay: true,
        },
        { specialDayId: special!.id, locationId: v.cfg.locationId, date: "2026-08-21" },
      ])
      .returning({ id: specialDayDates.id, date: specialDayDates.date });
    const dept: AreaRef = { kind: "department", id: v.departmentId };
    const grill: AreaRef = { kind: "station", id: v.stationId };
    const role = waiter!.id;
    // Friday's late block runs past midnight and still belongs to Friday's business day.
    await saveSeasonStaffing(tx, v.cfg, v.seasonId, [
      {
        area: dept,
        weekday: 5,
        blocks: [block(role), block(role, { headcount: 1, startsAt: "20:00", endsAt: "02:00" })],
      },
      { area: grill, weekday: 5, blocks: [block(role, { headcount: 4 })] },
      { area: dept, weekday: 6, blocks: [block(role, { headcount: 6 })] },
    ]);
    await saveSpecialDayStaffing(tx, v.cfg, special!.id, [
      {
        area: dept,
        dateId: dates.find((d) => d.date === "2026-08-14")!.id,
        blocks: [block(role, { headcount: 5 })],
      },
      { area: dept, dateId: dates.find((d) => d.date === "2026-08-21")!.id, blocks: [] },
    ]);
    return { ...v, dept, grill, specialDayId: special!.id };
  });
}

const read = (cfg: { locationId: string }) =>
  inTx((tx) => readStaffingMonth(tx, cfg, "2026-08", AT));

describe("readStaffingMonth", () => {
  it("counts each painted area's slots on each business day of the month's whole weeks", async () => {
    const v = await painted();
    const month = await read(v.cfg);
    expect(month.month).toBe("2026-08");
    expect(month.today).toBe("2026-08-10");
    expect(month.areas).toEqual([
      { area: v.dept, name: "Dining room" },
      { area: v.grill, name: "Grill" },
    ]);
    expect(month.seasons).toEqual([
      { id: v.seasonId, name: "Summer", startsOn: "06-01", lastDay: "05-31" },
    ]);
    // 2026-08-01 is a Saturday: the weeks run from Monday 2026-07-27 to Sunday 2026-09-06.
    expect(month.days).toHaveLength(42);
    expect(month.days[0]!.date).toBe("2026-07-27");
    expect(month.days.at(-1)!.date).toBe("2026-09-06");
    const day = (date: string) => month.days.find((d) => d.date === date)!;
    const friday = [
      { area: v.dept, needed: 3, unfilled: null },
      { area: v.grill, needed: 4, unfilled: null },
    ];
    expect(day("2026-07-31")).toEqual({
      date: "2026-07-31",
      inMonth: false,
      seasonId: v.seasonId,
      specialDay: null,
      closedAllDay: false,
      areas: friday,
    });
    expect(day("2026-08-07")).toEqual({ ...day("2026-07-31"), date: "2026-08-07", inMonth: true });
    expect(day("2026-08-14")).toEqual({
      date: "2026-08-14",
      inMonth: true,
      seasonId: v.seasonId,
      specialDay: { id: v.specialDayId, name: "Fiesta" },
      closedAllDay: false,
      areas: [
        { area: v.dept, needed: 5, unfilled: null },
        { area: v.grill, needed: 4, unfilled: null },
      ],
    });
    expect(day("2026-08-15")).toEqual({
      date: "2026-08-15",
      inMonth: true,
      seasonId: v.seasonId,
      specialDay: { id: v.specialDayId, name: "Fiesta" },
      closedAllDay: true,
      areas: [{ area: v.dept, needed: 6, unfilled: null }],
    });
    expect(day("2026-08-21").areas).toEqual([
      { area: v.dept, needed: 0, unfilled: null },
      { area: v.grill, needed: 4, unfilled: null },
    ]);
    const paintedDays = month.days.filter((d) => d.areas.length > 0).map((d) => d.date);
    expect(paintedDays).toEqual([
      "2026-07-31",
      "2026-08-01",
      "2026-08-07",
      "2026-08-08",
      "2026-08-14",
      "2026-08-15",
      "2026-08-21",
      "2026-08-22",
      "2026-08-28",
      "2026-08-29",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("lists an active area with no paint, on no day", async () => {
    const v = await painted();
    const [pastry] = await inTx((tx) =>
      tx
        .insert(kitchenStations)
        .values({ locationId: v.cfg.locationId, name: "Pastry", displayOrder: 1 })
        .returning({ id: kitchenStations.id }),
    );
    const month = await read(v.cfg);
    const area: AreaRef = { kind: "station", id: pastry!.id };
    expect(month.areas).toEqual([
      { area: v.dept, name: "Dining room" },
      { area: v.grill, name: "Grill" },
      { area, name: "Pastry" },
    ]);
    expect(month.days.flatMap((d) => d.areas).filter((a) => a.area.id === area.id)).toEqual([]);
  });

  it("leaves out a switched-off department's paint", async () => {
    const v = await painted();
    await inTx((tx) =>
      tx.update(departments).set({ active: false }).where(eq(departments.id, v.departmentId)),
    );
    const month = await read(v.cfg);
    const friday = month.days.find((d) => d.date === "2026-08-14")!;
    expect(friday.areas).toEqual([{ area: v.grill, needed: 4, unfilled: null }]);
    expect(month.areas).toEqual([{ area: v.grill, name: "Grill" }]);
  });

  it("reads each table once, and none of the hours, zones, holidays or clock status it does not show", async () => {
    const v = await painted();
    const tables = await inTx(async (tx) => {
      const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
        .session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        await readStaffingMonth(tx, v.cfg, "2026-08", AT);
        return prepared.mock.calls.map(
          (call) => /\bfrom "(\w+)"/.exec((call[0] as { sql: string }).sql)?.[1],
        );
      } finally {
        prepared.mockRestore();
      }
    });
    expect(tables).toContain("staffing_days");
    expect(tables.length).toBe(new Set(tables).size);
    for (const unshown of [
      "floor_zones",
      "holiday_geographies",
      "location_business_day_settings",
      "tenants",
    ])
      expect(tables).not.toContain(unshown);
  });
});
