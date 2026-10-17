import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
  addMember,
  requireMenuRoot,
  buildMenuDocument,
  createCatalogue,
  createCategory,
  createProduct,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  categories,
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
import { addDays } from "./hours-rules.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import {
  readOpeningHoursModel,
  replaceMenuWeek,
  resolveDefaultMenu,
  resolveDepartmentService,
  saveMenuPeriod,
  updateMenuPeriod,
} from "./menu-timetable.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { deletePeriod } from "./period-delete.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { saveSeasonWeeks } from "./season-weeks.js";
import { readSeasons } from "./seasons.js";
import type { PaintRange } from "./day-paint.js";
import { deleteSpecialDay, saveSpecialDay } from "./special-days.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import {
  configureZone,
  createDepartment,
  listDepartments,
  listZoneOffers,
  menuState,
  listVenueReadiness,
  resolveZoneContext,
  recordOrderServiceContext,
  recordWorkingLineContexts,
} from "./operations.js";
import { menuPeriods, menuPeriodStaffMenus } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import {
  departmentDayRanges,
  departmentDays as departmentDayRows,
  specialDayDates,
} from "./schema/seasons.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { offerMenuThroughZone } from "./testing/zone-menus.js";
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
          zoneOpen: true,
          zoneKeepOpen: null,
          periodName: "Always",
          periodOccurrenceKey: expect.any(String),
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
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: "Lunch",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [],
        },
        0,
      ),
    );
    expect(await offsets()).toEqual([{ name: "Lunch", offset: 0 }]);
    for (const endOffsetMinutes of [-15, 14]) {
      await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { endOffsetMinutes }, 0));
      expect(await offsets()).toEqual([{ name: "Lunch", offset: endOffsetMinutes }]);
    }
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { name: "Afternoon" }, 0));
    expect(await offsets()).toEqual([{ name: "Afternoon", offset: 14 }]);
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { endOffsetMinutes: 0 }, 0));
    expect(await offsets()).toEqual([{ name: "Afternoon", offset: 0 }]);
  });

  it.each([null, "15", 1.5, NaN, Infinity, -1440, 1440])(
    "refuses malformed end offset %s without changing a period",
    async (endOffsetMinutes) => {
      const v = await venue({ timetable: false });
      const input = { name: "Lunch", menuId: v.menus.Almuerzo, staffMenuIds: [] };
      const created = await scoped((tx) => saveMenuPeriod(tx, v.cfg, v.restaurant, input, 0));
      const before = await db.select().from(menuPeriods).where(eq(menuPeriods.id, created.id));
      await expect(
        scoped((tx) =>
          updateMenuPeriod(
            tx,
            v.cfg,
            created.id,
            {
              name: "Changed",
              endOffsetMinutes: endOffsetMinutes as number,
            },
            0,
          ),
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
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: "Lunch",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [],
        },
        0,
      ),
    );
    expect(created).toEqual({ id: expect.any(String) });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, created.id, { name: "Afternoon" }, 0)),
    ).resolves.toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, created.id)),
    ).toEqual([{ name: "Afternoon" }]);
  });

  it("resolves an end equal to the changeover at the actual following boundary", async () => {
    expect(localTimeOccurrences("2026-03-28", "02:30", ZONE)).toHaveLength(1);
    expect(localTimeOccurrences("2026-03-29", "02:30", ZONE)).toEqual([]);
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "02:30:00" })
      .where(eq(locations.id, v.locationId));
    await saveDay(v, "2026-03-28", {
      paint: [
        { periodId: null, startsAt: "02:30", endsAt: "21:00" },
        slot(v.periods!.noches, "21:00", "02:30"),
      ],
    });
    const stored = await db
      .select({ startsAt: departmentDayRanges.startsAt, endsAt: departmentDayRanges.endsAt })
      .from(departmentDayRanges)
      .innerJoin(departmentDayRows, eq(departmentDayRows.id, departmentDayRanges.dayId))
      .where(
        and(
          isNotNull(departmentDayRows.specialDayDateId),
          eq(departmentDayRanges.periodId, v.periods!.noches),
        ),
      );
    expect(stored).toEqual([{ startsAt: "21:00:00", endsAt: "02:30:00" }]);
    const running = await scoped((tx) =>
      resolveDepartmentService(tx, v.cfg, v.restaurant, new Date("2026-03-29T01:10:00Z")),
    );
    expect(running).toMatchObject({ open: true, periodId: v.periods!.noches });
    expect(running.sendableMenuIds).toContain(running.customerMenuId);
    expect(
      (
        await scoped((tx) =>
          resolveDepartmentService(tx, v.cfg, v.restaurant, new Date("2026-03-29T01:30:00Z")),
        )
      ).periodId,
    ).not.toBe(v.periods!.noches);
  });

  it("checks a start equal to the changeover on the business date", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "02:30:00" })
      .where(eq(locations.id, v.locationId));
    await saveDay(v, "2026-03-28", { paint: [slot(v.periods!.mananas, "02:30", "21:00")] });
    await expect(
      saveDay(v, "2026-03-29", { paint: [slot(v.periods!.mananas, "02:30", "21:00")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.startsAt", reason: "clock_skips", date: "2026-03-29" },
    });
    expect(await paintedRanges(v.periods!.mananas)).toEqual([
      { date: "2026-03-28", startsAt: "02:30:00", endsAt: "21:00:00" },
    ]);
  });

  it("always creates a new period even if an untyped caller sends an existing id", async () => {
    const v = await venue({ timetable: false });
    const original = await scoped((tx) =>
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: "Lunch",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [],
        },
        0,
      ),
    );
    const created = await scoped((tx) =>
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          id: original.id,
          name: "Afternoon",
          menuId: v.menus.Café,
          staffMenuIds: [],
        } as never,
        0,
      ),
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
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: "Lunch",
          menuId: v.menus.Bebidas,
          staffMenuIds: [],
        },
        0,
      ),
    );
    for (const field of ["colour", "staffMenuIds"] as const) {
      await expect(
        scoped((tx) => updateMenuPeriod(tx, v.cfg, id, { [field]: null } as never, 0)),
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
          0,
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
          0,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "days.1.slots", reason: "step" },
    });
    await expect(
      saveDay(v, CHRISTMAS, { paint: [slot(v.periods!.mananas, "12:00", "14:10")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges", reason: "step" },
    });
  });

  it("checks skipped times on the calendar date that owns each business-day endpoint", async () => {
    const v = await venue();
    await db
      .update(locations)
      .set({ dayCutover: "06:00:00" })
      .where(eq(locations.id, v.locationId));
    await expect(
      saveDay(v, "2026-03-28", { paint: [slot(v.periods!.noches, "21:00", "02:30")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.endsAt", reason: "clock_skips", date: "2026-03-28" },
    });
    await saveDay(v, "2026-03-29", { paint: [slot(v.periods!.noches, "06:00", "02:30")] });
    expect(await paintedRanges(v.periods!.noches)).toEqual([
      { date: "2026-03-29", startsAt: "06:00:00", endsAt: "02:30:00" },
    ]);
  });

  it.each([null, "pink", 1])("refuses an explicit invalid colour %s", async (colour) => {
    const v = await venue({ timetable: false });
    await expect(
      scoped((tx) =>
        saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          {
            name: "Lunch",
            menuId: v.menus.Bebidas,
            staffMenuIds: [],
            colour: colour as never,
          },
          0,
        ),
      ),
    ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "colour" } });
  });

  it("refuses changing the customer menu to a retained staff menu and leaves the period untouched", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: "Lunch",
          menuId: v.menus.Bebidas,
          staffMenuIds: [v.menus.Café],
          colour: "blue",
        },
        0,
      ),
    );
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, id, { menuId: v.menus.Café }, 0)),
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
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        {
          name: " Lunch ",
          menuId: v.menus["Deli para llevar"],
          staffMenuIds: [v.menus.Café, v.menus.Bebidas],
        },
        0,
      ),
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
      updateMenuPeriod(
        tx,
        v.cfg,
        period.id,
        {
          staffMenuIds: [v.menus.Bebidas, v.menus.Café],
          colour: "purple",
        },
        0,
      ),
    );
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, period.id, { name: " Afternoon " }, 0));
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
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, period.id, { staffMenuIds: [] }, 0));
    expect(await staff()).toEqual([]);
  });

  it("chooses the first unused department colour, repeating red after all six", async () => {
    const v = await venue({ timetable: false });
    const colours = [];
    for (let index = 0; index < 7; index++) {
      const { id } = await scoped((tx) =>
        saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          {
            name: `Period ${index}`,
            menuId: v.menus.Bebidas,
            staffMenuIds: [],
          },
          0,
        ),
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
          saveMenuPeriod(
            tx,
            v.cfg,
            v.restaurant,
            {
              name: "Lunch",
              menuId: kind === "customer" ? v.menus.Café : v.menus.Bebidas,
              staffMenuIds: kind === "staff" ? [v.menus.Café] : [],
            },
            0,
          ),
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
          saveMenuPeriod(
            tx,
            v.cfg,
            v.restaurant,
            {
              name: "Lunch",
              menuId: v.menus.Bebidas,
              staffMenuIds: kind === "customer" ? [v.menus.Bebidas] : [v.menus.Café, v.menus.Café],
            },
            0,
          ),
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
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" })).id;
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
      (
        await saveMenuPeriod(
          tx,
          cfg,
          departmentId,
          { name, menuId: menus[menu], staffMenuIds: [] },
          0,
        )
      ).id;
    const periods = {
      mananas: await period(restaurant, "Mañanas", "Desayunos"),
      mediodia: await period(restaurant, "Mediodía", "Almuerzo"),
      noches: await period(restaurant, "Noches", "Cena"),
      madrugada: await period(restaurant, "Madrugada", "Copas"),
      brunch: await period(restaurant, "Brunch navideño", "Brunch de Navidad"),
      mediodiaDeli: await period(deli, "Mediodía deli", "Deli para llevar"),
    };
    await replaceMenuWeek(tx, cfg, restaurant, restaurantWeek(periods), AT, 0);
    await replaceMenuWeek(
      tx,
      cfg,
      deli,
      weekOf(() => [slot(periods.mediodiaDeli, "12:00", "15:00")]),
      AT,
      0,
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

/** The special-day paint ranges that place `periodId`, by date. */
const paintedRanges = (periodId: string) =>
  db
    .select({
      date: specialDayDates.date,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDayRows, eq(departmentDayRows.id, departmentDayRanges.dayId))
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDayRows.specialDayDateId))
    .where(eq(departmentDayRanges.periodId, periodId))
    .orderBy(specialDayDates.date, departmentDayRanges.startsAt);
/** Saves a special day on `date`, painting the restaurant's day with `paint` (none clears it). */
const saveDay = (
  v: Venue,
  date: string,
  options: { id?: string; closedAllDay?: boolean; paint?: PaintRange[] } = {},
) =>
  scoped((tx) =>
    saveSpecialDay(
      tx,
      v.cfg,
      options.id ?? null,
      {
        name: `Special ${date}`,
        repeatsYearly: false,
        dates: [{ date, closedAllDay: options.closedAllDay ?? false }],
        paint: [{ departmentId: v.restaurant, date, ranges: options.paint ?? [] }],
      },
      AT,
      0,
    ),
  );

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
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: "Mañanas",
      periodOccurrenceKey: expect.any(String),
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
      updateMenuPeriod(
        tx,
        v.cfg,
        v.periods.mananas,
        {
          staffMenuIds: [v.menus.Café, v.menus.Bebidas],
        },
        0,
      ),
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
        0,
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
        0,
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
        0,
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
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select zone_id from zone_service_policies where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
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
    const christmas = await saveDay(v, CHRISTMAS, {
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "11:00" },
        slot(periods.brunch, "11:00", "15:00"),
        { periodId: null, startsAt: "15:00", endsAt: "06:00" },
      ],
    });
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

    await saveDay(v, CHRISTMAS, {
      id: christmas.id,
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "09:00" },
        slot(periods.mananas, "09:00", "11:00"),
        { periodId: null, startsAt: "11:00", endsAt: "06:00" },
      ],
    });
    expect(await choice(v, v.barra, at("10:00"))).toEqual({
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });

    await saveDay(v, CHRISTMAS, {
      id: christmas.id,
      paint: [{ periodId: null, startsAt: "06:00", endsAt: "06:00" }],
    });
    for (const time of ["10:00", "12:00"])
      expect(await choice(v, v.sala, at(time))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("refuses a slot opening or closing at a minute the clock skips that date, writing nothing", async () => {
    const v = await timed();
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const skipped = minutesAfter(forward.before, 16);
    const date = addDays(forward.date, -1);
    await expect(
      saveDay(v, date, { paint: [slot(v.periods.mananas, "00:30", skipped)] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.endsAt", reason: "clock_skips", date },
    });
    await expect(
      saveDay(v, date, {
        paint: [
          slot(v.periods.madrugada, "00:00", "00:30"),
          slot(v.periods.mananas, skipped, "05:00"),
        ],
      }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.1.startsAt", reason: "clock_skips", date },
    });
    expect(await db.select().from(specialDayDates).where(eq(specialDayDates.date, date))).toEqual(
      [],
    );
  });

  it("refuses another venue's department, and a department that does not exist", async () => {
    const v = await timed();
    const other = await timed();
    const unknown = randomUUID();
    for (const departmentId of [other.restaurant, unknown]) {
      await expect(saveDay({ ...v, restaurant: departmentId }, CHRISTMAS)).rejects.toMatchObject({
        code: "department.not_found",
        params: { departmentId },
      });
    }
  });
});

