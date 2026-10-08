import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
  addMember,
  requireMenuRoot,
  buildMenuDocument,
  createCatalogue,
  createProduct,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  workingOrderLines,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { duplicateHolidayNamedSpecialDates } from "./holidays.js";
import {
  deleteSpecialDate,
  duplicateSpecialDate,
  readSpecialDate,
  saveSpecialDate,
} from "./hours.js";
import { addDays } from "./hours-rules.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import type { SpecialDateInput } from "./hours-types.js";
import {
  MENU_TIMETABLE_CALENDAR_PARTICIPANT,
  deleteMenuPeriod,
  readOpeningHoursModel,
  replaceMenuWeek,
  resolveDefaultMenu,
  resolveDepartmentService,
  saveMenuPeriod,
  saveSpecialDateMenus,
  updateMenuPeriod,
} from "./menu-timetable.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  deactivateDepartment,
  listDepartments,
  listZoneOffers,
  listVenueReadiness,
  resolveZoneContext,
  recordOrderServiceContext,
  recordWorkingLineContexts,
} from "./operations.js";
import { menuDayTimetables, menuPeriods, menuPeriodStaffMenus, menuSlots } from "./schema/menus.js";
import { specialDates } from "./schema/hours.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { offerMenuThroughZone } from "./testing/zone-menus.js";
import type { VenueScope } from "./operations.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const ZONE = "Europe/Madrid";
/** Wednesday 7 October 2026, 12:00 in Madrid: the writers' "now". */
const AT = new Date("2026-10-07T10:00:00Z");
const MONDAY = "2026-10-12";
const TUESDAY = "2026-10-13";
const SATURDAY = "2026-10-17";
const CHRISTMAS = "2026-12-25";

/** The instant the venue's clock shows `time` on `date`; the later one with `occurrence` 1. */
const madrid = (date: string, time: string, occurrence = 0): Date => {
  const instant = localTimeOccurrences(date, time, ZONE)[occurrence];
  if (instant === undefined) throw new Error(`${date} ${time} does not occur ${occurrence}`);
  return instant;
};

async function publish(tx: Transaction, menuId: string): Promise<string> {
  const { document } = await buildMenuDocument(tx, menuId);
  return (await publishMenu(tx, menuId, menuDocumentHash(document), "person-1")).versionId;
}

const MENU_NAMES = [
  "Desayunos",
  "Almuerzo",
  "Cena",
  "Bebidas",
  "Café",
  "Cócteles",
  "Copas",
  "Brunch de Navidad",
  "Deli para llevar",
] as const;
type MenuName = (typeof MENU_NAMES)[number];

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});
const weekOf = (fill: (weekday: number) => MenuSlot[]): MenuWeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: fill(weekday) }));

describe("Always fixture periods", () => {
  it("keeps the previous customer menu and staff menus when the fixture selects another default", async () => {
    const v = await venue({ timetable: false });
    await scoped(async (tx) => {
      await offerMenuThroughZone(tx, v.cfg, v.sala, v.menus.Desayunos);
      await offerMenuThroughZone(tx, v.cfg, v.sala, v.menus.Bebidas, { displayOrder: 9 });
      await offerMenuThroughZone(tx, v.cfg, v.sala, v.menus.Café, { makeDefault: true });
    });
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(MONDAY, "15:00") }),
    );
    expect(offers.defaultMenuId).toBe(v.menus.Café);
    expect(
      offers.menus.map((menu) => ({
        id: menu.id,
        audience: menu.audience,
        orderable: menu.orderable,
      })),
    ).toEqual([
      { id: v.menus.Café, audience: "customer", orderable: true },
      { id: v.menus.Desayunos, audience: "staff", orderable: true },
      { id: v.menus.Bebidas, audience: "staff", orderable: true },
    ]);
    expect(
      await db
        .select({
          menuId: menuPeriodStaffMenus.menuId,
          displayOrder: menuPeriodStaffMenus.displayOrder,
        })
        .from(menuPeriodStaffMenus)
        .innerJoin(menuPeriods, eq(menuPeriods.id, menuPeriodStaffMenus.periodId))
        .where(eq(menuPeriods.departmentId, v.restaurant))
        .orderBy(menuPeriodStaffMenus.displayOrder),
    ).toEqual([
      { menuId: v.menus.Desayunos, displayOrder: 0 },
      { menuId: v.menus.Bebidas, displayOrder: 9 },
    ]);
  });

  it("keeps two menus orderable on both sides of midnight and both touching ranges", async () => {
    const v = await venue({ timetable: false });
    await scoped(async (tx) => {
      await offerMenuThroughZone(tx, v.cfg, v.sala, v.menus.Desayunos, { makeDefault: true });
      await offerMenuThroughZone(tx, v.cfg, v.sala, v.menus.Bebidas);
    });
    for (const time of ["03:00", "06:00", "15:00", "18:00"])
      for (const zoneId of [v.sala, v.barra]) {
        const offers = await scoped((tx) =>
          listZoneOffers(tx, v.cfg, zoneId, { at: madrid(MONDAY, time) }),
        );
        expect(offers.defaultMenuId).toBe(v.menus.Desayunos);
        expect(offers.service).toEqual({
          open: true,
          periodName: "Always",
          keepOpen: {
            periodId: expect.any(String),
            periodName: "Always",
            endsAt: "06:00",
            running: true,
            extendedUntil: null,
          },
        });
        expect(
          offers.menus.map((menu) => ({
            id: menu.id,
            audience: menu.audience,
            orderable: menu.orderable,
          })),
        ).toEqual([
          { id: v.menus.Desayunos, audience: "customer", orderable: true },
          { id: v.menus.Bebidas, audience: "staff", orderable: true },
        ]);
      }
  });
});

describe("service-period writers", () => {
  it("saves signed end offsets, defaults to zero and preserves an omitted update", async () => {
    const v = await venue({ timetable: false });
    const offsets = async () =>
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).departments
        .find((department) => department.id === v.restaurant)!
        .periods.map((period) => ({ name: period.name, offset: period.endOffsetMinutes }));
    const created = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Almuerzo,
        staffMenuIds: [],
      }),
    );
    expect(await offsets()).toEqual([{ name: "Lunch", offset: 0 }]);
    for (const endOffsetMinutes of [-15, 14]) {
      await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { endOffsetMinutes }));
      expect(await offsets()).toEqual([{ name: "Lunch", offset: endOffsetMinutes }]);
    }
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { name: "Afternoon" }));
    expect(await offsets()).toEqual([{ name: "Afternoon", offset: 14 }]);
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { endOffsetMinutes: 0 }));
    expect(await offsets()).toEqual([{ name: "Afternoon", offset: 0 }]);
  });

  it.each([null, "15", 1.5, NaN, Infinity, -1440, 1440])(
    "refuses malformed end offset %s without changing a period",
    async (endOffsetMinutes) => {
      const v = await venue({ timetable: false });
      const input = { name: "Lunch", menuId: v.menus.Almuerzo, staffMenuIds: [] };
      const created = await scoped((tx) => saveMenuPeriod(tx, v.cfg, v.restaurant, input));
      const before = await db.select().from(menuPeriods).where(eq(menuPeriods.id, created.id));
      await expect(
        scoped((tx) =>
          updateMenuPeriod(tx, v.cfg, created.id, {
            name: "Changed",
            endOffsetMinutes: endOffsetMinutes as number,
          }),
        ),
      ).rejects.toMatchObject({
        code: "menu_period.invalid",
        params: {
          field: "endOffsetMinutes",
          reason:
            typeof endOffsetMinutes === "number" && Number.isInteger(endOffsetMinutes)
              ? "range"
              : "whole_minutes",
        },
      });
      expect(await db.select().from(menuPeriods).where(eq(menuPeriods.id, created.id))).toEqual(
        before,
      );
    },
  );

  it("returns only the new period id and updates without a response body", async () => {
    const v = await venue({ timetable: false });
    const created = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Almuerzo,
        staffMenuIds: [],
      }),
    );
    expect(created).toEqual({ id: expect.any(String) });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { name: "Afternoon" })),
    ).resolves.toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, created.id)),
    ).toEqual([{ name: "Afternoon" }]);
  });

  it("checks an end equal to the changeover on the following calendar date", async () => {
    expect(localTimeOccurrences("2026-03-28", "02:30", ZONE)).toHaveLength(1);
    expect(localTimeOccurrences("2026-03-29", "02:30", ZONE)).toEqual([]);
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "02:30:00" })
      .where(eq(locations.id, v.locationId));
    const date = await makeDate(v, "2026-03-28");
    await expect(
      dateMenus(v, date.id, [slot(v.periods!.noches, "21:00", "02:30")]),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "slots.0.endsAt", reason: "clock_skips" },
    });
  });

  it("checks a start equal to the changeover on the business date", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "02:30:00" })
      .where(eq(locations.id, v.locationId));
    const before = await makeDate(v, "2026-03-28");
    await dateMenus(v, before.id, [slot(v.periods!.mananas, "02:30", "21:00")]);
    const skipped = await makeDate(v, "2026-03-29");
    await expect(
      dateMenus(v, skipped.id, [slot(v.periods!.mananas, "02:30", "21:00")]),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "slots.0.startsAt", reason: "clock_skips" },
    });
    const stored = await db
      .select({ startsAt: menuSlots.startsAt, endsAt: menuSlots.endsAt })
      .from(menuSlots)
      .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
      .where(eq(menuDayTimetables.specialDateId, before.id));
    expect(stored).toEqual([{ startsAt: "02:30:00", endsAt: "21:00:00" }]);
  });

  it.each(["copy", "move"] as const)(
    "checks changeover ends on the next calendar date during a %s",
    async (action) => {
      expect(localTimeOccurrences("2027-03-27", "02:30", ZONE)).toHaveLength(1);
      expect(localTimeOccurrences("2027-03-28", "02:30", ZONE)).toEqual([]);
      const v = await venue();
      await db
        .update(locations)
        .set({ dayCutover: "02:30:00" })
        .where(eq(locations.id, v.locationId));
      const source = await makeDate(v, "2027-03-20");
      await dateMenus(v, source.id, [slot(v.periods!.noches, "21:00", "02:30")]);
      const change = () =>
        scoped<unknown>((tx) =>
          action === "copy"
            ? duplicateHolidayNamedSpecialDates(
                tx,
                v.cfg,
                source.id,
                ["2027-03-25", "2027-03-27"],
                AT,
                VENUE_SERVICE_CALENDAR_PARTICIPANTS,
              )
            : saveSpecialDate(
                tx,
                v.cfg,
                source.id,
                dateInput("2027-03-27"),
                AT,
                VENUE_SERVICE_CALENDAR_PARTICIPANTS,
              ),
        );
      await expect(change()).rejects.toMatchObject({
        code: "menu_timetable.invalid",
        params: {
          field: "date",
          date: "2027-03-27",
          departmentId: v.restaurant,
          reason: "clock_skips",
        },
      });
      const dates = await db
        .select({ date: specialDates.date })
        .from(specialDates)
        .where(eq(specialDates.locationId, v.locationId));
      expect(dates).toEqual([{ date: "2027-03-20" }]);
      const stored = await db
        .select({ startsAt: menuSlots.startsAt, endsAt: menuSlots.endsAt })
        .from(menuSlots)
        .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
        .where(eq(menuDayTimetables.specialDateId, source.id));
      expect(stored).toEqual([{ startsAt: "21:00:00", endsAt: "02:30:00" }]);
    },
  );

  it("always creates a new period even if an untyped caller sends an existing id", async () => {
    const v = await venue({ timetable: false });
    const original = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Almuerzo,
        staffMenuIds: [],
      }),
    );
    const created = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        id: original.id,
        name: "Afternoon",
        menuId: v.menus.Café,
        staffMenuIds: [],
      } as never),
    );
    expect(created.id).not.toBe(original.id);
    expect(
      await db
        .select({ id: menuPeriods.id, name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.departmentId, v.restaurant))
        .orderBy(menuPeriods.name),
    ).toEqual([
      { id: created.id, name: "Afternoon", menuId: v.menus.Café },
      { id: original.id, name: "Lunch", menuId: v.menus.Almuerzo },
    ]);
  });

  it("refuses explicit null fields rather than treating them as omitted", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Bebidas,
        staffMenuIds: [],
      }),
    );
    for (const field of ["colour", "staffMenuIds"] as const) {
      await expect(
        scoped((tx) => updateMenuPeriod(tx, v.cfg, id, { [field]: null } as never)),
      ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field } });
    }
  });

  it("uses the location's changeover and refuses a range crossing the end of its business day", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "08:00:00" })
      .where(eq(locations.id, v.locationId));
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((day) => (day === 1 ? [slot(v.periods!.mananas, "07:00", "09:00")] : [])),
          AT,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "days.1.slots", reason: "order" },
    });
  });

  it("refuses off-step week and special-date ranges", async () => {
    const v = await venue();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((day) => (day === 1 ? [slot(v.periods!.mananas, "12:10", "14:00")] : [])),
          AT,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "days.1.slots", reason: "step" },
    });
    const special = await makeDate(v, CHRISTMAS);
    await expect(
      dateMenus(v, special.id, [slot(v.periods!.mananas, "12:00", "14:10")]),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "slots", reason: "step" },
    });
  });

  it("checks skipped times on the calendar date that owns each business-day endpoint", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "06:00:00" })
      .where(eq(locations.id, v.locationId));
    const before = await makeDate(v, "2026-03-28");
    await expect(
      dateMenus(v, before.id, [slot(v.periods!.noches, "21:00", "02:30")]),
    ).rejects.toMatchObject({ code: "menu_timetable.invalid", params: { reason: "clock_skips" } });
    const after = await makeDate(v, "2026-03-29");
    await dateMenus(v, after.id, [slot(v.periods!.noches, "06:00", "02:30")]);
    const stored = await db
      .select({ startsAt: menuSlots.startsAt, endsAt: menuSlots.endsAt })
      .from(menuSlots)
      .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
      .where(eq(menuDayTimetables.specialDateId, after.id));
    expect(stored).toEqual([{ startsAt: "06:00:00", endsAt: "02:30:00" }]);
  });

  it.each([null, "pink", 1])("refuses an explicit invalid colour %s", async (colour) => {
    const v = await venue({ timetable: false });
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: "Lunch",
          menuId: v.menus.Bebidas,
          staffMenuIds: [],
          colour: colour as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "colour" } });
  });

  it("refuses changing the customer menu to a retained staff menu and leaves the period untouched", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Bebidas,
        staffMenuIds: [v.menus.Café],
        colour: "blue",
      }),
    );
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, id, { menuId: v.menus.Café })),
    ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "staffMenuIds" } });
    expect(
      await db
        .select({ menuId: menuPeriods.menuId, colour: menuPeriods.colour })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, id)),
    ).toEqual([{ menuId: v.menus.Bebidas, colour: "blue" }]);
  });

  it("saves an active customer menu outside the old list, trims the name and keeps staff-menu order", async () => {
    const v = await venue({ timetable: false });
    const period = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: " Lunch ",
        menuId: v.menus["Deli para llevar"],
        staffMenuIds: [v.menus.Café, v.menus.Bebidas],
      }),
    );
    expect(
      await db
        .select({ name: menuPeriods.name, colour: menuPeriods.colour, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, period.id)),
    ).toEqual([{ name: "Lunch", colour: "red", menuId: v.menus["Deli para llevar"] }]);
    const staff = () =>
      db
        .select({
          menuId: menuPeriodStaffMenus.menuId,
          position: menuPeriodStaffMenus.displayOrder,
        })
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, period.id))
        .orderBy(menuPeriodStaffMenus.displayOrder);
    expect(await staff()).toEqual([
      { menuId: v.menus.Café, position: 0 },
      { menuId: v.menus.Bebidas, position: 1 },
    ]);
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, period.id, {
        staffMenuIds: [v.menus.Bebidas, v.menus.Café],
        colour: "purple",
      }),
    );
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, period.id, { name: " Afternoon " }));
    expect(await staff()).toEqual([
      { menuId: v.menus.Bebidas, position: 0 },
      { menuId: v.menus.Café, position: 1 },
    ]);
    expect(
      await db
        .select({ name: menuPeriods.name, colour: menuPeriods.colour, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, period.id)),
    ).toEqual([{ name: "Afternoon", colour: "purple", menuId: v.menus["Deli para llevar"] }]);
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, period.id, { staffMenuIds: [] }));
    expect(await staff()).toEqual([]);
  });

  it("chooses the first unused department colour, repeating red after all six", async () => {
    const v = await venue({ timetable: false });
    const colours = [];
    for (let index = 0; index < 7; index++) {
      const { id } = await scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: `Period ${index}`,
          menuId: v.menus.Bebidas,
          staffMenuIds: [],
        }),
      );
      const [row] = await db
        .select({ colour: menuPeriods.colour })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, id));
      colours.push(row!.colour);
    }
    expect(colours).toEqual(["red", "amber", "grey", "blue", "green", "purple", "red"]);
  });

  it.each(["customer", "staff"] as const)(
    "refuses an inactive %s catalogue without writing a period",
    async (kind) => {
      const v = await venue({ timetable: false });
      await db.update(catalogues).set({ active: false }).where(eq(catalogues.id, v.menus.Café));
      await expect(
        scoped((tx) =>
          saveMenuPeriod(tx, v.cfg, v.restaurant, {
            name: "Lunch",
            menuId: kind === "customer" ? v.menus.Café : v.menus.Bebidas,
            staffMenuIds: kind === "staff" ? [v.menus.Café] : [],
          }),
        ),
      ).rejects.toMatchObject({
        code: "catalogue.not_found",
        params: { catalogueId: v.menus.Café },
      });
      expect(
        await db.select().from(menuPeriods).where(eq(menuPeriods.departmentId, v.restaurant)),
      ).toEqual([]);
    },
  );

  it.each(["customer", "duplicate"] as const)(
    "refuses a %s entry among staff menus",
    async (kind) => {
      const v = await venue({ timetable: false });
      await expect(
        scoped((tx) =>
          saveMenuPeriod(tx, v.cfg, v.restaurant, {
            name: "Lunch",
            menuId: v.menus.Bebidas,
            staffMenuIds: kind === "customer" ? [v.menus.Bebidas] : [v.menus.Café, v.menus.Café],
          }),
        ),
      ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "staffMenuIds" } });
      expect(
        await db.select().from(menuPeriods).where(eq(menuPeriods.departmentId, v.restaurant)),
      ).toEqual([]);
    },
  );
});