describe("the timetable's writers", () => {
  it("checks structural ranges but skips clock-gap checks when the clock cannot be read", async () => {
    const v = await timed();
    await db.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, v.locationId));
    const date = await saveDay(v, "2027-03-27", {
      paint: [slot(v.periods.mananas, "00:30", "02:30")],
    });
    expect(await paintedRanges(v.periods.mananas)).toEqual([
      { date: "2027-03-27", startsAt: "00:30:00", endsAt: "02:30:00" },
    ]);
    await expect(
      saveDay(v, "2027-03-27", { id: date.id, paint: [slot(v.periods.mananas, "01:00", "12:00")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges", reason: "order" },
    });
  });

  it("refuse a period, menu or slot from another department, and an unknown period", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const absentMenu = randomUUID();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, periods.noches, { name: "Cenas", menuId: menus.Cena }, 0),
    );
    expect(
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, periods.noches, { menuId: menus.Cócteles }, 0),
      ),
    ).toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, periods.noches)),
    ).toEqual([{ name: "Cenas", menuId: menus.Cócteles }]);
    expect(
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, periods.noches, { name: "Noches tarde" }, 0),
      ),
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
      scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { menuId: absentMenu }, 0)),
    ).rejects.toMatchObject({
      code: "catalogue.not_found",
      params: { catalogueId: absentMenu },
    });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, periods.noches, { name: "  " }, 0)),
    ).rejects.toMatchObject(invalid("name"));
  });

  it("changes a period's menus without a department membership list and preserves other periods", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(
        tx,
        v.cfg,
        v.periods.mananas,
        {
          menuId: v.menus.Café,
          staffMenuIds: [v.menus.Bebidas],
        },
        0,
      ),
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
    await saveDay(v, "2026-10-03", { paint: [slot(periods.mananas, "01:00", "03:00")] });
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("03:00"), AT, 0));
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("02:00"), AT, 0));
    // Tuesday 6 October is yesterday at AT, so it is read, but its pair with Monday is past.
    await saveDay(v, "2026-10-06", { paint: [slot(periods.mananas, "01:00", "03:00")] });
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 1 ? [slot(periods.madrugada, "22:00", "03:00")] : null,
        ),
        AT,
        0,
      ),
    );
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("02:00"), AT, 0));

    await saveDay(v, "2026-10-24", { paint: [slot(periods.mananas, "02:30", "05:00")] });
    await scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("03:00"), AT, 0));
    // The replacement week was written.
    expect((await resolve(v, v.sala, madrid("2026-10-31", "02:30"))).periodId).toBe(
      periods.madrugada,
    );
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, weekOf(() => []).slice(1), AT, 0)),
    ).rejects.toMatchObject(invalid("days"));
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf(() => []),
          AT,
          0,
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
          0,
        ),
      ),
    ).rejects.toMatchObject({ code: "department.not_found" });
  });

  it("deleting a painted period removes its staff menus", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, periods.noches, { staffMenuIds: [menus.Cócteles] }, 0),
    );
    expect(
      await db
        .select({ menuId: menuPeriodStaffMenus.menuId })
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, periods.noches)),
    ).toEqual([{ menuId: menus.Cócteles }]);
    await scoped((tx) => deletePeriod(tx, v.cfg, periods.noches, null, AT, 0));
    expect(
      await db
        .select()
        .from(menuPeriodStaffMenus)
        .where(eq(menuPeriodStaffMenus.periodId, periods.noches)),
    ).toEqual([]);
  });
});

describe("the opening-hours model's seasons", () => {
  it("lists the seasons, every season's week, and the current season's week by business day", async () => {
    const v = await venue({ timetable: false });
    const seasons = await scoped(async (tx) => {
      const dinner = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          { name: "Dinner", menuId: v.menus.Cena, staffMenuIds: [] },
          0,
        )
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
        0,
      );
      const winter = (await readSeasons(tx, v.cfg)).find((season) => season.name === "Winter")!;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) => (weekday === 5 ? [slot(dinner, "20:00", "23:00")] : [])),
        AT,
        0,
        { seasonId: winter.id },
      );
      await replaceZoneClosedWeek(
        tx,
        v.cfg,
        v.sala,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: weekday === 5 ? [{ startsAt: "16:00", endsAt: "18:00" }] : [],
        })),
        0,
        AT,
        { seasonId: winter.id },
      );
      return { dinner, all: await readSeasons(tx, v.cfg) };
    });
    const id = (name: string) => seasons.all.find((season) => season.name === name)!.id;
    const empty = <K extends string>(key: K) =>
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, [key]: [] }));
    const dinnerFriday = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      slots: weekday === 5 ? [slot(seasons.dinner, "20:00", "23:00")] : [],
    }));
    const closedFriday = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      ranges: weekday === 5 ? [{ startsAt: "16:00", endsAt: "18:00" }] : [],
    }));

    const december = await scoped((tx) =>
      readOpeningHoursModel(tx, v.cfg, madrid("2026-12-04", "12:00")),
    );
    expect(december.seasons).toEqual([
      { id: id("Spring"), name: "Spring", startsOn: "03-01" },
      { id: id("Summer"), name: "Summer", startsOn: "06-01" },
      { id: id("Autumn"), name: "Autumn", startsOn: "09-01" },
      { id: id("Winter"), name: "Winter", startsOn: "12-01" },
    ]);
    expect(december.currentSeasonId).toBe(id("Winter"));
    const restaurant = december.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.seasonWeeks).toEqual([
      { seasonId: id("Spring"), week: empty("slots") },
      { seasonId: id("Summer"), week: empty("slots") },
      { seasonId: id("Autumn"), week: empty("slots") },
      { seasonId: id("Winter"), week: dinnerFriday },
    ]);
    expect(
      restaurant.seasonWeeks.find((entry) => entry.seasonId === december.currentSeasonId)!.week,
    ).toEqual(dinnerFriday);
    expect(restaurant.periods.find((period) => period.id === seasons.dinner)!.weekdays).toEqual([
      5,
    ]);
    const sala = restaurant.zones.find((zone) => zone.id === v.sala)!;
    expect(sala.seasonWeeks).toEqual([
      { seasonId: id("Spring"), week: empty("ranges") },
      { seasonId: id("Summer"), week: empty("ranges") },
      { seasonId: id("Autumn"), week: empty("ranges") },
      { seasonId: id("Winter"), week: closedFriday },
    ]);
    expect(
      sala.seasonWeeks.find((entry) => entry.seasonId === december.currentSeasonId)!.week,
    ).toEqual(closedFriday);

    const july = await scoped((tx) =>
      readOpeningHoursModel(tx, v.cfg, madrid("2026-07-03", "12:00")),
    );
    expect(july.currentSeasonId).toBe(id("Summer"));
    const summer = july.departments.find((department) => department.id === v.restaurant)!;
    expect(
      summer.seasonWeeks.find((entry) => entry.seasonId === july.currentSeasonId)!.week[5],
    ).toEqual({ weekday: 5, slots: [] });
    expect(
      summer.zones
        .find((zone) => zone.id === v.sala)!
        .seasonWeeks.find((entry) => entry.seasonId === july.currentSeasonId)!.week[5],
    ).toEqual({
      weekday: 5,
      ranges: [],
    });
    expect(summer.seasonWeeks).toEqual(restaurant.seasonWeeks);
  });

  it("before the day's changeover, takes the season of the business day still running", async () => {
    const v = await venue({ timetable: false });
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
        0,
      ),
    );
    const ids = await scoped((tx) => readSeasons(tx, v.cfg));
    const model = await scoped((tx) =>
      readOpeningHoursModel(tx, v.cfg, madrid("2026-12-01", "03:00")),
    );
    expect(model.currentSeasonId).toBe(ids.find((season) => season.name === "Autumn")!.id);
  });

  it("when the clock cannot be read, has no current season and still lists the first season's week", async () => {
    const v = await venue({ timetable: false });
    const spring = await scoped(async (tx) => {
      const dinner = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          { name: "Dinner", menuId: v.menus.Cena, staffMenuIds: [] },
          0,
        )
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
        0,
      );
      const first = (await readSeasons(tx, v.cfg))[0]!;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) => (weekday === 2 ? [slot(dinner, "20:00", "23:00")] : [])),
        AT,
        0,
        { seasonId: first.id },
      );
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
      return { dinner, first };
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(spring.first.name).toBe("Spring");
    expect(model.currentSeasonId).toBeNull();
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.seasonWeeks[0]!.seasonId).toBe(spring.first.id);
    expect(restaurant.seasonWeeks[0]!.week[2]).toEqual({
      weekday: 2,
      slots: [slot(spring.dinner, "20:00", "23:00")],
    });
  });

  it("gives a venue with no seasons no season weeks", async () => {
    const v = await venue({ timetable: false });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.seasons).toEqual([]);
    expect(model.currentSeasonId).toBeNull();
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.seasonWeeks).toEqual([]);
    expect(restaurant.zones.find((zone) => zone.id === v.sala)!.seasonWeeks).toEqual([]);
  });
});