async function venue(options: { timetable?: boolean; unpublished?: MenuName[] } = {}) {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: ZONE,
    })
    .returning({ id: locations.id });
  const locationId: LocationId = brandLocationId(location!.id);
  const cfg = { locationId };
  await db.insert(kitchenStations).values({ locationId, name: "Cocina", isDefault: true });
  const zone = async (name: string, displayOrder: number) =>
    (
      await db
        .insert(floorZones)
        .values({ locationId, name, displayOrder })
        .returning({ id: floorZones.id })
    )[0]!.id;
  const barra = await zone("Barra", 0);
  const sala = await zone("Sala", 1);
  const terraza = await zone("Terraza", 2);
  const mostrador = await zone("Mostrador deli", 3);
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", defaultServiceMode: "table_tab" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" }))
      .id;
    for (const zoneId of [barra, sala, terraza])
      await configureZone(tx, cfg, { zoneId, departmentId: restaurant });
    await configureZone(tx, cfg, { zoneId: mostrador, departmentId: deli });
    const menus = {} as Record<MenuName, string>;
    for (const name of MENU_NAMES) {
      menus[name] = (await createCatalogue(tx, { name })).id;
      if (!options.unpublished?.includes(name)) await publish(tx, menus[name]);
    }
    const v = { cfg, locationId, restaurant, deli, barra, sala, terraza, mostrador, menus };
    if (options.timetable === false) return { ...v, periods: null };
    const period = async (departmentId: string, name: string, menu: MenuName) =>
      (await saveMenuPeriod(tx, cfg, departmentId, { name, menuId: menus[menu], staffMenuIds: [] }))
        .id;
    const periods = {
      mananas: await period(restaurant, "Mañanas", "Desayunos"),
      mediodia: await period(restaurant, "Mediodía", "Almuerzo"),
      noches: await period(restaurant, "Noches", "Cena"),
      madrugada: await period(restaurant, "Madrugada", "Copas"),
      brunch: await period(restaurant, "Brunch navideño", "Brunch de Navidad"),
      mediodiaDeli: await period(deli, "Mediodía deli", "Deli para llevar"),
    };
    await replaceMenuWeek(tx, cfg, restaurant, restaurantWeek(periods), AT);
    await replaceMenuWeek(
      tx,
      cfg,
      deli,
      weekOf(() => [slot(periods.mediodiaDeli, "12:00", "15:00")]),
      AT,
    );
    return { ...v, periods };
  });
}

type Periods = Record<"mananas" | "mediodia" | "noches" | "madrugada", string>;

/**
 * Monday to Friday Mañanas 09:00–12:00, Mediodía 12:00–16:00 and Noches 18:00–20:00, plus
 * Madrugada 22:00–02:00 on Friday; Saturday and Sunday Mediodía 13:00–17:00 alone.
 */
function restaurantWeek(p: Periods, change: (weekday: number) => MenuSlot[] | null = () => null) {
  return weekOf(
    (weekday) =>
      change(weekday) ??
      (weekday === 0 || weekday === 6
        ? [slot(p.mediodia, "13:00", "17:00")]
        : [
            slot(p.mananas, "09:00", "12:00"),
            slot(p.mediodia, "12:00", "16:00"),
            slot(p.noches, "18:00", "20:00"),
            ...(weekday === 5 ? [slot(p.madrugada, "22:00", "02:00")] : []),
          ]),
  );
}

type Venue = Awaited<ReturnType<typeof venue>>;
type Timed = Venue & { periods: NonNullable<Venue["periods"]> };
const timed = async (options: { unpublished?: MenuName[] } = {}) => (await venue(options)) as Timed;

const resolve = (v: Venue, zoneId: string, at: Date) =>
  scoped(async (tx) => {
    const zone = await resolveZoneContext(tx, v.cfg, zoneId);
    return resolveDepartmentService(tx, v.cfg, zone.departmentId, at);
  });
/** The default and the period in force, the two fields the cases below vary. */
const choice = async (v: Venue, zoneId: string, at: Date) => {
  const { customerMenuId: defaultMenuId, periodId } = await resolve(v, zoneId, at);
  return { defaultMenuId, periodId };
};

const dateInput = (date: string, overrides: Partial<SpecialDateInput> = {}): SpecialDateInput => ({
  date,
  name: "Navidad",
  colour: "red",
  closeWholeVenue: false,
  cells: [],
  ...overrides,
});
const makeDate = (v: Venue, date: string, overrides: Partial<SpecialDateInput> = {}) =>
  scoped(async (tx) => {
    const saved = await saveSpecialDate(tx, v.cfg, null, dateInput(date, overrides), AT);
    await tx
      .update(specialDates)
      .set({ ownHours: !overrides.closeWholeVenue })
      .where(eq(specialDates.id, saved.id));
    return saved;
  });
const turnOffOwnHours = (v: { cfg: VenueScope }, id: string) =>
  scoped(async (tx) => {
    const day = await readSpecialDate(tx, v.cfg, id);
    await saveSpecialDate(
      tx,
      v.cfg,
      id,
      { ...day, ownHours: false },
      AT,
      VENUE_SERVICE_CALENDAR_PARTICIPANTS,
    );
  });
const dateMenus = (v: Venue, specialDateId: string, slots: MenuSlot[], at = AT) =>
  scoped((tx) => saveSpecialDateMenus(tx, v.cfg, specialDateId, v.restaurant, slots, at));

const invalid = (field: string, extra: Record<string, string> = {}) => ({
  code: "menu_timetable.invalid",
  params: { field, ...extra },
});

describe("the menu a zone starts on", () => {
  it("follows the week's named periods, start included and end excluded, closing in a gap", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.sala, { at: madrid(MONDAY, "10:00") }),
    );
    expect(offers.defaultMenuId).toBe(menus.Desayunos);
    expect(offers.service).toEqual({
      open: true,
      periodName: "Mañanas",
      keepOpen: {
        periodId: periods.mananas,
        periodName: "Mañanas",
        endsAt: "12:00",
        running: true,
        extendedUntil: null,
      },
    });
    expect(offers.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      menus.Desayunos,
    ]);
    expect(await choice(v, v.sala, madrid(MONDAY, "12:00"))).toEqual({
      defaultMenuId: menus.Almuerzo,
      periodId: periods.mediodia,
    });
    expect(await choice(v, v.sala, madrid(MONDAY, "11:59"))).toEqual({
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });
    for (const time of ["16:00", "17:00"])
      expect(await choice(v, v.sala, madrid(MONDAY, time))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("uses the department's customer menu in every zone, with the same ordered staff menus", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mananas, {
        staffMenuIds: [v.menus.Café, v.menus.Bebidas],
      }),
    );
    for (const zoneId of [v.barra, v.sala, v.terraza]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, v.cfg, zoneId, { at: madrid(MONDAY, "10:00") }),
      );
      expect(offers.defaultMenuId).toBe(v.menus.Desayunos);
      expect(offers.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
        v.menus.Desayunos,
        v.menus.Café,
        v.menus.Bebidas,
      ]);
    }
  });

  it("keeps a department's period menu on every day the period runs, after only Monday's slots were edited", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 1
            ? [
                slot(periods.mananas, "08:30", "12:00"),
                slot(periods.mediodia, "12:00", "16:00"),
                slot(periods.noches, "18:00", "20:00"),
              ]
            : null,
        ),
        AT,
      );
    });
    expect(await choice(v, v.barra, madrid(TUESDAY, "10:00"))).toEqual({
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });
    expect(await choice(v, v.barra, madrid(MONDAY, "08:45"))).toEqual({
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });
  });

  it("closes every zone in a department between periods while keeping its published menus", async () => {
    const v = await timed();
    for (const zoneId of [v.barra, v.sala, v.terraza]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, v.cfg, zoneId, { at: madrid(MONDAY, "17:00") }),
      );
      expect(offers.defaultMenuId).toBeNull();
      expect(offers.service.open).toBe(false);
      expect(offers.menus).toHaveLength(5);
      expect(offers.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
    }
  });

  it("reads the weekend's own slots, and a Friday slot past midnight on Saturday until it ends", async () => {
    const v = await timed();
    const { menus, periods } = v;
    expect(await choice(v, v.sala, madrid(SATURDAY, "10:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect(await choice(v, v.sala, madrid(SATURDAY, "13:00"))).toEqual({
      defaultMenuId: menus.Almuerzo,
      periodId: periods.mediodia,
    });
    expect(await choice(v, v.sala, madrid(SATURDAY, "01:00"))).toEqual({
      defaultMenuId: menus.Copas,
      periodId: periods.madrugada,
    });
    expect(await choice(v, v.sala, madrid(SATURDAY, "02:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
  });

  it("follows the clock's own reading on a day it changes", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const backward = clockChangeAfter(ZONE, "2027-07-01T00:00:00Z", "backward");
    const precedingBusinessDay = (slots: MenuSlot[]) =>
      restaurantWeek(periods, (weekday) =>
        weekday === 6 ? [slot(periods.mediodia, "13:00", "17:00"), ...slots] : null,
      );
    const skipped = minutesAfter(forward.before, 16);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        precedingBusinessDay([slot(periods.madrugada, skipped, "04:00")]),
        AT,
      ),
    );
    expect(await choice(v, v.sala, forward.instant)).toEqual({
      defaultMenuId: menus.Copas,
      periodId: periods.madrugada,
    });
    expect(await choice(v, v.sala, new Date(forward.instant.getTime() - 60_000))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });

    const boundary = minutesAfter(backward.after, 30);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        precedingBusinessDay([
          slot(periods.madrugada, "00:30", boundary),
          slot(periods.mananas, boundary, "05:00"),
        ]),
        AT,
      ),
    );
    for (const occurrence of [0, 1]) {
      const at = (time: string) => madrid(backward.date, time, occurrence);
      expect((await resolve(v, v.sala, at(backward.after))).periodId).toBe(periods.madrugada);
      expect((await resolve(v, v.sala, at(minutesAfter(boundary, -1)))).periodId).toBe(
        periods.madrugada,
      );
      expect((await resolve(v, v.sala, at(boundary))).periodId).toBe(periods.mananas);
      expect((await resolve(v, v.sala, at(minutesAfter(boundary, 15)))).periodId).toBe(
        periods.mananas,
      );
    }
  });

  it("applies no slot when the venue's clock cannot be read", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
    });
    for (const zoneId of [v.sala, v.barra])
      expect(await choice(v, zoneId, madrid(MONDAY, "10:00"))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("is refused for a zone of an inactive department, or of another venue", async () => {
    const v = await timed();
    await scoped((tx) => deactivateDepartment(tx, v.cfg, v.deli));
    await expect(resolve(v, v.mostrador, madrid(MONDAY, "12:30"))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: v.mostrador },
    });
    const other = await timed();
    await expect(resolve(v, other.sala, madrid(MONDAY, "12:30"))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: other.sala },
    });
  });

  it("leaves an inactive menu out of the list while a period still names it as the default", async () => {
    const v = await timed();
    await scoped((tx) =>
      tx.update(catalogues).set({ active: false }).where(eq(catalogues.id, v.menus.Desayunos)),
    );
    const resolved = await resolve(v, v.sala, madrid(MONDAY, "10:00"));
    expect(resolved.orderableMenuIds).toEqual([v.menus.Desayunos]);
    expect(resolved.customerMenuId).toBe(v.menus.Desayunos);
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.sala, { at: madrid(MONDAY, "10:00") }),
    );
    expect(offers.defaultMenuId).toBeNull();
    expect(offers.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });
});

describe("a special date's menu timetable", () => {
  it("replaces the department's week that date, an empty one closing the department all day", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const at = (time: string) => madrid(CHRISTMAS, time);
    expect(await choice(v, v.sala, at("10:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect(await choice(v, v.sala, at("12:00"))).toEqual({
      defaultMenuId: menus["Brunch de Navidad"],
      periodId: periods.brunch,
    });
    expect(await choice(v, v.sala, at("16:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect((await resolve(v, v.sala, madrid("2026-12-26", "01:00"))).periodId).toBeNull();
    // Deli has no timetable of its own that date, so it follows its week.
    expect(await choice(v, v.mostrador, at("12:00"))).toEqual({
      defaultMenuId: menus["Deli para llevar"],
      periodId: periods.mediodiaDeli,
    });

    await scoped(async (tx) => {
      await saveSpecialDateMenus(
        tx,
        v.cfg,
        christmas.id,
        v.restaurant,
        [slot(periods.mananas, "09:00", "11:00")],
        AT,
      );
    });
    expect(await choice(v, v.barra, at("10:00"))).toEqual({
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });

    await dateMenus(v, christmas.id, []);
    for (const time of ["10:00", "12:00"])
      expect(await choice(v, v.sala, at(time))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("honours a whole-venue closure and refuses a range crossing the changeover", async () => {
    const v = await timed();
    const { periods } = v;
    const christmas = await makeDate(v, CHRISTMAS, { closeWholeVenue: true });
    await db.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, christmas.id));
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const at = (time: string) => madrid(CHRISTMAS, time);
    expect((await resolve(v, v.sala, at("12:00"))).customerMenuId).toBeNull();
    expect((await resolve(v, v.sala, at("16:00"))).customerMenuId).toBeNull();
    expect((await resolve(v, v.mostrador, at("12:00"))).periodId).toBeNull();
    // This range runs beyond the next changeover.
    await expect(
      dateMenus(v, christmas.id, [slot(periods.madrugada, "23:00", "14:00")]),
    ).rejects.toMatchObject(invalid("slots", { reason: "order" }));
  });

  it("refuses a slot opening or closing at a minute the clock skips that date, writing nothing", async () => {
    const v = await timed();
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const skipped = minutesAfter(forward.before, 16);
    const date = await makeDate(v, addDays(forward.date, -1));
    await expect(
      dateMenus(v, date.id, [slot(v.periods.mananas, "00:30", skipped)]),
    ).rejects.toMatchObject(invalid("slots.0.endsAt"));
    await expect(
      dateMenus(v, date.id, [
        slot(v.periods.madrugada, "00:00", "00:30"),
        slot(v.periods.mananas, skipped, "05:00"),
      ]),
    ).rejects.toMatchObject(invalid("slots.1.startsAt"));
    expect(
      await db.select().from(menuDayTimetables).where(eq(menuDayTimetables.specialDateId, date.id)),
    ).toEqual([]);
  });

  it("refuses another venue's date or department, and a date or department that does not exist", async () => {
    const v = await timed();
    const other = await timed();
    const christmas = await makeDate(v, CHRISTMAS);
    const unknown = randomUUID();
    for (const [cfg, specialDateId, departmentId, refusal] of [
      [
        v.cfg,
        christmas.id,
        other.restaurant,
        { code: "department.not_found", params: { departmentId: other.restaurant } },
      ],
      [
        v.cfg,
        christmas.id,
        unknown,
        { code: "department.not_found", params: { departmentId: unknown } },
      ],
      [
        v.cfg,
        unknown,
        v.restaurant,
        { code: "special_date.not_found", params: { specialDateId: unknown } },
      ],
      [
        other.cfg,
        christmas.id,
        other.restaurant,
        { code: "special_date.not_found", params: { specialDateId: christmas.id } },
      ],
    ] as const) {
      await expect(
        scoped((tx) => saveSpecialDateMenus(tx, cfg, specialDateId, departmentId, [], AT)),
      ).rejects.toMatchObject(refusal);
    }
  });
});

describe("the timetable's writers", () => {
  it("checks structural ranges but skips clock-gap checks when the clock cannot be read", async () => {
    const v = await timed();
    await db.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, v.locationId));
    const date = await makeDate(v, "2027-03-27");
    await dateMenus(v, date.id, [slot(v.periods.mananas, "00:30", "02:30")]);
    expect(
      await db
        .select({ startsAt: menuSlots.startsAt, endsAt: menuSlots.endsAt })
        .from(menuSlots)
        .innerJoin(menuDayTimetables, eq(menuDayTimetables.id, menuSlots.timetableId))
        .where(eq(menuDayTimetables.specialDateId, date.id)),
    ).toEqual([{ startsAt: "00:30:00", endsAt: "02:30:00" }]);
    await expect(
      dateMenus(v, date.id, [slot(v.periods.mananas, "01:00", "12:00")]),
    ).rejects.toMatchObject(invalid("slots", { reason: "order" }));
  });

  it("refuse a period, menu or slot from another department, and an unknown period", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const absentMenu = randomUUID();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, periods.noches, { name: "Cenas", menuId: menus.Cena }),
    );
    expect(
      await scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { menuId: menus.Cócteles })),
    ).toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, periods.noches)),
    ).toEqual([{ name: "Cenas", menuId: menus.Cócteles }]);
    expect(
      await scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { name: "Noches tarde" })),
    ).toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, periods.noches)),
    ).toEqual([{ name: "Noches tarde", menuId: menus.Cócteles }]);
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const restaurant = model.departments.find((entry) => entry.id === v.restaurant)!;
    expect(restaurant.periods.find((period) => period.id === periods.noches)).toMatchObject({
      name: "Noches tarde",
      menuId: menus.Cócteles,
    });
    // A partial update is still checked like a whole one.
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { menuId: absentMenu })),
    ).rejects.toMatchObject({
      code: "catalogue.not_found",
      params: { catalogueId: absentMenu },
    });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { name: "  " })),
    ).rejects.toMatchObject(invalid("name"));
  });

  it("changes a period's menus without a department membership list and preserves other periods", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mananas, {
        menuId: v.menus.Café,
        staffMenuIds: [v.menus.Bebidas],
      }),
    );
    for (const zoneId of [v.barra, v.sala, v.terraza])
      expect(await choice(v, zoneId, madrid(MONDAY, "10:00"))).toEqual({
        defaultMenuId: v.menus.Café,
        periodId: v.periods.mananas,
      });
    expect(await choice(v, v.barra, madrid(MONDAY, "12:30"))).toEqual({
      defaultMenuId: v.menus.Almuerzo,
      periodId: v.periods.mediodia,
    });
  });

  it("keeps each business day independent of neighbouring special dates", async () => {
    const v = await timed();
    const { periods } = v;
    const fridayTail = (endsAt: string) =>
      restaurantWeek(periods, (weekday) =>
        weekday === 5
          ? [slot(periods.mananas, "09:00", "12:00"), slot(periods.madrugada, "22:00", endsAt)]
          : null,
      );
    // Saturday 3 October is past at AT: its clash with the Friday before is history.
    const past = await makeDate(v, "2026-10-03");
    await dateMenus(v, past.id, [slot(periods.mananas, "01:00", "03:00")]);
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("03:00"), AT));
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("02:00"), AT));
    // Tuesday 6 October is yesterday at AT, so it is read, but its pair with Monday is past.
    const yesterday = await makeDate(v, "2026-10-06");
    await dateMenus(v, yesterday.id, [slot(periods.mananas, "01:00", "03:00")]);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 1 ? [slot(periods.madrugada, "22:00", "03:00")] : null,
        ),
        AT,
      ),
    );
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("02:00"), AT));

    const coming = await makeDate(v, "2026-10-24");
    await dateMenus(v, coming.id, [slot(periods.mananas, "02:30", "05:00")]);
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("03:00"), AT));
    // The replacement week was written.
    expect((await resolve(v, v.sala, madrid("2026-10-31", "02:30"))).periodId).toBe(
      periods.madrugada,
    );
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, weekOf(() => []).slice(1), AT)),
    ).rejects.toMatchObject(invalid("days"));
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf(() => []),
          AT,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          randomUUID(),
          weekOf(() => []),
          AT,
        ),
      ),
    ).rejects.toMatchObject({ code: "department.not_found" });
  });

  it("refuse deleting a period still placed, naming every day; once none does, delete it with its staff menus", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, periods.noches, { staffMenuIds: [menus.Cócteles] }),
    );
    expect(
      await db
        .select({ menuId: menuPeriodStaffMenus.menuId })
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, periods.noches)),
    ).toEqual([{ menuId: menus.Cócteles }]);
    await expect(scoped((tx) => deleteMenuPeriod(tx, v.cfg, periods.noches))).rejects.toMatchObject(
      {
        code: "menu_period.in_use",
        params: {
          periodId: periods.noches,
          uses: [1, 2, 3, 4, 5].map((weekday) => ({ kind: "week", weekday })),
        },
      },
    );
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [slot(periods.mananas, "09:00", "12:00")]),
        AT,
      );
      await deleteMenuPeriod(tx, v.cfg, periods.noches);
    });
    expect(
      await db
        .select()
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, periods.noches)),
    ).toEqual([]);
  });
});