describe("a period no longer placed anywhere but a past special day", () => {
  it("a period painted only on a past special day has no weekdays in the model and is deleted with that paint", async () => {
    const v = await timed();
    const { periods } = v;
    await saveDay(v, "2025-12-25", {
      paint: [slot(periods.brunch, "11:00", "15:00")],
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.periods.find((period) => period.id === periods.brunch)!.weekdays).toEqual([]);

    await scoped((tx) => deletePeriod(tx, v.cfg, periods.brunch, null, AT, 0));
    expect(await db.select().from(menuPeriods).where(eq(menuPeriods.id, periods.brunch))).toEqual(
      [],
    );
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

/** The restaurant's painted day rows and ranges a special day holds on `date`. */
const paintOn = async (v: Venue, date: string) => {
  const onDate = and(eq(specialDayDates.locationId, v.locationId), eq(specialDayDates.date, date));
  const days = await db
    .select({ id: departmentDayRows.id })
    .from(departmentDayRows)
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDayRows.specialDayDateId))
    .where(onDate);
  const ranges = await db
    .select({
      periodId: departmentDayRanges.periodId,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDayRanges)
    .innerJoin(departmentDayRows, eq(departmentDayRows.id, departmentDayRanges.dayId))
    .innerJoin(specialDayDates, eq(specialDayDates.id, departmentDayRows.specialDayDateId))
    .where(onDate);
  return { days: days.length, ranges };
};

describe("a special day cleared or deleted", () => {
  it("lets clearing and deleting a date restore the week independently of its neighbour", async () => {
    const v = await timed();
    const { periods } = v;
    await recordedLine(v);
    const recorded = await lineContexts();
    expect(recorded.rows).toHaveLength(1);
    const christmas = await saveDay(v, CHRISTMAS, {
      paint: [
        slot(periods.mananas, "09:00", "11:00"),
        { periodId: null, startsAt: "11:00", endsAt: "12:00" },
      ],
    });
    await saveDay(v, "2026-12-26", { paint: [slot(periods.mananas, "01:00", "03:00")] });
    const neighbour = await paintOn(v, "2026-12-26");
    expect(neighbour.ranges).toHaveLength(1);
    // The week runs Mañanas until 12:00; the painted date closes at 11:00.
    expect(await choice(v, v.sala, madrid(CHRISTMAS, "11:30"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });

    await saveDay(v, CHRISTMAS, { id: christmas.id });
    expect(await paintOn(v, CHRISTMAS)).toEqual({ days: 0, ranges: [] });
    expect(await choice(v, v.sala, madrid(CHRISTMAS, "11:30"))).toEqual({
      defaultMenuId: v.menus.Desayunos,
      periodId: periods.mananas,
    });

    await scoped((tx) => deleteSpecialDay(tx, v.cfg, christmas.id, AT, 0));
    expect(await paintOn(v, CHRISTMAS)).toEqual({ days: 0, ranges: [] });
    expect(
      await db.select().from(specialDayDates).where(eq(specialDayDates.specialDayId, christmas.id)),
    ).toEqual([]);
    for (const time of ["10:00", "11:30"])
      expect(await choice(v, v.sala, madrid(CHRISTMAS, time))).toEqual({
        defaultMenuId: v.menus.Desayunos,
        periodId: periods.mananas,
      });
    expect(await paintOn(v, "2026-12-26")).toEqual(neighbour);
    expect((await lineContexts()).rows).toEqual(recorded.rows);
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
      updateMenuPeriod(
        tx,
        unpublished.cfg,
        unpublished.periods.mananas,
        {
          staffMenuIds: [unpublished.menus.Bebidas],
        },
        0,
      ),
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
  it("pricing skips zone closed times and reports neutral zone state", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const offers = await listZoneOffers(tx, v.cfg, v.barra, { withDefault: false });
        expect(offers.service.zoneOpen).toBe(true);
        expect(
          spy.mock.calls
            .map(([query]) => (query as unknown as { sql: string }).sql)
            .filter((text) => /"(zone_days|zone_day_ranges)"/.test(text)),
        ).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

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
        0,
      ),
    );
    const few = await statementsOf((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, at));
    await scoped(async (tx) => {
      await replaceMenuWeek(tx, v.cfg, v.restaurant, twentySlots(v.periods), AT, 0);
      await updateMenuPeriod(
        tx,
        v.cfg,
        v.periods.noches,
        {
          staffMenuIds: [v.menus.Café, v.menus.Cócteles, v.menus.Bebidas],
        },
        0,
      );
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
        await updateMenuPeriod(
          tx,
          v.cfg,
          v.periods.mananas,
          { staffMenuIds: [v.menus.Bebidas] },
          0,
        );
      await replaceMenuWeek(
        tx,
        plain.cfg,
        plain.restaurant,
        weekOf(() => []),
        AT,
        0,
      );
      await replaceMenuWeek(tx, busy.cfg, busy.restaurant, twentySlots(busy.periods), AT, 0);
    });
    const read = (v: Timed) =>
      statementsOf((tx) =>
        listZoneOffers(tx, v.cfg, v.barra, { menuItemIds: [randomUUID()], withDefault: false }),
      );
    const none = await read(plain);
    const lots = await read(busy);
    const v = busy;
    expect(lots).toHaveLength(none.length);
    const runningPeriodReads = /"locations"/;
    expect(lots.filter((text) => runningPeriodReads.test(text))).toEqual([]);
    const priced = await scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { withDefault: false }));
    expect(priced.defaultMenuId).toBeNull();
    expect(priced.service).toEqual({
      open: true,
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
    });
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
  it("lists a venue with no periods and no seasons, and no department season weeks", async () => {
    const v = await venue({ timetable: false });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    expect(model.seasons).toEqual([]);
    for (const department of model.departments) {
      expect(department.periods).toEqual([]);
      expect(department.seasonWeeks).toEqual([]);
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

  it("lists every department, its periods with their days and its season weeks", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select zone_id from zone_service_policies where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })();
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const seasonIds = (await scoped((tx) => readSeasons(tx, v.cfg))).map((season) => season.id);
    const inEverySeason = <T>(week: T) => seasonIds.map((seasonId) => ({ seasonId, week }));

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
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.sala,
          name: "Sala",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.terraza,
          name: "Terraza",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
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
          routingUses: [],
        },
        {
          id: periods.madrugada,
          name: "Madrugada",
          menuId: menus.Copas,
          colour: "blue",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(5),
          routingUses: [],
        },
        {
          id: periods.mananas,
          name: "Mañanas",
          menuId: menus.Desayunos,
          colour: "red",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(1, 2, 3, 4, 5),
          routingUses: [],
        },
        {
          id: periods.mediodia,
          name: "Mediodía",
          menuId: menus.Almuerzo,
          colour: "amber",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(0, 1, 2, 3, 4, 5, 6),
          routingUses: [],
        },
        {
          id: periods.noches,
          name: "Noches",
          menuId: menus.Cena,
          colour: "grey",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: weekdays(1, 2, 3, 4, 5),
          routingUses: [],
        },
      ],
      seasonWeeks: inEverySeason(restaurantWeek(periods)),
    });
    expect(model.departments.find((department) => department.id === v.deli)).toBeUndefined();
    expect(
      await db.select().from(menuPeriods).where(eq(menuPeriods.id, periods.mediodiaDeli)),
    ).toContainEqual(expect.objectContaining({ id: periods.mediodiaDeli, departmentId: v.deli }));
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

  it("is read once when ranges need it", async () => {
    const v = await timed();
    const { periods } = v;
    expect(
      await clockReads((tx) =>
        replaceMenuWeek(tx, v.cfg, v.restaurant, restaurantWeek(periods), AT, 0),
      ),
    ).toBe(1);
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
        await saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          {
            name: "Lunch",
            colour: "blue",
            menuId: v.menus.Almuerzo,
            staffMenuIds: [v.menus.Bebidas, v.menus.Café],
          },
          0,
        )
      ).id;
      const afternoon = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          {
            name: "Afternoon",
            colour: "amber",
            menuId: v.menus.Café,
            staffMenuIds: [],
          },
          0,
        )
      ).id;
      const night = (
        await saveMenuPeriod(
          tx,
          v.cfg,
          v.restaurant,
          {
            name: "Night",
            colour: "grey",
            menuId: v.menus.Cena,
            staffMenuIds: [],
          },
          0,
        )
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
        0,
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
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.lunch, { staffMenuIds: [v.menus.Bebidas] }, 0),
    );
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
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.lunch, { staffMenuIds: [v.menus.Bebidas] }, 0),
    );
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
        0,
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
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: "Lunch",
      periodOccurrenceKey: expect.any(String),
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
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: "Afternoon",
      periodOccurrenceKey: expect.any(String),
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
      updateMenuPeriod(tx, v.cfg, v.periods.mananas, { staffMenuIds: [v.menus.Bebidas] }, 0),
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
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.mananas, { staffMenuIds: [] }, 0));
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
      updateMenuPeriod(
        tx,
        v.cfg,
        v.lunch,
        {
          menuId: v.menus.Café,
          staffMenuIds: [v.menus.Bebidas],
        },
        0,
      ),
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
      service: {
        open: false,
        zoneOpen: true,
        zoneKeepOpen: null,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
      },
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
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: null,
      periodOccurrenceKey: null,
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
    expect(result.service).toEqual({
      open: true,
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: null,
      periodOccurrenceKey: null,
      keepOpen: null,
    });
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
        0,
      ),
    );
    const issues = await scoped((tx) => listVenueReadiness(tx, v.cfg));
    expect(issues.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.deli, departmentName: "Deli" },
      { code: "department.no_periods", departmentId: v.restaurant, departmentName: "Restaurant" },
    ]);
    expect(issues.some((issue) => (issue.code as string) === "zone.menu_missing")).toBe(false);
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select zone_id from zone_service_policies where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
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

  it("reads opening hours with period colours, ordered staff menus and all seven days", async () => {
    const v = await serviceVenue();
    const other = await venue({ timetable: false });
    await db.update(menuPeriods).set({ colour: "blue" }).where(eq(menuPeriods.id, v.lunch));
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select zone_id from zone_service_policies where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const seasonIds = (await scoped((tx) => readSeasons(tx, v.cfg))).map((season) => season.id);
    const inEverySeason = <T>(week: T) => seasonIds.map((seasonId) => ({ seasonId, week }));
    expect(model.dayCutover).toBe("06:00");
    expect(model.departments.map((department) => department.id)).toEqual([v.restaurant]);
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
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.sala,
          name: "Sala",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.terraza,
          name: "Terraza",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
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
          routingUses: [],
        },
        {
          id: v.lunch,
          name: "Lunch",
          colour: "blue",
          menuId: v.menus.Almuerzo,
          staffMenuIds: [v.menus.Bebidas, v.menus.Café],
          endOffsetMinutes: 0,
          weekdays: [5],
          routingUses: [],
        },
        {
          id: v.night,
          name: "Night",
          colour: "grey",
          menuId: v.menus.Cena,
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [5],
          routingUses: [],
        },
      ],
      seasonWeeks: inEverySeason(
        weekOf((weekday) =>
          weekday === 5
            ? [
                slot(v.lunch, "12:00", "14:00"),
                slot(v.afternoon, "14:00", "19:00"),
                slot(v.night, "21:00", "03:00"),
              ]
            : [],
        ),
      ),
    });
    expect(model.departments.find((department) => department.id === v.deli)).toBeUndefined();
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
          0,
        );
        await updateMenuPeriod(tx, v.cfg, v.lunch, { endOffsetMinutes: offset }, 0);
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
        0,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: 15 }, 0);
    });
    await saveDay(v, SATURDAY, { closedAllDay: true });
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
    await scoped((tx) => updateMenuPeriod(tx, v.cfg, v.lunch, { endOffsetMinutes: -15 }, 0));
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
        0,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: -30 }, 0);
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
        0,
      );
      await updateMenuPeriod(tx, v.cfg, v.night, { endOffsetMinutes: -90 }, 0);
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
      periodOccurrenceKey: expect.any(String),
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
      periodOccurrenceKey: expect.any(String),
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
      periodOccurrenceKey: expect.any(String),
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
      periodOccurrenceKey: null,
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
      periodOccurrenceKey: null,
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
      periodOccurrenceKey: null,
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
      periodOccurrenceKey: null,
      customerMenuId: null,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
  });

  it("replaces the business day's week with special-date ranges, including its next morning", async () => {
    const v = await serviceVenue();
    await saveDay(v, FRIDAY, {
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "13:00" },
        slot(v.lunch, "13:00", "03:00"),
      ],
    });
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
    const date = await saveDay(v, FRIDAY);
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: true, periodId: v.lunch });
    await saveDay(v, FRIDAY, {
      id: date.id,
      paint: [{ periodId: null, startsAt: "06:00", endsAt: "06:00" }],
    });
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    await saveDay(v, FRIDAY, { id: date.id });
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: true, periodId: v.lunch });
  });

  it("a whole-venue closure overrides both special-date ranges and the week", async () => {
    const v = await serviceVenue();
    const date = await saveDay(v, FRIDAY, {
      closedAllDay: true,
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "12:00" },
        slot(v.lunch, "12:00", "16:00"),
        { periodId: null, startsAt: "16:00", endsAt: "06:00" },
      ],
    });
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({
      open: false,
      orderableMenuIds: [],
      sendableMenuIds: [],
      endedMenuIds: [],
    });
    await saveDay(v, FRIDAY, { id: date.id, closedAllDay: true });
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
      periodOccurrenceKey: null,
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
      periodOccurrenceKey: null,
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
          0,
        ),
      );
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      await expect(
        scoped((tx) =>
          updateMenuPeriod(
            tx,
            v.cfg,
            v.periods.mediodia,
            {
              endOffsetMinutes: offset,
              staffMenuIds: [v.menus.Café],
            },
            0,
          ),
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
        0,
      ),
    );
    for (const offset of [14, -119, 0]) {
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: offset }, 0),
      );
      const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      expect(
        model.departments
          .find((d) => d.id === v.restaurant)!
          .periods.find((p) => p.id === v.periods.mediodia)!.endOffsetMinutes,
      ).toBe(offset);
    }
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.brunch, { endOffsetMinutes: 1439 }, 0),
    );
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).departments
        .find((d) => d.id === v.restaurant)!
        .periods.find((p) => p.id === v.periods.brunch)!.endOffsetMinutes,
    ).toBe(1439);
  });

  it("checks a shorter repeated placement, rejecting the entire replacement week", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: -119 }, 0),
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
          0,
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
          0,
        ),
      );
      await scoped((tx) =>
        updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 179 }, 0),
      );
      const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      await expect(
        scoped((tx) =>
          updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 180 }, 0),
        ),
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
        0,
      ),
    );
    const past = await saveDay(v, "2026-01-01", {
      paint: [slot(v.periods.mediodia, "12:00", "14:00"), slot(v.periods.noches, "14:15", "18:00")],
    });
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 14 }, 0),
    );
    await expect(
      scoped((tx) => updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 15 }, 0)),
    ).rejects.toMatchObject({
      code: "menu_period.invalid",
      params: { field: "endOffsetMinutes", reason: "placement", date: "2026-01-01" },
    });
    await saveDay(v, "2026-01-01", { id: past.id });
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [slot(v.periods.mediodia, "12:00", "14:00")]),
        AT,
        0,
      ),
    );
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.mediodia, { endOffsetMinutes: 180 }, 0),
    );
    expect(
      (await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).departments
        .find((d) => d.id === v.restaurant)!
        .periods.find((p) => p.id === v.periods.mediodia)!.endOffsetMinutes,
    ).toBe(180);
  });
});