describe("a period no longer placed anywhere but a past special date", () => {
  it("is shown with that date, which can be cleared, so the period can be deleted", async () => {
    const v = await timed();
    const { periods } = v;
    const lastChristmas = await makeDate(v, "2025-12-25");
    await dateMenus(v, lastChristmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const use = { kind: "special_date", specialDateId: lastChristmas.id, date: "2025-12-25" };
    await expect(scoped((tx) => deleteMenuPeriod(tx, v.cfg, periods.brunch))).rejects.toMatchObject(
      { code: "menu_period.in_use", params: { periodId: periods.brunch, uses: [use] } },
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.specialDates).toContainEqual({
      kind: "working_day",
      repeats: false,
      ownHours: true,
      id: lastChristmas.id,
      date: "2025-12-25",
      name: "Navidad",
      colour: "blue",
      closeWholeVenue: false,
    });
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.dates).toEqual([
      { specialDateId: lastChristmas.id, slots: [slot(periods.brunch, "11:00", "15:00")] },
    ]);
    expect(restaurant.periods.find((period) => period.id === periods.brunch)!.weekdays).toEqual([]);

    await turnOffOwnHours(v, lastChristmas.id);
    await scoped((tx) => deleteMenuPeriod(tx, v.cfg, periods.brunch));
    const after = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(after.specialDates.map((date) => date.id)).not.toContain(lastChristmas.id);
  });
});

describe("a zone moved to another department", () => {
  it("uses the new department's current period and preserves the other zone's menus", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      await configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.deli });
    });
    const at = madrid(MONDAY, "13:00");
    const moved = await scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { at }));
    expect(moved.defaultMenuId).toBe(v.menus["Deli para llevar"]);
    expect(moved.menus.map((menu) => menu.id)).toEqual([v.menus["Deli para llevar"]]);
    const other = await scoped((tx) => listZoneOffers(tx, v.cfg, v.terraza, { at }));
    expect(other.defaultMenuId).toBe(v.menus.Almuerzo);
    expect(other.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      v.menus.Almuerzo,
    ]);
  });

  it("keeps period membership when a zone is configured again within its department", async () => {
    const v = await timed();
    const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    await scoped((tx) => configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.restaurant }));
    expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
    expect(await choice(v, v.barra, madrid(MONDAY, "10:00"))).toEqual({
      defaultMenuId: v.menus.Desayunos,
      periodId: v.periods.mananas,
    });
  });
});

/** Adds Tortilla to Desayunos, republishes it, and records one Sala order line from it. */
async function recordedLine(v: Timed) {
  const nodeId = await seedNode(db, v.locationId);
  await db.execute(sql`
    insert into units (id, seed_key, name, abbreviation, precision, hardware_unit)
    values (${randomUUID()}, 'each', '{"en":"each"}', '{"en":"ea"}', 0, null)`);
  return scoped(async (tx) => {
    const product = await createProduct(tx, {
      catalogueId: v.menus.Desayunos,
      categoryId: null,
      name: "Tortilla",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "general",
    });
    const offer = await addProductToMenu(tx, {
      menuId: v.menus.Desayunos,
      productId: product.id,
      grossPrice: "4.50",
    });
    await publish(tx, v.menus.Desayunos);
    const orderId = randomUUID();
    await tx.execute(sql`
      insert into working_orders (id, source, location_id, node_id, order_number, opened_at)
      values (${orderId}, 'dashboard', ${v.locationId}, ${nodeId}, 1, ${AT.toISOString()})`);
    await recordOrderServiceContext(tx, v.cfg, orderId, v.sala);
    const lineId = randomUUID();
    await tx.insert(workingOrderLines).values({
      id: lineId,
      workingOrderId: orderId,
      lineNo: 1,
      productId: product.id,
      name: "Tortilla",
      descriptions: { "es-ES": "Tortilla" },
      quantity: 1000,
      unitPriceGross: 450,
      vatClass: "general",
      lineTotal: 450,
      category: "Uncategorised",
    });
    await recordWorkingLineContexts(
      tx,
      v.cfg,
      orderId,
      [{ workingOrderLineId: lineId, menuItemId: offer.id }],
      await listZoneOffers(tx, v.cfg, v.sala),
    );
  });
}

const lineContexts = () =>
  db.execute(sql`select * from working_line_contexts order by working_order_line_id`);

describe("the calendar participant", () => {
  it("is the venue's one participant", () => {
    expect(VENUE_SERVICE_CALENDAR_PARTICIPANTS).toContain(MENU_TIMETABLE_CALENDAR_PARTICIPANT);
  });

  it("copies a date's timetables under new ids, on the same named periods, without changing period membership", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, periods.mananas, { staffMenuIds: [menus.Café] }),
    );
    const christmas = await makeDate(v, CHRISTMAS);
    await scoped(async (tx) => {
      await saveSpecialDateMenus(
        tx,
        v.cfg,
        christmas.id,
        v.restaurant,
        [slot(periods.mananas, "09:00", "11:00")],
        AT,
      );
    });
    // A Saturday and a Sunday, whose weeks have no Mañanas.
    const targets = ["2027-12-25", "2028-12-24"];
    const copies = await scoped((tx) =>
      duplicateHolidayNamedSpecialDates(
        tx,
        v.cfg,
        christmas.id,
        targets,
        AT,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
    for (const date of targets)
      expect(await choice(v, v.barra, madrid(date, "10:00"))).toEqual({
        defaultMenuId: menus.Desayunos,
        periodId: periods.mananas,
      });
    expect(await choice(v, v.sala, madrid("2028-12-24", "13:30"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    const timetables = await db
      .select()
      .from(menuDayTimetables)
      .where(inArray(menuDayTimetables.specialDateId, [christmas.id, ...copies.map((c) => c.id)]));
    expect(new Set(timetables.map((row) => row.id)).size).toBe(3);
    const slots = await db
      .select()
      .from(menuSlots)
      .where(
        inArray(
          menuSlots.timetableId,
          timetables.map((row) => row.id),
        ),
      );
    expect(new Set(slots.map((row) => row.id)).size).toBe(3);
    expect(new Set(slots.map((row) => row.periodId))).toEqual(new Set([periods.mananas]));
    expect(
      await db
        .select()
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, periods.mananas)),
    ).toHaveLength(1);
  });

  it("refuses a copy whose slot would end at a minute its target's clock skips, creating no target", async () => {
    const v = await timed();
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const weekEarlier = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const twoWeeksEarlier = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const source = await makeDate(v, weekEarlier);
    await dateMenus(v, source.id, [
      slot(v.periods.mananas, "00:30", minutesAfter(forward.before, 16)),
    ]);
    await expect(
      scoped((tx) =>
        duplicateHolidayNamedSpecialDates(
          tx,
          v.cfg,
          source.id,
          [twoWeeksEarlier, addDays(forward.date, -1)],
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(
      invalid("date", { date: addDays(forward.date, -1), departmentId: v.restaurant }),
    );
    const stored = await db
      .select({ date: specialDates.date })
      .from(specialDates)
      .where(eq(specialDates.locationId, v.locationId));
    expect(stored.map((row) => row.date)).toEqual([weekEarlier]);
  });

  it("copies ranges independently of the next business day", async () => {
    const v = await timed();
    const source = await makeDate(v, "2026-12-12");
    await dateMenus(v, source.id, [slot(v.periods.madrugada, "23:00", "03:00")]);
    await scoped((tx) =>
      duplicateHolidayNamedSpecialDates(
        tx,
        v.cfg,
        source.id,
        ["2026-12-19", "2026-12-20"],
        AT,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
    const stored = await db
      .select({ date: specialDates.date, startsAt: menuSlots.startsAt, endsAt: menuSlots.endsAt })
      .from(specialDates)
      .innerJoin(menuDayTimetables, eq(menuDayTimetables.specialDateId, specialDates.id))
      .innerJoin(menuSlots, eq(menuSlots.timetableId, menuDayTimetables.id))
      .where(eq(specialDates.locationId, v.locationId))
      .orderBy(specialDates.date);
    expect(stored).toEqual(
      ["2026-12-12", "2026-12-19", "2026-12-20"].map((date) => ({
        date,
        startsAt: "23:00:00",
        endsAt: "03:00:00",
      })),
    );
  });

  it("lets clearing and deleting a date restore the week independently of its neighbour", async () => {
    const v = await timed();
    const { periods } = v;
    await recordedLine(v);
    const recorded = await lineContexts();
    expect(recorded.rows).toHaveLength(1);
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.mananas, "09:00", "11:00")]);
    const boxingDay = await makeDate(v, "2026-12-26");
    await dateMenus(v, boxingDay.id, [slot(periods.mananas, "01:00", "03:00")]);
    await turnOffOwnHours(v, christmas.id);
    expect(
      await db
        .select()
        .from(menuDayTimetables)
        .where(eq(menuDayTimetables.specialDateId, christmas.id)),
    ).toEqual([]);

    await turnOffOwnHours(v, boxingDay.id);
    await scoped((tx) =>
      deleteSpecialDate(tx, v.cfg, christmas.id, AT, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
    );
    expect(
      await db
        .select()
        .from(menuDayTimetables)
        .where(eq(menuDayTimetables.specialDateId, christmas.id)),
    ).toEqual([]);
    expect(
      (
        await db.execute(
          sql`select 1 from menu_slots s join menu_day_timetables t on t.id = s.timetable_id
            where t.special_date_id = ${christmas.id}`,
        )
      ).rows,
    ).toEqual([]);
    expect(await choice(v, v.sala, madrid(CHRISTMAS, "10:00"))).toEqual({
      defaultMenuId: v.menus.Desayunos,
      periodId: periods.mananas,
    });
    expect((await lineContexts()).rows).toEqual(recorded.rows);
  });

  it("moves business-day ranges independently of neighbours, checking skipped endpoints on the destination", async () => {
    const v = await timed();
    const { periods } = v;
    const sunday = await makeDate(v, "2026-12-13", { name: "Fiesta" });
    await dateMenus(v, sunday.id, [slot(periods.madrugada, "23:00", "02:00")]);
    const christmasEve = await makeDate(v, "2026-12-24", { name: "Nochebuena" });
    await dateMenus(v, christmasEve.id, [slot(periods.mananas, "01:00", "03:00")]);
    const move = (id: string, date: string, name: string) =>
      scoped((tx) =>
        saveSpecialDate(
          tx,
          v.cfg,
          id,
          dateInput(date, { name }),
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      );
    await move(sunday.id, "2026-12-23", "Fiesta");
    expect((await resolve(v, v.sala, madrid("2026-12-23", "23:30"))).periodId).toBe(
      periods.madrugada,
    );
    // Moving Nochebuena to the 26th leaves the 24th to the week, whose Thursday has no tail, but
    // puts its 01:00 slot after Christmas Friday's Madrugada.
    await move(christmasEve.id, "2026-12-26", "Nochebuena");
    expect(
      (
        await db
          .select({ date: specialDates.date })
          .from(specialDates)
          .where(eq(specialDates.id, christmasEve.id))
      )[0]!.date,
    ).toBe("2026-12-26");
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const skippedEnd = await makeDate(v, "2027-03-14", { name: "Marzo" });
    await dateMenus(v, skippedEnd.id, [
      slot(periods.mananas, "00:30", minutesAfter(forward.before, 16)),
    ]);
    await expect(move(skippedEnd.id, addDays(forward.date, -1), "Marzo")).rejects.toMatchObject(
      invalid("date", { date: addDays(forward.date, -1), departmentId: v.restaurant }),
    );

    await move(sunday.id, "2026-12-20", "Fiesta");
    expect((await resolve(v, v.sala, madrid("2026-12-20", "23:30"))).periodId).toBe(
      periods.madrugada,
    );
    expect((await resolve(v, v.sala, madrid("2026-12-13", "23:30"))).periodId).toBeNull();
  });

  it("moves a date away without constraining the next business day", async () => {
    const v = await timed();
    const { periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, []);
    const boxingDay = await makeDate(v, "2026-12-26", { name: "San Esteban" });
    await dateMenus(v, boxingDay.id, [slot(periods.mananas, "01:00", "03:00")]);
    await scoped((tx) =>
      saveSpecialDate(
        tx,
        v.cfg,
        christmas.id,
        dateInput("2026-12-31"),
        AT,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
    expect(
      (
        await db
          .select({ date: specialDates.date })
          .from(specialDates)
          .where(eq(specialDates.id, christmas.id))
      )[0]!.date,
    ).toBe("2026-12-31");
    // A date with no menu timetable moves freely.
    const plain = await makeDate(v, "2027-01-06", { name: "Reyes" });
    await scoped((tx) =>
      saveSpecialDate(
        tx,
        v.cfg,
        plain.id,
        dateInput("2027-01-07", { name: "Reyes" }),
        AT,
        VENUE_SERVICE_CALENDAR_PARTICIPANTS,
      ),
    );
  });
});

describe("the offers a zone lists at an instant", () => {
  it("marks the running period's default, falling back within its menus", async () => {
    const v = await timed();
    const at = madrid(MONDAY, "10:00");
    const offers = await scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { at }));
    expect(Object.keys(offers).sort()).toEqual(["defaultMenuId", "menus", "offers", "service"]);
    expect(offers.defaultMenuId).toBe(v.menus.Desayunos);
    expect(offers.menus.filter((menu) => menu.isDefault).map((menu) => menu.id)).toEqual([
      v.menus.Desayunos,
    ]);
    const without = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at, withDefault: false }),
    );
    expect(without.defaultMenuId).toBeNull();
    expect(without.menus.some((menu) => menu.isDefault)).toBe(false);
    expect(without.menus.map((menu) => menu.id)).toEqual(offers.menus.map((menu) => menu.id));

    const unpublished = await timed({ unpublished: ["Desayunos"] });
    await scoped((tx) =>
      updateMenuPeriod(tx, unpublished.cfg, unpublished.periods.mananas, {
        staffMenuIds: [unpublished.menus.Bebidas],
      }),
    );
    const fallback = await scoped((tx) =>
      listZoneOffers(tx, unpublished.cfg, unpublished.barra, { at }),
    );
    expect(fallback.defaultMenuId).toBe(unpublished.menus.Bebidas);
  });

  it("resolves the default among the menus a caller already found served", async () => {
    const v = await timed();
    const at = madrid(MONDAY, "10:00");
    const served = (ids: string[]) =>
      scoped((tx) => resolveDefaultMenu(tx, v.cfg, v.barra, at, ids));
    expect(await served([v.menus.Desayunos, v.menus.Café])).toBe(v.menus.Desayunos);
    expect(await served([v.menus.Bebidas, v.menus.Desayunos])).toBe(v.menus.Desayunos);
    expect(await served([])).toBeNull();
  });
});

describe("statements", () => {
  const sessionOf = (tx: Transaction) =>
    (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;
  const statementsOf = async <T>(fn: (tx: Transaction) => Promise<T>) =>
    scoped(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await fn(tx);
      const texts = prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      prepared.mockRestore();
      return texts;
    });

  it("moves a zone to its new department without accessing retired zone menu tables", async () => {
    const v = await timed();
    const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const statements = await statementsOf((tx) =>
      configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.deli }),
    );
    expect(statements.filter((text) => /"zone_(all_day|period)_menus"/.test(text))).toEqual([]);
    const moved = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(MONDAY, "13:00") }),
    );
    expect(moved.menus.map((menu) => ({ id: menu.id, orderable: menu.orderable }))).toEqual([
      { id: v.menus["Deli para llevar"], orderable: true },
    ]);
    expect(moved.defaultMenuId).toBe(v.menus["Deli para llevar"]);
    const after = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(after.departments.map((department) => ({ ...department, zones: [] }))).toEqual(
      before.departments.map((department) => ({ ...department, zones: [] })),
    );
    expect(before.departments.find((d) => d.id === v.restaurant)!.zones.map((z) => z.id)).toEqual([
      v.barra,
      v.sala,
      v.terraza,
    ]);
    expect(after.departments.find((d) => d.id === v.restaurant)!.zones.map((z) => z.id)).toEqual([
      v.sala,
      v.terraza,
    ]);
    expect(after.departments.find((d) => d.id === v.deli)!.zones.map((z) => z.id)).toEqual([
      v.barra,
      v.mostrador,
    ]);
    const unchanged = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.sala, { at: madrid(MONDAY, "13:00") }),
    );
    expect(unchanged.defaultMenuId).toBe(v.menus.Almuerzo);
  });

  /** Twenty one-hour slots over Sunday and Monday, alternating the five Restaurant periods. */
  const twentySlots = (p: Timed["periods"]) => {
    const ids = [p.mananas, p.mediodia, p.noches, p.madrugada, p.brunch];
    const hours = (from: number) =>
      Array.from({ length: 10 }, (_, index) => {
        const hour = String(from + index).padStart(2, "0");
        const next = String(from + index + 1).padStart(2, "0");
        return slot(ids[index % 5]!, `${hour}:00`, `${next}:00`);
      });
    return weekOf((weekday) => (weekday === 0 ? hours(1) : weekday === 1 ? hours(8) : []));
  };

  it("resolves service in the same number of statements however many slots and staff menus there are", async () => {
    const v = await timed();
    const at = madrid(MONDAY, "10:00");
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) => (weekday === 1 ? [slot(v.periods.mananas, "09:00", "12:00")] : [])),
        AT,
      ),
    );
    const few = await statementsOf((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, at));
    await scoped(async (tx) => {
      await replaceMenuWeek(tx, v.cfg, v.restaurant, twentySlots(v.periods), AT);
      await updateMenuPeriod(tx, v.cfg, v.periods.noches, {
        staffMenuIds: [v.menus.Café, v.menus.Cócteles, v.menus.Bebidas],
      });
    });
    const many = await statementsOf((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, at));
    expect(many).toHaveLength(few.length);
    const service = await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, at));
    expect(service.periodId).toBe(v.periods.noches);
    expect(service.orderableMenuIds).toEqual([
      v.menus.Cena,
      v.menus.Café,
      v.menus.Cócteles,
      v.menus.Bebidas,
    ]);
  });

  it("prices period menus without reading today's extension rows", async () => {
    const v = await timed();
    const statements = await statementsOf((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { withDefault: false }),
    );
    expect(statements.filter((text) => text.includes('"period_extensions"'))).toEqual([]);
    const control = await statementsOf((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(MONDAY, "13:00") }),
    );
    expect(control.some((text) => text.includes('"period_extensions"'))).toBe(true);
  });

  it("prices every period menu without reading ranges, dates or the venue clock", async () => {
    const plain = await timed();
    const busy = await timed();
    await scoped(async (tx) => {
      for (const v of [plain, busy])
        await updateMenuPeriod(tx, v.cfg, v.periods.mananas, { staffMenuIds: [v.menus.Bebidas] });
      await replaceMenuWeek(
        tx,
        plain.cfg,
        plain.restaurant,
        weekOf(() => []),
        AT,
      );
      await replaceMenuWeek(tx, busy.cfg, busy.restaurant, twentySlots(busy.periods), AT);
    });
    const read = (v: Timed) =>
      statementsOf((tx) =>
        listZoneOffers(tx, v.cfg, v.barra, { menuItemIds: [randomUUID()], withDefault: false }),
      );
    const none = await read(plain);
    const lots = await read(busy);
    const v = busy;
    expect(lots).toHaveLength(none.length);
    const runningPeriodReads = /"(menu_slots|menu_day_timetables|special_dates|locations)"/;
    expect(lots.filter((text) => runningPeriodReads.test(text))).toEqual([]);
    const priced = await scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { withDefault: false }));
    expect(priced.defaultMenuId).toBeNull();
    expect(priced.service).toEqual({ open: true, periodName: null, keepOpen: null });
    expect(priced.menus.map((menu) => menu.id).sort()).toEqual(
      [
        v.menus.Desayunos,
        v.menus.Almuerzo,
        v.menus.Cena,
        v.menus.Copas,
        v.menus["Brunch de Navidad"],
        v.menus.Bebidas,
      ].sort(),
    );
    expect(priced.menus.every((menu) => menu.orderable && !menu.isDefault)).toBe(true);
    const withDefault = await statementsOf((tx) => listZoneOffers(tx, v.cfg, v.barra));
    expect(withDefault.some((text) => runningPeriodReads.test(text))).toBe(true);
  });
});

describe("the editor's model", () => {
  it("lists a venue with no periods, and every department's empty week", async () => {
    const v = await venue({ timetable: false });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    for (const department of model.departments) {
      expect(department.periods).toEqual([]);
      expect(department.week).toEqual(weekOf(() => []));
    }
  });

  it("names every menu with whether it is active, for a venue viewer who cannot read the menus", async () => {
    const v = await venue({ timetable: false });
    await scoped((tx) =>
      tx.update(catalogues).set({ active: false }).where(eq(catalogues.id, v.menus.Cena)),
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.menus.map((menu) => menu.name).sort()).toEqual(Object.keys(v.menus).sort());
    expect(model.menus.find((menu) => menu.id === v.menus.Cena)).toEqual({
      id: v.menus.Cena,
      name: "Cena",
      active: false,
      includes: [],
    });
    expect(model.menus.filter((menu) => !menu.active)).toHaveLength(1);
  });

  it("lists every department, its periods with their days, its week and its special-date ranges", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await deactivateDepartment(tx, v.cfg, v.deli);
    });
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const yesterday = await makeDate(v, "2026-10-06", { name: "Ayer" });
    const earlier = await makeDate(v, "2026-10-05", { name: "Anteayer" });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));

    expect(model.dayCutover).toBe("06:00");
    expect(model.departments.map((department) => department.id)).toEqual(
      (await scoped((tx) => listDepartments(tx, v.cfg))).map((department) => department.id),
    );
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    const weekdays = (...days: number[]) => days;
    expect(restaurant).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      active: true,
      zones: [
        {
          id: v.barra,
          name: "Barra",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
        {
          id: v.sala,
          name: "Sala",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
        {
          id: v.terraza,
          name: "Terraza",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
      ],
      periods: [
        {
          id: periods.brunch,
          name: "Brunch navideño",
          menuId: menus["Brunch de Navidad"],
          colour: "green",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [],
        },
        {
          id: periods.madrugada,
          name: "Madrugada",
          menuId: menus.Copas,
          colour: "blue",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(5),
        },
        {
          id: periods.mananas,
          name: "Mañanas",
          menuId: menus.Desayunos,
          colour: "red",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(1, 2, 3, 4, 5),
        },
        {
          id: periods.mediodia,
          name: "Mediodía",
          menuId: menus.Almuerzo,
          colour: "amber",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(0, 1, 2, 3, 4, 5, 6),
        },
        {
          id: periods.noches,
          name: "Noches",
          menuId: menus.Cena,
          colour: "grey",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(1, 2, 3, 4, 5),
        },
      ],
      week: restaurantWeek(periods),
      dates: [{ specialDateId: christmas.id, slots: [slot(periods.brunch, "11:00", "15:00")] }],
    });
    const deli = model.departments.find((department) => department.id === v.deli)!;
    expect(deli).toMatchObject({
      active: false,
      periods: [{ id: periods.mediodiaDeli }],
    });
    expect(model.specialDates).toEqual([
      {
        kind: "working_day",
        repeats: false,
        ownHours: true,
        id: yesterday.id,
        date: "2026-10-06",
        name: "Ayer",
        colour: "blue",
        closeWholeVenue: false,
      },
      {
        kind: "working_day",
        repeats: false,
        ownHours: true,
        id: christmas.id,
        date: CHRISTMAS,
        name: "Navidad",
        colour: "blue",
        closeWholeVenue: false,
      },
    ]);

    await scoped(async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
    });
    const unreadable = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(unreadable.specialDates.map((date) => date.id)).toEqual([
      earlier.id,
      yesterday.id,
      christmas.id,
    ]);
  });
});