describe("end offsets across a season boundary", () => {
  it("refuses a season week whose first day meets the grace of the season before", async () => {
    const v = await timed();
    const all = await scoped((tx) => readSeasons(tx, v.cfg));
    const autumn = all.find((season) => season.name === "Autumn")!;
    const winter = all.find((season) => season.name === "Winter")!;
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
        0,
      ),
    );
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((w) => (w === 6 ? [slot(v.periods.madrugada, "20:00", "05:45")] : [])),
        AT,
        0,
        { seasonId: autumn.id },
      ),
    );
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 30 }, 0),
    );
    const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    // Autumn's Saturday sends until 06:15; Winter's first day, on a Sunday, opens at 06:00.
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          weekOf((w) => (w === 0 ? [slot(v.periods.mananas, "06:00", "09:00")] : [])),
          AT,
          0,
          { seasonId: winter.id },
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: {
        field: "days",
        reason: "end_offset",
        periodId: v.periods.madrugada,
        departmentId: v.restaurant,
        seasonId: autumn.id,
        weekday: 6,
      },
    });
    expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
  });
});

describe("end offsets across a season boundary, saved with the season's other weeks", () => {
  it("names the clash by the department's place in the request and its whole week", async () => {
    const v = await timed();
    const all = await scoped((tx) => readSeasons(tx, v.cfg));
    const autumn = all.find((season) => season.name === "Autumn")!;
    const winter = all.find((season) => season.name === "Winter")!;
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => []),
        AT,
        0,
      ),
    );
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((w) => (w === 6 ? [slot(v.periods.madrugada, "20:00", "05:45")] : [])),
        AT,
        0,
        { seasonId: autumn.id },
      ),
    );
    await scoped((tx) =>
      updateMenuPeriod(tx, v.cfg, v.periods.madrugada, { endOffsetMinutes: 30 }, 0),
    );
    const before = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    await expect(
      scoped((tx) =>
        saveSeasonWeeks(
          tx,
          v.cfg,
          winter.id,
          {
            departments: [
              { departmentId: v.deli, days: weekOf(() => []) },
              {
                departmentId: v.restaurant,
                days: weekOf((w) => (w === 0 ? [slot(v.periods.mananas, "06:00", "09:00")] : [])),
              },
            ],
          },
          AT,
          0,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: {
        field: "departments.1.days",
        reason: "end_offset",
        periodId: v.periods.madrugada,
        departmentId: v.restaurant,
        seasonId: autumn.id,
        weekday: 6,
      },
    });
    expect(await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT))).toEqual(before);
  });
});