describe("a duplicate onto neighbouring days in one request", () => {
  /** Friday has no late slot and Saturday has Mañanas 01:00–03:00; Wednesday 2 December 2026
   * holds Madrugada 22:00–02:00. */
  async function arranged() {
    const v = await timed();
    const { periods } = v;
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 5
            ? [slot(periods.mananas, "09:00", "12:00")]
            : weekday === 6
              ? [slot(periods.mananas, "01:00", "03:00"), slot(periods.mediodia, "13:00", "17:00")]
              : null,
        ),
        AT,
      ),
    );
    const source = await makeDate(v, "2026-12-02");
    await dateMenus(v, source.id, [slot(periods.madrugada, "22:00", "02:00")]);
    const duplicate = (dates: string[]) =>
      scoped((tx) =>
        duplicateHolidayNamedSpecialDates(
          tx,
          v.cfg,
          source.id,
          dates,
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      );
    return { v, duplicate };
  }

  it("checks each copy beside the others, not beside the week they replace", async () => {
    const { v, duplicate } = await arranged();
    await duplicate(["2026-12-04", "2026-12-05"]);
    // Friday's copy runs into Saturday's copy, which has no 01:00 slot.
    expect(await choice(v, v.sala, madrid("2026-12-05", "01:00"))).toEqual({
      defaultMenuId: v.menus.Copas,
      periodId: v.periods.madrugada,
    });
    expect((await resolve(v, v.sala, madrid("2026-12-05", "23:00"))).periodId).toBe(
      v.periods.madrugada,
    );
  });

  it("copies beside a day that keeps its own business-day week", async () => {
    const { v, duplicate } = await arranged();
    await duplicate(["2026-12-10", "2026-12-11"]);
    const stored = await db
      .select({ date: specialDates.date })
      .from(specialDates)
      .where(eq(specialDates.locationId, v.locationId));
    expect(stored.map((row) => row.date)).toEqual(["2026-12-02", "2026-12-10", "2026-12-11"]);
  });
});

describe("why a calendar change is refused", () => {
  const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
  const skipped = minutesAfter(forward.before, 16);
  const refused = (v: Venue, date: string, reason: string) => ({
    code: "menu_timetable.invalid",
    params: { field: "date", date, departmentId: v.restaurant, reason },
  });

  it("names a skipped business-day endpoint on copies and moves", async () => {
    const v = await timed();
    const march = await makeDate(v, "2027-03-14", { name: "Marzo" });
    await dateMenus(v, march.id, [slot(v.periods.mananas, "00:30", skipped)]);
    const target = addDays(forward.date, -1);
    await expect(
      scoped((tx) =>
        duplicateHolidayNamedSpecialDates(
          tx,
          v.cfg,
          march.id,
          [target],
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(refused(v, target, "clock_skips"));
    await expect(
      scoped((tx) =>
        saveSpecialDate(
          tx,
          v.cfg,
          march.id,
          dateInput(target, { name: "Marzo" }),
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(refused(v, target, "clock_skips"));
    expect(
      (
        await db
          .select({ date: specialDates.date })
          .from(specialDates)
          .where(eq(specialDates.locationId, v.locationId))
      ).map((row) => row.date),
    ).toEqual(["2027-03-14"]);
  });
});

describe("the venue's clock", () => {
  const clockReads = async (fn: (tx: Transaction) => Promise<unknown>) =>
    scoped(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      await fn(tx);
      const reads = prepared.mock.calls.filter(([query]) =>
        /from "locations"/.test((query as unknown as { sql: string }).sql),
      ).length;
      prepared.mockRestore();
      return reads;
    });

  it("is read once when ranges need it and never for deleting ranges", async () => {
    const v = await timed();
    const { periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    const at = (slots: MenuSlot[]) => (tx: Transaction) =>
      saveSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, slots, AT);
    expect(await clockReads(at([slot(periods.brunch, "11:00", "15:00")]))).toBe(1);
    await scoped((tx) =>
      saveSpecialDateMenus(
        tx,
        v.cfg,
        christmas.id,
        v.deli,
        [slot(periods.mediodiaDeli, "12:00", "15:00")],
        AT,
      ),
    );
    const participant = MENU_TIMETABLE_CALENDAR_PARTICIPANT;
    expect(
      await clockReads((tx) => participant.beforeMove!(tx, v.cfg, christmas.id, "2026-12-30", AT)),
    ).toBe(1);
    expect(await clockReads((tx) => participant.beforeDelete(tx, v.cfg, christmas.id, AT))).toBe(0);
    const target = await makeDate(v, "2026-12-31", { name: "Nochevieja" });
    expect(
      await clockReads(async (tx) => {
        await participant.copy(tx, v.cfg, christmas.id, target.id, AT);
        await participant.afterCopies!(
          tx,
          v.cfg,
          christmas.id,
          [{ id: target.id, date: "2026-12-31" }],
          AT,
        );
      }),
    ).toBe(1);
    expect(
      await clockReads((tx) =>
        replaceMenuWeek(tx, v.cfg, v.restaurant, restaurantWeek(periods), AT),
      ),
    ).toBe(1);
  });
});

describe("the editor's model of two venues", () => {
  it("lists only this venue's special dates", async () => {
    const v = await timed();
    const other = await timed();
    const ours = await makeDate(v, CHRISTMAS);
    const theirs = await makeDate(other, "2026-12-24", { name: "Nochebuena" });
    const theirPast = await makeDate(other, "2025-12-25");
    await dateMenus(other, theirs.id, []);
    await scoped((tx) =>
      saveSpecialDateMenus(tx, other.cfg, theirPast.id, other.restaurant, [], AT),
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.specialDates).toEqual([
      {
        kind: "working_day",
        repeats: false,
        ownHours: true,
        id: ours.id,
        date: CHRISTMAS,
        name: "Navidad",
        colour: "blue",
        closeWholeVenue: false,
      },
    ]);
  });
});

describe("department service periods", () => {
  const FRIDAY = "2026-10-16";
  const serviceVenue = async () => {
    const v = await venue({ timetable: false });
    await db
      .update(locations)
      .set({ dayCutover: "06:00:00" })
      .where(eq(locations.id, v.locationId));
    return scoped(async (tx) => {
      const lunch = (
        await saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: "Lunch",
          colour: "blue",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [v.menus.Bebidas, v.menus.Café],
        })
      ).id;
      const afternoon = (
        await saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: "Afternoon",
          colour: "amber",
          menuId: v.menus.Café,
          staffMenuIds: [],
        })
      ).id;
      const night = (
        await saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: "Night",
          colour: "grey",
          menuId: v.menus.Cena,
          staffMenuIds: [],
        })
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) =>
          weekday === 5
            ? [
                slot(lunch, "12:00", "14:00"),
                slot(afternoon, "14:00", "19:00"),
                slot(night, "21:00", "03:00"),
              ]
            : [],
        ),
        AT,
      );
      return { ...v, lunch, afternoon, night };
    });
  };
  type ServiceVenue = Awaited<ReturnType<typeof serviceVenue>>;
  const read = (v: ServiceVenue, date: string, time: string) =>
    scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, madrid(date, time)));

  const extend = (
    v: ServiceVenue,
    periodId: string,
    startsAt: string,
    endsAt: string,
    businessDay = FRIDAY,
  ) =>
    scoped((tx) =>
      tx
        .insert(periodExtensions)
        .values({ departmentId: v.restaurant, businessDay, periodId, startsAt, endsAt }),
    );

  it("keeps Lunch running and delays Afternoon until the stored extension ends", async () => {
    const v = await serviceVenue();
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.lunch, { staffMenuIds: [v.menus.Bebidas] }));
    await extend(v, v.lunch, "14:00:00", "14:30:00");
    expect(await read(v, FRIDAY, "14:15")).toMatchObject({
      periodId: v.lunch,
      orderableMenuIds: [v.menus.Almuerzo, v.menus.Bebidas],
      endedMenuIds: [],
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:30",
        running: true,
        extendedUntil: "14:30",
      },
    });
    expect(await read(v, FRIDAY, "14:30")).toMatchObject({
      periodId: v.afternoon,
      orderableMenuIds: [v.menus.Café],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas],
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: true,
        extendedUntil: null,
      },
    });
    expect(await read(v, FRIDAY, "13:50")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:30",
        running: true,
        extendedUntil: "14:30",
      },
    });
  });

  it("never marks a wholly displaced period's menus ended", async () => {
    const v = await serviceVenue();
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.lunch, { staffMenuIds: [v.menus.Bebidas] }));
    await extend(v, v.lunch, "14:00:00", "20:00:00");
    expect(await read(v, FRIDAY, "20:10")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas],
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "20:00",
        running: false,
        extendedUntil: "20:00",
      },
    });
  });

  it("runs the overnight extension until changeover and ignores yesterday's row afterwards", async () => {
    const v = await serviceVenue();
    await extend(v, v.night, "03:00:00", "06:00:00");
    expect(await read(v, SATURDAY, "05:59")).toMatchObject({
      open: true,
      periodId: v.night,
      keepOpen: {
        periodId: v.night,
        periodName: "Night",
        endsAt: "06:00",
        running: true,
        extendedUntil: "06:00",
      },
    });
    expect(await read(v, SATURDAY, "06:00")).toMatchObject({
      open: false,
      periodId: null,
      keepOpen: null,
    });
    expect(await read(v, "2026-10-18", "05:59")).toMatchObject({
      open: false,
      periodId: null,
      orderableMenuIds: [],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café, v.menus.Cena],
      keepOpen: null,
    });
  });

  it("offers the running merged run or the run that ended last today", async () => {
    const v = await serviceVenue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) =>
          weekday === 5
            ? [
                slot(v.lunch, "12:00", "13:00"),
                slot(v.lunch, "13:00", "14:00"),
                slot(v.lunch, "18:00", "19:00"),
              ]
            : [],
        ),
        AT,
      ),
    );
    expect(await read(v, FRIDAY, "11:59")).toMatchObject({ keepOpen: null });
    expect(await read(v, FRIDAY, "13:50")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
      },
    });
    expect(await read(v, FRIDAY, "15:10")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: false,
        extendedUntil: null,
      },
    });
    expect(await read(v, FRIDAY, "18:30")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "19:00",
        running: true,
        extendedUntil: null,
      },
    });
  });

  it("does not offer keep-open when the venue clock cannot be read", async () => {
    const v = await serviceVenue();
    await extend(v, v.lunch, "14:00:00", "14:30:00");
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.locationId));
    expect(await read(v, FRIDAY, "14:15")).toMatchObject({ open: true });
  });

  it("keeps all period menus once while marking the running customer and staff menus orderable", async () => {
    const v = await serviceVenue();
    await timed();
    const result = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "13:59") }),
    );
    expect(result.service).toEqual({
      open: true,
      periodName: "Lunch",
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
      },
    });
    expect(result.defaultMenuId).toBe(v.menus.Almuerzo);
    expect(
      result.menus
        .map(({ id, audience, orderable, isDefault }) => ({
          id,
          audience,
          orderable,
          isDefault,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [
        { id: v.menus.Almuerzo, audience: "customer", orderable: true, isDefault: true },
        { id: v.menus.Bebidas, audience: "staff", orderable: true, isDefault: false },
        { id: v.menus.Café, audience: "staff", orderable: true, isDefault: false },
        { id: v.menus.Cena, audience: "customer", orderable: false, isDefault: false },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const afternoon = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "14:00") }),
    );
    expect(afternoon.service).toEqual({
      open: true,
      periodName: "Afternoon",
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: true,
        extendedUntil: null,
      },
    });
    expect(afternoon.menus.find((menu) => menu.id === v.menus.Café)).toMatchObject({
      audience: "customer",
      orderable: true,
      isDefault: true,
    });
    expect(afternoon.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      v.menus.Café,
    ]);
  });

  it("falls back only to a served menu of the running period when its customer menu is unpublished", async () => {
    const v = await timed({ unpublished: ["Desayunos"] });
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mananas, { staffMenuIds: [v.menus.Bebidas] }),
    );
    const result = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(MONDAY, "10:00") }),
    );
    expect(result.defaultMenuId).toBe(v.menus.Bebidas);
    expect(result.menus.filter((menu) => menu.isDefault).map((menu) => menu.id)).toEqual([
      v.menus.Bebidas,
    ]);
    expect(result.menus.find((menu) => menu.id === v.menus.Almuerzo)).toMatchObject({
      isDefault: false,
      orderable: false,
    });
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.mananas, { staffMenuIds: [] }));
    const unserved = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(MONDAY, "10:00") }),
    );
    expect(unserved.service.open).toBe(true);
    expect(unserved.defaultMenuId).toBeNull();
    expect(unserved.menus).toHaveLength(4);
    expect(unserved.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });

  it("refuses an asserted menu version outside the period membership while retaining closed-period versions", async () => {
    const v = await serviceVenue();
    const running = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "13:59") }),
    );
    const lunch = running.menus.find((menu) => menu.id === v.menus.Almuerzo)!;
    const asserted = [{ menuId: lunch.id, versionId: lunch.versionId }];
    const closed = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, {
        at: madrid(FRIDAY, "20:00"),
        asserted,
        withDefault: false,
      }),
    );
    expect(closed.menus.find((menu) => menu.id === lunch.id)).toMatchObject({
      versionId: lunch.versionId,
      orderable: true,
    });
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.lunch, {
        menuId: v.menus.Café,
        staffMenuIds: [v.menus.Bebidas],
      }),
    );
    await expect(
      scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { asserted, withDefault: false })),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
    });
  });

  it("offers no department-list menus without periods and refuses a different venue's zone", async () => {
    const v = await venue({ timetable: false });
    const result = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "13:59") }),
    );
    expect(result).toEqual({
      defaultMenuId: null,
      service: { open: false, periodName: null, keepOpen: null },
      menus: [],
      offers: [],
    });
    const other = await serviceVenue();
    await expect(scoped((tx) => listZoneOffers(tx, v.cfg, other.barra))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: other.barra },
    });
  });

  it("keeps period menus for a stored basket when closed, with none orderable and no default", async () => {
    const v = await serviceVenue();
    const result = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "20:00") }),
    );
    expect(result.service).toEqual({
      open: false,
      periodName: null,
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: false,
        extendedUntil: null,
      },
    });
    expect(result.defaultMenuId).toBeNull();
    expect(result.menus.map((menu) => menu.id).sort()).toEqual(
      [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café, v.menus.Cena].sort(),
    );
    expect(result.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });

  it("marks every period menu orderable when the venue clock cannot be read", async () => {
    const v = await serviceVenue();
    await db
      .update(locations)
      .set({ timeZone: "Unreadable/Clock" })
      .where(eq(locations.id, v.locationId));
    const result = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at: madrid(FRIDAY, "20:00") }),
    );
    expect(result.service).toEqual({ open: true, periodName: null, keepOpen: null });
    expect(result.menus).toHaveLength(4);
    expect(result.menus.every((menu) => menu.orderable)).toBe(true);
    expect(result.defaultMenuId).toBeNull();
  });

  it("reports active departments with no normal-week range even if they have period menus", async () => {
    const v = await serviceVenue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
      ),
    );
    const issues = await scoped((tx) => listVenueReadiness(tx, v.cfg));
    expect(issues.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.deli, departmentName: "Deli" },
      { code: "department.no_periods", departmentId: v.restaurant, departmentName: "Restaurant" },
    ]);
    expect(issues.some((issue) => (issue.code as string) === "zone.menu_missing")).toBe(false);
    await scoped((tx) => deactivateDepartment(tx, v.cfg, v.deli));
    const after = await scoped((tx) => listVenueReadiness(tx, v.cfg));
    expect(after.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.restaurant, departmentName: "Restaurant" },
    ]);
  });

  it("readiness judges distinct published period menus and ignores the retired department list", async () => {
    const v = await serviceVenue();
    const issues = await scoped((tx) => listVenueReadiness(tx, v.cfg));
    expect(issues.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.deli, departmentName: "Deli" },
    ]);
    const bar = issues.filter((issue) => "zoneId" in issue && issue.zoneId === v.barra);
    expect(bar).toHaveLength(4);
    expect(bar.every((issue) => issue.code === "zone.menu_empty")).toBe(true);
    expect(
      bar.flatMap((issue) => (issue.code === "zone.menu_empty" ? [issue.menuId] : [])).sort(),
    ).toEqual([v.menus.Almuerzo, v.menus.Café, v.menus.Cena, v.menus.Bebidas].sort());
  });

  it("reads opening hours with period colours, ordered staff menus, all seven days and explicit closed dates", async () => {
    const v = await serviceVenue();
    const other = await venue({ timetable: false });
    const date = await makeDate(v, FRIDAY);
    await scoped((tx) => saveSpecialDateMenus(tx, v.cfg, date.id, v.restaurant, [], AT));
    await db.update(specialDates).set({ colour: "red" }).where(eq(specialDates.id, date.id));
    await db.update(menuPeriods).set({ colour: "blue" }).where(eq(menuPeriods.id, v.lunch));
    await scoped((tx) => deactivateDepartment(tx, v.cfg, v.deli));
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.dayCutover).toBe("06:00");
    expect(model.departments.map((department) => department.id)).toEqual([v.deli, v.restaurant]);
    expect(
      model.departments.find((department) => department.id === other.restaurant),
    ).toBeUndefined();
    expect(model.departments.find((department) => department.id === v.restaurant)).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      active: true,
      zones: [
        {
          id: v.barra,
          name: "Barra",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
        {
          id: v.sala,
          name: "Sala",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
        {
          id: v.terraza,
          name: "Terraza",
          week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          dates: [],
        },
      ],
      periods: [
        {
          id: v.afternoon,
          name: "Afternoon",
          colour: "amber",
          menuId: v.menus.Café,
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [5],
        },
        {
          id: v.lunch,
          name: "Lunch",
          colour: "blue",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [v.menus.Bebidas, v.menus.Café],
          endOffsetMinutes: 0,
          weekdays: [5],
        },
        {
          id: v.night,
          name: "Night",
          colour: "grey",
          menuId: v.menus.Cena,
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [5],
        },
      ],
      week: weekOf((weekday) =>
        weekday === 5
          ? [
              slot(v.lunch, "12:00", "14:00"),
              slot(v.afternoon, "14:00", "19:00"),
              slot(v.night, "21:00", "03:00"),
            ]
          : [],
      ),
      dates: [{ specialDateId: date.id, slots: [] }],
    });
    expect(model.departments.find((department) => department.id === v.deli)).toEqual({
      id: v.deli,
      name: "Deli",
      active: false,
      zones: [],
      periods: [],
      week: weekOf(() => []),
      dates: [],
    });
    expect(model.specialDates).toEqual([
      {
        kind: "working_day",
        repeats: false,
        ownHours: true,
        id: date.id,
        date: FRIDAY,
        name: "Navidad",
        colour: "red",
        closeWholeVenue: false,
      },
    ]);
  });

  it("retains past dates with timetables and omits unused older dates when the clock is readable", async () => {
    const v = await serviceVenue();
    const used = await makeDate(v, "2026-10-04");
    const unused = await makeDate(v, "2026-10-05");
    const yesterday = await makeDate(v, "2026-10-06");
    await scoped((tx) => saveSpecialDateMenus(tx, v.cfg, used.id, v.restaurant, [], AT));
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).specialDates.map(
        (date) => date.id,
      ),
    ).toEqual([used.id, yesterday.id]);
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.locationId));
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).specialDates.map(
        (date) => date.id,
      ),
    ).toEqual([used.id, unused.id, yesterday.id]);
  });

  it("gives the opening-hours editor the venue clock for special-date notes", async () => {
    const v = await serviceVenue();
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model).toMatchObject({ timeZone: "Europe/Madrid", clockReadable: true });
    await db
      .update(locations)
      .set({ timeZone: "unreadable" })
      .where(eq(locations.id, v.cfg.locationId));
    expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toMatchObject({
      timeZone: "unreadable",
      clockReadable: false,
    });
  });

  it("names direct menu inclusions without treating nested inclusions as direct", async () => {
    const v = await serviceVenue();
    await scoped(async (tx) => {
      const lunch = await requireMenuRoot(tx, v.menus.Almuerzo);
      const drinks = await requireMenuRoot(tx, v.menus.Bebidas);
      const coffee = await requireMenuRoot(tx, v.menus.Café);
      await addMember(tx, lunch, { kind: "section", sectionId: drinks });
      await addMember(tx, drinks, { kind: "section", sectionId: coffee });
    });
    await db.update(catalogues).set({ active: false }).where(eq(catalogues.id, v.menus.Cena));
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.menus.find((menu) => menu.id === v.menus.Almuerzo)).toEqual({
      id: v.menus.Almuerzo,
      name: "Almuerzo",
      active: true,
      includes: ["Bebidas"],
    });
    expect(model.menus.find((menu) => menu.id === v.menus.Bebidas)?.includes).toEqual(["Café"]);
    expect(model.menus.find((menu) => menu.id === v.menus.Cena)).toEqual({
      id: v.menus.Cena,
      name: "Cena",
      active: false,
      includes: [],
    });
  });

  it.each([
    [-15, "13:44", true, true],
    [-15, "13:45", false, false],
    [0, "13:59", true, true],
    [0, "14:00", false, false],
    [15, "13:59", true, true],
    [15, "14:00", false, true],
    [15, "14:14", false, true],
    [15, "14:15", false, false],
    [15, "11:59", false, false],
  ] as const)(
    "end-offset %s at %s separates selection %s from sending %s",
    async (offset, time, select, send) => {
      const v = await serviceVenue();
      await scoped(async (tx) => {
        await replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((day) => (day === 5 ? [slot(v.lunch, "12:00", "14:00")] : [])),
          AT,
        );
        await updateMenuPeriod(tx, v.cfg, v.lunch, { endOffsetMinutes: offset });
      });
      const service = await read(v, FRIDAY, time);
      const menus = [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café];
      expect(service.orderableMenuIds).toEqual(select ? menus : []);
      expect(service).toMatchObject({ sendableMenuIds: send ? menus : [] });
      expect(service.open).toBe(time >= "12:00" && time < "14:00");
    },
  );

  it("end-offset grace survives changeover into a whole-venue closed day then expires", async () => {
    const v = await serviceVenue();
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((day) => (day === 5 ? [slot(v.night, "21:00", "06:00")] : [])),
        AT,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: 15 });
    });
    await makeDate(v, SATURDAY, { closeWholeVenue: true });
    expect(await read(v, SATURDAY, "06:14")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [v.menus.Cena],
    });
    expect(await read(v, SATURDAY, "06:15")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
    });
  });

  it("end-offset unions a shared staff menu without reviving its ended selling root", async () => {
    const v = await serviceVenue();
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.lunch, { endOffsetMinutes: -15 }));
    expect(await read(v, FRIDAY, "13:45")).toMatchObject({
      open: true,
      periodName: "Lunch",
      orderableMenuIds: [],
      sendableMenuIds: [],
    });
    expect(await read(v, FRIDAY, "14:00")).toMatchObject({
      orderableMenuIds: [v.menus.Café],
      sendableMenuIds: [v.menus.Café],
    });
  });

  it("end-offset uses the same repeated wall minute and crosses a skipped cutoff", async () => {
    const v = await serviceVenue();
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((day) => (day === 6 ? [slot(v.night, "21:00", "03:00")] : [])),
        AT,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: -30 });
    });
    const repeated = localTimeOccurrences("2026-10-25", "02:20", ZONE);
    expect(repeated).toHaveLength(2);
    for (const instant of repeated) {
      expect(
        await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, instant)),
      ).toMatchObject({ orderableMenuIds: [v.menus.Cena], sendableMenuIds: [v.menus.Cena] });
    }
    expect(await read(v, "2026-10-25", "02:30")).toMatchObject({
      open: true,
      orderableMenuIds: [],
      sendableMenuIds: [],
    });
    // The placement endpoint exists; its last-order cutoff is the skipped minute.
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((day) => (day === 6 ? [slot(v.night, "21:00", "04:00")] : [])),
        AT,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: -90 });
    });
    expect(await read(v, "2027-03-28", "01:59")).toMatchObject({
      orderableMenuIds: [v.menus.Cena],
      sendableMenuIds: [v.menus.Cena],
    });
    expect(await read(v, "2027-03-28", "03:00")).toMatchObject({
      open: true,
      orderableMenuIds: [],
      sendableMenuIds: [],
    });
  });

  it("orders the current customer and staff menus and switches at the exact boundary", async () => {
    const v = await serviceVenue();
    expect(await read(v, FRIDAY, "13:59")).toEqual({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: true,
        extendedUntil: null,
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.lunch,
      periodName: "Lunch",
      customerMenuId: v.menus.Almuerzo,
      orderableMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café],
      sendableMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café],
      endedMenuIds: [],
    });
    expect(await read(v, FRIDAY, "14:00")).toEqual({
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: true,
        extendedUntil: null,
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.afternoon,
      periodName: "Afternoon",
      customerMenuId: v.menus.Café,
      orderableMenuIds: [v.menus.Café],
      sendableMenuIds: [v.menus.Café],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas],
    });
  });

  it("uses Friday's overnight period on Saturday morning until its exclusive end", async () => {
    const v = await serviceVenue();
    expect(await read(v, SATURDAY, "02:30")).toEqual({
      keepOpen: {
        periodId: v.night,
        periodName: "Night",
        endsAt: "03:00",
        running: true,
        extendedUntil: null,
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.night,
      periodName: "Night",
      customerMenuId: v.menus.Cena,
      orderableMenuIds: [v.menus.Cena],
      sendableMenuIds: [v.menus.Cena],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café],
    });
    expect(await read(v, SATURDAY, "03:00")).toEqual({
      keepOpen: {
        periodId: v.night,
        periodName: "Night",
        endsAt: "03:00",
        running: false,
        extendedUntil: null,
      },
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café, v.menus.Cena],
    });
    expect(await read(v, SATURDAY, "06:10")).toEqual({
      keepOpen: null,
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café, v.menus.Cena],
    });
  });

  it("closes in a gap and forgets menus older than the preceding business day", async () => {
    const v = await serviceVenue();
    expect(await read(v, FRIDAY, "20:00")).toEqual({
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: false,
        extendedUntil: null,
      },
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café],
    });
    expect(await read(v, "2026-10-18", "06:10")).toEqual({
      keepOpen: null,
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
  });

  it("replaces the business day's week with special-date ranges, including its next morning", async () => {
    const v = await serviceVenue();
    const date = await makeDate(v, FRIDAY);
    await scoped((tx) =>
      saveSpecialDateMenus(tx, v.cfg, date.id, v.restaurant, [slot(v.lunch, "13:00", "03:00")], AT),
    );
    expect(await read(v, FRIDAY, "12:30")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    expect(await read(v, FRIDAY, "15:00")).toMatchObject({
      open: true,
      periodId: v.lunch,
      orderableMenuIds: [v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café],
    });
    expect(await read(v, SATURDAY, "02:30")).toMatchObject({ open: true, periodId: v.lunch });
    expect((await read(v, SATURDAY, "06:10")).endedMenuIds).toEqual([
      v.menus.Almuerzo,
      v.menus.Bebidas,
      v.menus.Café,
    ]);
  });

  it("distinguishes an empty special-date row from following the normal week", async () => {
    const v = await serviceVenue();
    const date = await makeDate(v, FRIDAY);
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: true, periodId: v.lunch });
    await scoped((tx) => saveSpecialDateMenus(tx, v.cfg, date.id, v.restaurant, [], AT));
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    await turnOffOwnHours(v, date.id);
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: true, periodId: v.lunch });
  });

  it("a whole-venue closure overrides both special-date ranges and the week", async () => {
    const v = await serviceVenue();
    const date = await makeDate(v, FRIDAY);
    await scoped((tx) =>
      saveSpecialDateMenus(tx, v.cfg, date.id, v.restaurant, [slot(v.lunch, "12:00", "16:00")], AT),
    );
    await db
      .update(specialDates)
      .set({ closeWholeVenue: true })
      .where(eq(specialDates.id, date.id));
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    await turnOffOwnHours(v, date.id);
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: false, orderableMenuIds: [] });
    expect((await read(v, SATURDAY, "06:10")).endedMenuIds).toEqual([]);
  });

  it("fails open with each distinct period menu when the clock cannot be read", async () => {
    const v = await serviceVenue();
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.locationId));
    const service = await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, AT));
    expect(service).toMatchObject({
      departmentId: v.restaurant,
      open: true,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      endedMenuIds: [],
    });
    expect(new Set(service.orderableMenuIds)).toEqual(
      new Set([v.menus.Almuerzo, v.menus.Bebidas, v.menus.Café, v.menus.Cena]),
    );
    expect(service.orderableMenuIds).toHaveLength(4);
  });

  it("reports an empty department closed and refuses a different venue's department", async () => {
    const v = await serviceVenue();
    expect(await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.deli, AT))).toEqual({
      keepOpen: null,
      departmentId: v.deli,
      open: false,
      periodId: null,
      periodName: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    const other = await venue({ timetable: false });
    await expect(
      scoped((tx) => resolveDepartmentService(tx, other.cfg, v.restaurant, AT)),
    ).rejects.toMatchObject({ code: "department.not_found" });
  });
});