describe("the routing that names a period", () => {
  it("lists each cell with a line for the period, and deleting the period takes only those lines", async () => {
    const v = await timed();
    const { periods } = v;
    const [cocina] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, v.locationId));
    const [cocktails] = await db
      .insert(categories)
      .values({ name: "Cocktails" })
      .returning({ id: categories.id });
    const mojito = await scoped((tx) =>
      createProduct(tx, {
        catalogueId: v.menus.Copas,
        categoryId: cocktails!.id,
        name: "Mojito",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      }),
    );
    const cell = async (values: Partial<typeof routingCells.$inferInsert>) =>
      (
        await db
          .insert(routingCells)
          .values({ locationId: v.locationId, stationId: cocina!.id, ...values })
          .returning({ id: routingCells.id })
      )[0]!.id;
    const line = (cellId: string, periodId: string, noPreparation = false) =>
      db.insert(routingCellPeriods).values({
        cellId,
        periodId,
        departmentId: v.restaurant,
        stationId: noPreparation ? null : cocina!.id,
        noPreparation,
      });
    const cocktailsEverywhere = await cell({ categoryId: cocktails!.id });
    await line(cocktailsEverywhere, periods.noches);
    await line(cocktailsEverywhere, periods.mediodia, true);
    await line(await cell({ productId: mojito!.id, zoneId: v.terraza }), periods.noches, true);
    await line(await cell({ categoryId: cocktails!.id, zoneId: v.sala }), periods.noches);
    await line(await cell({ zoneId: v.sala }), periods.noches);
    await line(await cell({ noCategory: true }), periods.mananas);
    await cell({ categoryId: cocktails!.id, zoneId: v.barra });

    const uses = async () => {
      const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
      const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
      return new Map(restaurant.periods.map((period) => [period.id, period.routingUses]));
    };
    const before = await uses();
    expect(before.get(periods.noches)).toEqual([
      { rowKind: "all", rowLabel: null, zoneName: "Sala" },
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Cocktails", zoneName: "Sala" },
      { rowKind: "product", rowLabel: "Cocktails › Mojito", zoneName: "Terraza" },
    ]);
    expect(before.get(periods.mediodia)).toEqual([
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
    ]);
    expect(before.get(periods.mananas)).toEqual([
      { rowKind: "no_category", rowLabel: null, zoneName: null },
    ]);
    expect(before.get(periods.madrugada)).toEqual([]);

    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [slot(periods.mediodia, "12:00", "16:00")]),
        AT,
        0,
      );
      await deletePeriod(tx, v.cfg, periods.noches, null, AT, 0);
    });
    expect(
      await db
        .select({ periodId: routingCellPeriods.periodId })
        .from(routingCellPeriods)
        .where(eq(routingCellPeriods.cellId, cocktailsEverywhere)),
    ).toEqual([{ periodId: periods.mediodia }]);
    expect(
      await db.select().from(routingCells).where(eq(routingCells.locationId, v.locationId)),
    ).toHaveLength(6);
    expect((await uses()).get(periods.mediodia)).toEqual([
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
    ]);
  });

  it("names each row by its path and lists the cells in the Routing tab's order", async () => {
    const v = await timed();
    const { periods } = v;
    await db.update(floorZones).set({ displayOrder: 5 }).where(eq(floorZones.id, v.sala));
    const [cocina] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, v.locationId));
    const { drinksCocktails, brunchCocktails, mojito, bread } = await scoped(async (tx) => {
      const drinks = (await createCategory(tx, { name: "Drinks" })).id;
      const brunch = (await createCategory(tx, { name: "Brunch" })).id;
      const product = async (name: string, categoryId: string | null) =>
        (
          await createProduct(tx, {
            catalogueId: v.menus.Copas,
            categoryId,
            name,
            pricingUnit: "each",
            unitPrice: "9.00",
            vatClass: "general",
          })
        ).id;
      const drinksCocktails = (await createCategory(tx, { name: "Cocktails", parentId: drinks }))
        .id;
      return {
        drinksCocktails,
        brunchCocktails: (await createCategory(tx, { name: "Cocktails", parentId: brunch })).id,
        mojito: await product("Mojito", drinksCocktails),
        bread: await product("Bread", null),
      };
    });
    for (const values of [
      { productId: bread },
      { noCategory: true },
      { productId: mojito, zoneId: v.terraza },
      { categoryId: drinksCocktails, zoneId: v.sala },
      { categoryId: drinksCocktails, zoneId: v.terraza },
      { categoryId: drinksCocktails },
      { categoryId: brunchCocktails },
      { zoneId: v.sala },
    ]) {
      const [cell] = await db
        .insert(routingCells)
        .values({ locationId: v.locationId, stationId: cocina!.id, ...values })
        .returning({ id: routingCells.id });
      await db.insert(routingCellPeriods).values({
        cellId: cell!.id,
        periodId: periods.noches,
        departmentId: v.restaurant,
        stationId: cocina!.id,
      });
    }
    const model = await scoped((tx) => readOpeningHoursModel(tx, v.cfg, AT));
    const noches = model.departments
      .find((department) => department.id === v.restaurant)!
      .periods.find((period) => period.id === periods.noches)!;
    expect(noches.routingUses).toEqual([
      { rowKind: "all", rowLabel: null, zoneName: "Sala" },
      { rowKind: "category", rowLabel: "Brunch › Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: "Terraza" },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: "Sala" },
      { rowKind: "product", rowLabel: "Drinks › Cocktails › Mojito", zoneName: "Terraza" },
      { rowKind: "no_category", rowLabel: null, zoneName: null },
      { rowKind: "product", rowLabel: "Bread", zoneName: null },
    ]);
  });
});