describe("period end-offset placement bounds", () => {
  it.each([
    { offset: 15, next: "14:15", end: "14:00" },
    { offset: 1, next: "14:00", end: "14:00" },
    { offset: -120, next: "14:15", end: "14:00" },
  ])(
    "refuses offset $offset without changing period or staff rows",
    async ({ offset, next, end }) => {
      const v = await timed();
      await scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf(() => [
            slot(v.periods.mediodia, "12:00", end),
            slot(v.periods.noches, next, "18:00"),
          ]),
          AT,
        ),
      );
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      await expect(
        scoped((tx) =>
          updateMenuPeriod(tx, v.cfg, v.periods.mediodia, {
            endOffsetMinutes: offset,
            staffMenuIds: [v.menus.Café],
          }),
        ),
      ).rejects.toMatchObject({
        code: "menu_period.invalid",
        params: {
          field: "endOffsetMinutes",
          reason: "placement",
          periodId: v.periods.mediodia,
          departmentId: v.restaurant,
          weekday: 0,
        },
      });
      expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
    },
  );

  it("accepts exclusive positive and negative bounds and an unplaced period", async () => {
    const v = await timed();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [
          slot(v.periods.mediodia, "12:00", "14:00"),
          slot(v.periods.noches, "14:15", "18:00"),
        ]),
        AT,
      ),
    );
    for (const offset of [14, -119, 0]) {
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: offset }),
      );
      const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      expect(
        model.departments
          .find((d) => d.id === v.restaurant)!
          .periods.find((p) => p.id === v.periods.mediodia)!.endOffsetMinutes,
      ).toBe(offset);
    }
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.brunch, { endOffsetMinutes: 1439 }));
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).departments
        .find((d) => d.id === v.restaurant)!
        .periods.find((p) => p.id === v.periods.brunch)!.endOffsetMinutes,
    ).toBe(1439);
  });

  it("checks a shorter repeated placement, rejecting the entire replacement week", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: -119 }),
    );
    const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((w) =>
            w === 2
              ? [
                  slot(v.periods.mediodia, "12:00", "14:00"),
                  slot(v.periods.mediodia, "16:00", "17:00"),
                ]
              : [],
          ),
          AT,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "days.2.slots", reason: "end_offset", periodId: v.periods.mediodia },
    });
    expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
  });

  it.each([5, 0])(
    "bounds grace against the following business day after weekday %s",
    async (weekday) => {
      const v = await timed();
      await scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((w) =>
            w === weekday
              ? [slot(v.periods.madrugada, "21:00", "03:00")]
              : w === (weekday + 1) % 7
                ? [slot(v.periods.mananas, "06:00", "09:00")]
                : [],
          ),
          AT,
        ),
      );
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 179 }),
      );
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      await expect(
        scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 180 })),
      ).rejects.toMatchObject({
        code: "menu_period.invalid",
        params: { field: "endOffsetMinutes", reason: "placement", weekday },
      });
      expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
    },
  );

  it("checks past dated overrides and keeps departments independent", async () => {
    const v = await timed();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
      ),
    );
    const past = await makeDate(v, "2026-01-01");
    await dateMenus(v, past.id, [
      slot(v.periods.mediodia, "12:00", "14:00"),
      slot(v.periods.noches, "14:15", "18:00"),
    ]);
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 14 }));
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 15 })),
    ).rejects.toMatchObject({
      code: "menu_period.invalid",
      params: { field: "endOffsetMinutes", reason: "placement", date: "2026-01-01" },
    });
    await turnOffOwnHours(v, past.id);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [slot(v.periods.mediodia, "12:00", "14:00")]),
        AT,
      ),
    );
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 180 }),
    );
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).departments
        .find((d) => d.id === v.restaurant)!
        .periods.find((p) => p.id === v.periods.mediodia)!.endOffsetMinutes,
    ).toBe(180);
  });
});

describe("calendar end-offset revalidation", () => {
  async function offsetVenue() {
    const v = await timed();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [
          slot(v.periods.mananas, "09:00", "12:00"),
          slot(v.periods.madrugada, "21:00", "06:00"),
        ]),
        AT,
      ),
    );
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 120 }),
    );
    return v;
  }
  it.each(["reopen", "move"])(
    "refuses calendar %s of an earlier first period",
    async (operation) => {
      const v = await offsetVenue();
      const closed = await makeDate(v, SATURDAY, { closeWholeVenue: true });
      await db.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, closed.id));
      await dateMenus(v, closed.id, [slot(v.periods.mananas, "07:00", "09:00")]);
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      if (operation === "reopen") {
        await expect(
          scoped((tx) =>
            saveSpecialDate(
              tx,
              v.cfg,
              closed.id,
              dateInput(SATURDAY),
              AT,
              VENUE_SERVICE_CALENDAR_PARTICIPANTS,
            ),
          ),
        ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "closeWholeVenue" } });
        expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
        return;
      }
      const free = await makeDate(v, "2026-10-18");
      await dateMenus(v, free.id, []);
      const source = await makeDate(v, "2026-10-19");
      await dateMenus(v, source.id, [slot(v.periods.mananas, "07:00", "09:00")]);
      const snapshot = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      await expect(
        scoped((tx) =>
          saveSpecialDate(
            tx,
            v.cfg,
            source.id,
            dateInput("2026-10-20"),
            AT,
            VENUE_SERVICE_CALENDAR_PARTICIPANTS,
          ),
        ),
      ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "date" } });
      expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(snapshot);
    },
  );
  it.each(["clear", "delete", "save", "copy"])(
    "refuses conflicting calendar %s with all child rows retained",
    async (operation) => {
      const v = await offsetVenue();
      const previous = await makeDate(v, "2026-10-18");
      await dateMenus(v, previous.id, []);
      const target = await makeDate(v, "2026-10-19");
      await dateMenus(v, target.id, [slot(v.periods.mananas, "07:00", "09:00")]);
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      const operations = {
        clear: () => turnOffOwnHours(v, previous.id),
        delete: () =>
          scoped((tx) =>
            deleteSpecialDate(tx, v.cfg, previous.id, AT, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
          ),
        save: () =>
          scoped((tx) =>
            saveSpecialDateMenus(
              tx,
              v.cfg,
              previous.id,
              v.restaurant,
              [slot(v.periods.madrugada, "21:00", "06:00")],
              AT,
            ),
          ),
        copy: () =>
          scoped((tx) =>
            duplicateSpecialDate(
              tx,
              v.cfg,
              target.id,
              ["2026-10-22", "2026-10-23"],
              AT,
              VENUE_SERVICE_CALENDAR_PARTICIPANTS,
            ),
          ),
      };
      await expect(operations[operation as keyof typeof operations]()).rejects.toMatchObject({
        code:
          operation === "delete" || operation === "copy" || operation === "clear"
            ? "hours.invalid"
            : "menu_timetable.invalid",
      });
      expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
    },
  );
});

describe("named-day timetable writes", () => {
  it("refuses a dated timetable while the named day keeps the normal week", async () => {
    const v = await timed();
    const day = await makeDate(v, CHRISTMAS);
    await db.update(specialDates).set({ ownHours: false }).where(eq(specialDates.id, day.id));
    await expect(dateMenus(v, day.id, [])).rejects.toMatchObject({
      code: "special_date.keeps_week",
      params: { specialDateId: day.id },
    });
    expect(
      await db.select().from(menuDayTimetables).where(eq(menuDayTimetables.specialDateId, day.id)),
    ).toEqual([]);
  });

  it("checks a repeating day's next occurrence for a skipped endpoint", async () => {
    const v = await timed();
    const day = await makeDate(v, "2026-03-27", { repeats: true });
    await expect(
      dateMenus(v, day.id, [slot(v.periods.mananas, "00:30", "02:30")]),
    ).rejects.toMatchObject(invalid("slots.0.endsAt", { reason: "clock_skips" }));
    expect(
      await db.select().from(menuDayTimetables).where(eq(menuDayTimetables.specialDateId, day.id)),
    ).toEqual([]);
  });
});