describe("a service period occurrence", () => {
  async function occurrenceVenue() {
    const v = await venue({ timetable: false });
    await db
      .update(locations)
      .set({ dayCutover: "06:00:00" })
      .where(eq(locations.id, v.locationId));
    const period = await scoped((tx) =>
      saveMenuPeriod(
        tx,
        v.cfg,
        v.restaurant,
        { name: "Same name", menuId: v.menus.Almuerzo, staffMenuIds: [] },
        0,
      ),
    );
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf(() => [
          slot(period.id, "12:00", "14:00"),
          slot(period.id, "18:00", "20:00"),
          slot(period.id, "22:00", "02:00"),
        ]),
        AT,
        0,
      ),
    );
    return { ...v, periodId: period.id };
  }

  it("distinguishes repeated days and runs and shares the authoritative key across zone offers and polls", async () => {
    const v = await occurrenceVenue();
    const key = (date: string, time: string) =>
      scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, madrid(date, time)));
    const lunch = await key(MONDAY, "13:00");
    expect(lunch.periodOccurrenceKey).toBe(
      JSON.stringify([v.restaurant, MONDAY, v.periodId, "12:00"]),
    );
    expect((await key(MONDAY, "13:30")).periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
    expect((await key(MONDAY, "18:30")).periodOccurrenceKey).toBe(
      JSON.stringify([v.restaurant, MONDAY, v.periodId, "18:00"]),
    );
    expect((await key(TUESDAY, "13:00")).periodOccurrenceKey).toBe(
      JSON.stringify([v.restaurant, TUESDAY, v.periodId, "12:00"]),
    );
    expect((await key(TUESDAY, "01:00")).periodOccurrenceKey).toBe(
      JSON.stringify([v.restaurant, MONDAY, v.periodId, "22:00"]),
    );
    for (const zoneId of [v.sala, v.barra]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, v.cfg, zoneId, { at: madrid(MONDAY, "13:00") }),
      );
      const poll = await scoped((tx) => menuState(tx, v.cfg, zoneId, madrid(MONDAY, "13:00")));
      expect(offers.service.periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
      expect(poll.service.periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
      expect(offers.defaultMenuId).toBe(v.menus.Almuerzo);
      expect(offers.menus.find((menu) => menu.id === v.menus.Almuerzo)).toMatchObject({
        isDefault: true,
        orderable: true,
        sendable: true,
      });
    }
    expect((await key(MONDAY, "16:00")).periodOccurrenceKey).toBeNull();
    await scoped((tx) =>
      tx.insert(periodExtensions).values({
        departmentId: v.restaurant,
        businessDay: MONDAY,
        periodId: v.periodId,
        startsAt: "14:00:00",
        endsAt: "15:00:00",
      }),
    );
    expect((await key(MONDAY, "14:30")).periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
    expect((await key(MONDAY, "15:00")).periodOccurrenceKey).toBeNull();
  });

  it("uses the actual special-day range and returns null without a readable clock or running period", async () => {
    const v = await occurrenceVenue();
    await saveDay(v, CHRISTMAS, { paint: [slot(v.periodId, "11:00", "16:00")] });
    expect(
      (
        await scoped((tx) =>
          resolveDepartmentService(tx, v.cfg, v.restaurant, madrid(CHRISTMAS, "13:00")),
        )
      ).periodOccurrenceKey,
    ).toBe(JSON.stringify([v.restaurant, CHRISTMAS, v.periodId, "11:00"]));
    expect(
      (
        await scoped((tx) =>
          resolveDepartmentService(tx, v.cfg, v.deli, madrid(CHRISTMAS, "13:00")),
        )
      ).periodOccurrenceKey,
    ).toBeNull();
    expect(
      (await scoped((tx) => menuState(tx, v.cfg, randomUUID(), madrid(CHRISTMAS, "13:00")))).service
        .periodOccurrenceKey,
    ).toBeNull();
    await db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.locationId));
    const service = await scoped((tx) => resolveDepartmentService(tx, v.cfg, v.restaurant, AT));
    expect(service.periodOccurrenceKey).toBeNull();
    expect(service.open).toBe(true);
    expect(service.orderableMenuIds).toEqual([v.menus.Almuerzo]);
  });

  it("leaves pricing-only offers without an occurrence or a venue clock read", async () => {
    const v = await occurrenceVenue();
    const read = (withDefault: boolean) =>
      scoped(async (tx) => {
        const session = (
          tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          const offers = await listZoneOffers(tx, v.cfg, v.sala, {
            at: madrid(MONDAY, "13:00"),
            ...(withDefault ? {} : { withDefault: false as const }),
          });
          const clockReads = prepared.mock.calls.filter(([query]) =>
            /from "locations"/.test((query as unknown as { sql: string }).sql),
          ).length;
          return { offers, clockReads };
        } finally {
          prepared.mockRestore();
        }
      });
    expect((await read(true)).clockReads).toBeGreaterThan(0);
    const pricing = await read(false);
    expect(pricing.clockReads).toBe(0);
    expect(pricing.offers.service.periodOccurrenceKey).toBeNull();
    expect(pricing.offers.defaultMenuId).toBeNull();
    expect(pricing.offers.menus.find((menu) => menu.id === v.menus.Almuerzo)).toMatchObject({
      orderable: true,
      sendable: true,
    });
  });
});
