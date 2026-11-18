import { stampFixtureLineContexts } from "./testing/zone-menus.js";
import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { seedPerson, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { beforeEach, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addProductToMenu,
  addMember,
  requireMenuRoot,
  buildMenuDocument,
  createMenu,
  createCategory,
  createProduct,
  menuDocumentHash,
  NO_LIVE_FIELDS,
  publishMenu,
} from "@waitron/menu";
import {
  CORE_MIGRATIONS,
  openingHours,
  menus,
  categories,
  floorZones,
  kitchenStations,
  menuPeriods,
  routingCellPeriods,
  routingCells,
  specialDayDates,
  withTransaction,
  workingOrderLines,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { occurrenceKey } from "./floor-layout-due.js";
import { addDays } from "./hours-rules.js";
import { CALENDAR_COLOURS } from "./hours-types.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import {
  readRoutingUses,
  placeOpenPeriod,
  readOpeningHoursModel,
  replaceMenuWeek,
  resolveDefaultMenu,
  resolveDepartmentService,
  saveMenuPeriod,
  updateMenuPeriod,
} from "./menu-timetable.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { deletePeriod } from "./period-delete.js";
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
} from "./operations.js";
import { offerMenuThroughZone } from "./testing/zone-menus.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";
import { starterSeasonName, type StarterSeason } from "./testing/starter-seasons.js";
import { STARTER_PERIOD_NAMES } from "./starter-content.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
beforeEach(async () => {
  await seedPerson(suite.db, { id: "person-1", displayName: "Test person-1" });
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
  "Breakfast",
  "Lunch",
  "Dinner",
  "Drinks",
  "Coffee",
  "Cocktails",
  "Nightcaps",
  "Christmas brunch",
  "Deli takeaway",
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
    const [staffMenu, previousDefault] = [v.menus.Breakfast, v.menus.Drinks].sort() as [
      string,
      string,
    ];
    await scoped(async (tx) => {
      await offerMenuThroughZone(tx, v.diningRoom, previousDefault);
      await offerMenuThroughZone(tx, v.diningRoom, staffMenu, { displayOrder: 9 });
      await offerMenuThroughZone(tx, v.diningRoom, v.menus.Coffee, { makeDefault: true });
    });
    const offers = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(MONDAY, "15:00") }));
    expect(offers.defaultMenuId).toBe(v.menus.Coffee);
    expect(
      offers.menus.map((menu) => ({
        id: menu.id,
        audience: menu.audience,
        orderable: menu.orderable,
      })),
    ).toEqual([
      { id: v.menus.Coffee, audience: "customer", orderable: true },
      { id: previousDefault, audience: "staff", orderable: true },
      { id: staffMenu, audience: "staff", orderable: true },
    ]);
    expect(
      (
        await db
          .select({ ids: menuPeriods.staffMenuIds })
          .from(menuPeriods)
          .where(eq(menuPeriods.departmentId, v.restaurant))
      ).flatMap((row) => row.ids),
    ).toEqual([previousDefault, staffMenu]);
  });

  it("keeps two menus orderable on both sides of midnight and both touching ranges", async () => {
    const v = await venue({ timetable: false });
    await scoped(async (tx) => {
      await offerMenuThroughZone(tx, v.diningRoom, v.menus.Breakfast, { makeDefault: true });
      await offerMenuThroughZone(tx, v.diningRoom, v.menus.Drinks);
    });
    for (const time of ["03:00", "06:00", "15:00", "18:00"])
      for (const zoneId of [v.diningRoom, v.bar]) {
        const offers = await scoped((tx) =>
          listZoneOffers(tx, zoneId, { at: madrid(MONDAY, time) }),
        );
        expect(offers.defaultMenuId).toBe(v.menus.Breakfast);
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
          },
        });
        expect(
          offers.menus.map((menu) => ({
            id: menu.id,
            audience: menu.audience,
            orderable: menu.orderable,
          })),
        ).toEqual([
          { id: v.menus.Breakfast, audience: "customer", orderable: true },
          { id: v.menus.Drinks, audience: "staff", orderable: true },
        ]);
      }
  });
});

describe("service-period writers", () => {
  it("returns only the new period id and updates without a response body", async () => {
    const v = await venue({ timetable: false });
    const created = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Lunch,
        staffMenuIds: [],
      }),
    );
    expect(created).toEqual({ id: expect.any(String) });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, created.id, { name: "Afternoon" })),
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
    await seedBusinessDay(db, { dayCutover: "02:30:00" });
    await saveDay(v, "2026-03-28", {
      paint: [
        { periodId: null, startsAt: "02:30", endsAt: "21:00" },
        slot(v.periods!.supper, "21:00", "02:30"),
      ],
    });
    const stored = await db
      .select({ startsAt: openingHours.startsAt, endsAt: openingHours.endsAt })
      .from(openingHours)

      .where(
        and(isNotNull(openingHours.specialDayDateId), eq(openingHours.periodId, v.periods!.supper)),
      );
    expect(stored).toEqual([{ startsAt: "21:00:00", endsAt: "02:30:00" }]);
    const running = await scoped((tx) =>
      resolveDepartmentService(tx, v.restaurant, new Date("2026-03-29T01:10:00Z")),
    );
    expect(running).toMatchObject({ open: true, periodId: v.periods!.supper });
    expect(running.orderableMenuIds).toContain(running.customerMenuId);
    expect(
      (
        await scoped((tx) =>
          resolveDepartmentService(tx, v.restaurant, new Date("2026-03-29T01:30:00Z")),
        )
      ).periodId,
    ).not.toBe(v.periods!.supper);
  });

  it("checks a start equal to the changeover on the business date", async () => {
    const v = await venue();
    await seedBusinessDay(db, { dayCutover: "02:30:00" });
    await saveDay(v, "2026-03-28", { paint: [slot(v.periods!.mornings, "02:30", "21:00")] });
    await expect(
      saveDay(v, "2026-03-29", { paint: [slot(v.periods!.mornings, "02:30", "21:00")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.startsAt", reason: "clock_skips", date: "2026-03-29" },
    });
    expect(await paintedRanges(v.periods!.mornings)).toEqual([
      { date: "2026-03-28", startsAt: "02:30:00", endsAt: "21:00:00" },
    ]);
  });

  it("always creates a new period even if an untyped caller sends an existing id", async () => {
    const v = await venue({ timetable: false });
    const original = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Lunch,
        staffMenuIds: [],
      }),
    );
    const created = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        id: original.id,
        name: "Afternoon",
        menuId: v.menus.Coffee,
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
      { id: created.id, name: "Afternoon", menuId: v.menus.Coffee },
      { id: original.id, name: "Lunch", menuId: v.menus.Lunch },
    ]);
  });

  it("refuses explicit null fields rather than treating them as omitted", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Drinks,
        staffMenuIds: [],
      }),
    );
    for (const field of ["colour", "staffMenuIds"] as const) {
      await expect(
        scoped((tx) => updateMenuPeriod(tx, id, { [field]: null } as never)),
      ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field } });
    }
  });

  it("uses the venue's changeover and refuses a range crossing the end of its business day", async () => {
    const v = await venue();
    await seedBusinessDay(db, { dayCutover: "08:00:00" });
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.restaurant,
          weekOf((day) => (day === 1 ? [slot(v.periods!.mornings, "07:00", "09:00")] : [])),
          AT,
          1,
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
          v.restaurant,
          weekOf((day) => (day === 1 ? [slot(v.periods!.mornings, "12:10", "14:00")] : [])),
          AT,
          1,
        ),
      ),
    ).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "days.1.slots", reason: "step" },
    });
    await expect(
      saveDay(v, CHRISTMAS, { paint: [slot(v.periods!.mornings, "12:00", "14:10")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges", reason: "step" },
    });
  });

  it("checks skipped times on the calendar date that owns each business-day endpoint", async () => {
    const v = await venue();
    await seedBusinessDay(db, { dayCutover: "06:00:00" });
    await expect(
      saveDay(v, "2026-03-28", { paint: [slot(v.periods!.supper, "21:00", "02:30")] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.endsAt", reason: "clock_skips", date: "2026-03-28" },
    });
    await saveDay(v, "2026-03-29", { paint: [slot(v.periods!.supper, "06:00", "02:30")] });
    expect(await paintedRanges(v.periods!.supper)).toEqual([
      { date: "2026-03-29", startsAt: "06:00:00", endsAt: "02:30:00" },
    ]);
  });

  it("keeps set menus out of both period pickers and refuses them in period writes", async () => {
    const v = await venue({ timetable: false });
    const [setMenu] = await db
      .insert(menus)
      .values({
        name: "Daily special",
        kind: "set_menu",
        setPrice: 1400,
        setVatClass: "reduced",
      })
      .returning({ id: menus.id });
    const setMenuId = setMenu!.id;
    const refusal = { code: "set_menu.wrong_place", params: { menuId: setMenuId } };
    const at = new Date("2026-11-18T12:00:00Z");
    const model = await scoped((tx) => readOpeningHoursModel(tx, at));
    expect(model.menus.map((menu) => menu.id)).toContain(v.menus.Lunch);
    expect(model.menus.map((menu) => menu.id)).not.toContain(setMenuId);

    const lunch = { name: "Lunch", menuId: v.menus.Lunch, staffMenuIds: [v.menus.Drinks] };
    await expect(
      scoped((tx) => saveMenuPeriod(tx, v.restaurant, { ...lunch, menuId: setMenuId })),
    ).rejects.toMatchObject(refusal);
    await expect(
      scoped((tx) => saveMenuPeriod(tx, v.restaurant, { ...lunch, staffMenuIds: [setMenuId] })),
    ).rejects.toMatchObject(refusal);

    const { id } = await scoped((tx) => saveMenuPeriod(tx, v.restaurant, lunch));
    await expect(
      scoped((tx) => updateMenuPeriod(tx, id, { menuId: setMenuId })),
    ).rejects.toMatchObject(refusal);
    await expect(
      scoped((tx) => updateMenuPeriod(tx, id, { staffMenuIds: [setMenuId] })),
    ).rejects.toMatchObject(refusal);
    const [period] = await db.select().from(menuPeriods).where(eq(menuPeriods.id, id));
    expect(period).toMatchObject({ menuId: v.menus.Lunch, staffMenuIds: [v.menus.Drinks] });
  });

  it.each([null, "beige", 1])("refuses an explicit invalid colour %s", async (colour) => {
    const v = await venue({ timetable: false });
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.restaurant, {
          name: "Lunch",
          menuId: v.menus.Drinks,
          staffMenuIds: [],
          colour: colour as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "colour" } });
  });

  it("refuses changing the customer menu to a retained staff menu and leaves the period untouched", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Drinks,
        staffMenuIds: [v.menus.Coffee],
        colour: "blue",
      }),
    );
    await expect(
      scoped((tx) => updateMenuPeriod(tx, id, { menuId: v.menus.Coffee })),
    ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "staffMenuIds" } });
    expect(
      await db
        .select({ menuId: menuPeriods.menuId, colour: menuPeriods.colour })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, id)),
    ).toEqual([{ menuId: v.menus.Drinks, colour: "blue" }]);
  });

  it("saves an active customer menu outside the old list, trims the name and keeps staff-menu order", async () => {
    const v = await venue({ timetable: false });
    const period = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: " Lunch ",
        menuId: v.menus["Deli takeaway"],
        staffMenuIds: [v.menus.Coffee, v.menus.Drinks],
      }),
    );
    expect(
      await db
        .select({ name: menuPeriods.name, colour: menuPeriods.colour, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, period.id)),
    ).toEqual([{ name: "Lunch", colour: "red", menuId: v.menus["Deli takeaway"] }]);
    const staff = async () =>
      (
        await db
          .select({ ids: menuPeriods.staffMenuIds })
          .from(menuPeriods)
          .where(eq(menuPeriods.id, period.id))
      ).flatMap((row) => row.ids.map((menuId, position) => ({ menuId, position })));
    expect(await staff()).toEqual([
      { menuId: v.menus.Coffee, position: 0 },
      { menuId: v.menus.Drinks, position: 1 },
    ]);
    await scoped((tx) =>
      updateMenuPeriod(tx, period.id, {
        staffMenuIds: [v.menus.Drinks, v.menus.Coffee],
        colour: "purple",
      }),
    );
    await scoped((tx) => updateMenuPeriod(tx, period.id, { name: " Afternoon " }));
    expect(await staff()).toEqual([
      { menuId: v.menus.Drinks, position: 0 },
      { menuId: v.menus.Coffee, position: 1 },
    ]);
    expect(
      await db
        .select({ name: menuPeriods.name, colour: menuPeriods.colour, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, period.id)),
    ).toEqual([{ name: "Afternoon", colour: "purple", menuId: v.menus["Deli takeaway"] }]);
    await scoped((tx) => updateMenuPeriod(tx, period.id, { staffMenuIds: [] }));
    expect(await staff()).toEqual([]);
  });

  it("saves and updates a period in a newer calendar colour", async () => {
    const v = await venue({ timetable: false });
    const { id } = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Drinks,
        staffMenuIds: [],
        colour: "indigo",
      }),
    );
    const colour = async () =>
      (
        await db
          .select({ colour: menuPeriods.colour })
          .from(menuPeriods)
          .where(eq(menuPeriods.id, id))
      )[0]!.colour;
    expect(await colour()).toBe("indigo");
    await scoped((tx) => updateMenuPeriod(tx, id, { colour: "brown" }));
    expect(await colour()).toBe("brown");
  });

  it("lets the colour CHECK take every calendar colour and refuses an unknown one", async () => {
    const v = await venue({ timetable: false });
    const insert = (colour: string) =>
      db.insert(menuPeriods).values({
        departmentId: v.restaurant,
        name: `Period ${colour}`,
        menuId: v.menus.Drinks,
        colour: colour as never,
      });
    for (const colour of CALENDAR_COLOURS) await insert(colour);
    await expect(insert("beige")).rejects.toThrow(
      "CHECK constraint failed: menu_periods_colour_ck",
    );
  });

  it("chooses the first unused department colour, repeating red after all of them", async () => {
    const v = await venue({ timetable: false });
    const colours = [];
    for (let index = 0; index < 17; index++) {
      const { id } = await scoped((tx) =>
        saveMenuPeriod(tx, v.restaurant, {
          name: `Period ${index}`,
          menuId: v.menus.Drinks,
          staffMenuIds: [],
        }),
      );
      const [row] = await db
        .select({ colour: menuPeriods.colour })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, id));
      colours.push(row!.colour);
    }
    expect(colours).toEqual([
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "purple",
      "magenta",
      "pink",
      "brown",
      "grey",
      "red",
    ]);
  });

  it.each(["customer", "staff"] as const)(
    "refuses an inactive %s menu without writing a period",
    async (kind) => {
      const v = await venue({ timetable: false });
      await db.update(menus).set({ active: false }).where(eq(menus.id, v.menus.Coffee));
      await expect(
        scoped((tx) =>
          saveMenuPeriod(tx, v.restaurant, {
            name: "Lunch",
            menuId: kind === "customer" ? v.menus.Coffee : v.menus.Drinks,
            staffMenuIds: kind === "staff" ? [v.menus.Coffee] : [],
          }),
        ),
      ).rejects.toMatchObject({
        code: "menu.not_found",
        params: { menuId: v.menus.Coffee },
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
          saveMenuPeriod(tx, v.restaurant, {
            name: "Lunch",
            menuId: v.menus.Drinks,
            staffMenuIds: kind === "customer" ? [v.menus.Drinks] : [v.menus.Coffee, v.menus.Coffee],
          }),
        ),
      ).rejects.toMatchObject({ code: "menu_period.invalid", params: { field: "staffMenuIds" } });
      expect(
        await db.select().from(menuPeriods).where(eq(menuPeriods.departmentId, v.restaurant)),
      ).toEqual([]);
    },
  );
});

/** A second call in one case reuses the venue's row and names its station, zones and departments
 * apart. */
async function venue(options: { timetable?: boolean; unpublished?: MenuName[] } = {}) {
  const existing = await readSettings(db, VENUE_SETTINGS);
  if (existing.revision === 0)
    await seedVenue(db, {
      name: `Venue ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      timeZone: ZONE,
    });
  const suffix = existing.revision === 0 ? "" : ` ${randomUUID()}`;
  const fixtureId = randomUUID();
  const cfg = {};
  await db
    .insert(kitchenStations)
    .values({ name: `Kitchen${suffix}`, isDefault: existing.revision === 0 });
  const zone = async (name: string, displayOrder: number, departmentId: string) =>
    (
      await db
        .insert(floorZones)
        .values({ name: `${name}${suffix}`, displayOrder, departmentId })
        .returning({ id: floorZones.id })
    )[0]!.id;
  return scoped(async (tx) => {
    const restaurant = (
      await createDepartment(tx, { name: `Restaurant${suffix}`, orderStart: "table" })
    ).id;
    const deli = (await createDepartment(tx, { name: `Deli${suffix}`, orderStart: "counter" })).id;
    const bar = await zone("Bar", 0, restaurant);
    const diningRoom = await zone("Dining room", 1, restaurant);
    const terrace = await zone("Terrace", 2, restaurant);
    const counter = await zone("Deli counter", 3, deli);
    for (const zoneId of [bar, diningRoom, terrace])
      await configureZone(tx, { zoneId, departmentId: restaurant });
    await configureZone(tx, { zoneId: counter, departmentId: deli });
    const menuRows = {} as Record<MenuName, string>;
    for (const name of MENU_NAMES) {
      menuRows[name] = (
        await createMenu(tx, {
          name: (await tx.select().from(menus)).some((menu) => menu.name === name)
            ? `${name} ${fixtureId}`
            : name,
        })
      ).id;
      if (!options.unpublished?.includes(name)) await publish(tx, menuRows[name]);
    }
    const v = { cfg, restaurant, deli, bar, diningRoom, terrace, counter, menus: menuRows };
    if (options.timetable === false) return { ...v, periods: null };
    const period = async (departmentId: string, name: string, menu: MenuName) =>
      (await saveMenuPeriod(tx, departmentId, { name, menuId: menuRows[menu], staffMenuIds: [] }))
        .id;
    const periods = {
      mornings: await period(restaurant, "Mornings", "Breakfast"),
      noon: await period(restaurant, "Noon", "Lunch"),
      supper: await period(restaurant, "Supper", "Dinner"),
      lateNight: await period(restaurant, "Late night", "Nightcaps"),
      brunch: await period(restaurant, "Festive brunch", "Christmas brunch"),
      deliMidday: await period(deli, "Deli noon", "Deli takeaway"),
    };
    await replaceMenuWeek(tx, restaurant, restaurantWeek(periods), AT, 1);
    await replaceMenuWeek(
      tx,
      deli,
      weekOf(() => [slot(periods.deliMidday, "12:00", "15:00")]),
      AT,
      1,
    );
    return { ...v, periods };
  });
}

type Periods = Record<"mornings" | "noon" | "supper" | "lateNight", string>;

/**
 * Monday to Friday Mornings 09:00–12:00, Noon 12:00–16:00 and Supper 18:00–20:00, plus
 * Late night 22:00–02:00 on Friday; Saturday and Sunday Noon 13:00–17:00 alone.
 */
function restaurantWeek(p: Periods, change: (weekday: number) => MenuSlot[] | null = () => null) {
  return weekOf(
    (weekday) =>
      change(weekday) ??
      (weekday === 0 || weekday === 6
        ? [slot(p.noon, "13:00", "17:00")]
        : [
            slot(p.mornings, "09:00", "12:00"),
            slot(p.noon, "12:00", "16:00"),
            slot(p.supper, "18:00", "20:00"),
            ...(weekday === 5 ? [slot(p.lateNight, "22:00", "02:00")] : []),
          ]),
  );
}

type Venue = Awaited<ReturnType<typeof venue>>;
type Timed = Venue & { periods: NonNullable<Venue["periods"]> };
const timed = async (options: { unpublished?: MenuName[] } = {}) => (await venue(options)) as Timed;

const resolve = (zoneId: string, at: Date) =>
  scoped(async (tx) => {
    const zone = await resolveZoneContext(tx, zoneId);
    return resolveDepartmentService(tx, zone.departmentId, at);
  });
/** The default and the period in force, the two fields the cases below vary. */
const choice = async (zoneId: string, at: Date) => {
  const { customerMenuId: defaultMenuId, periodId } = await resolve(zoneId, at);
  return { defaultMenuId, periodId };
};

/** The special-day paint ranges that place `periodId`, by date. */
const paintedRanges = (periodId: string) =>
  db
    .select({
      date: specialDayDates.date,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
    })
    .from(openingHours)

    .innerJoin(specialDayDates, eq(specialDayDates.id, openingHours.specialDayDateId))
    .where(eq(openingHours.periodId, periodId))
    .orderBy(specialDayDates.date, openingHours.startsAt);
/** Saves a special day on `date`, painting the restaurant's day with `paint` (none clears it). */
const saveDay = (
  v: Venue,
  date: string,
  options: { id?: string; closedAllDay?: boolean; paint?: PaintRange[] } = {},
) =>
  scoped((tx) =>
    saveSpecialDay(
      tx,
      options.id ?? null,
      {
        name: `Special ${date}`,
        repeatsYearly: false,
        dates: [{ date, closedAllDay: options.closedAllDay ?? false }],
        paint: [{ departmentId: v.restaurant, date, ranges: options.paint ?? [] }],
      },
      AT,
      1,
    ),
  );

const invalid = (field: string, extra: Record<string, string> = {}) => ({
  code: "menu_timetable.invalid",
  params: { field, ...extra },
});

describe("the menu a zone starts on", () => {
  it("follows the week's named periods, start included and end excluded, closing in a gap", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.diningRoom, { at: madrid(MONDAY, "10:00") }),
    );
    expect(offers.defaultMenuId).toBe(menuRows.Breakfast);
    expect(offers.service).toEqual({
      open: true,
      zoneOpen: true,
      zoneKeepOpen: null,
      periodName: "Mornings",
      periodOccurrenceKey: expect.any(String),
      keepOpen: {
        periodId: periods.mornings,
        periodName: "Mornings",
        endsAt: "12:00",
        running: true,
      },
    });
    expect(offers.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      menuRows.Breakfast,
    ]);
    expect(await choice(v.diningRoom, madrid(MONDAY, "12:00"))).toEqual({
      defaultMenuId: menuRows.Lunch,
      periodId: periods.noon,
    });
    expect(await choice(v.diningRoom, madrid(MONDAY, "11:59"))).toEqual({
      defaultMenuId: menuRows.Breakfast,
      periodId: periods.mornings,
    });
    for (const time of ["16:00", "17:00"])
      expect(await choice(v.diningRoom, madrid(MONDAY, time))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("uses the department's customer menu in every zone, with the same ordered staff menus", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.periods.mornings, {
        staffMenuIds: [v.menus.Coffee, v.menus.Drinks],
      }),
    );
    for (const zoneId of [v.bar, v.diningRoom, v.terrace]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, zoneId, { at: madrid(MONDAY, "10:00") }),
      );
      expect(offers.defaultMenuId).toBe(v.menus.Breakfast);
      expect(offers.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
        v.menus.Breakfast,
        v.menus.Coffee,
        v.menus.Drinks,
      ]);
    }
  });

  it("keeps a department's period menu on every day the period runs, after only Monday's slots were edited", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 1
            ? [
                slot(periods.mornings, "08:30", "12:00"),
                slot(periods.noon, "12:00", "16:00"),
                slot(periods.supper, "18:00", "20:00"),
              ]
            : null,
        ),
        AT,
        1,
      );
    });
    expect(await choice(v.bar, madrid(TUESDAY, "10:00"))).toEqual({
      defaultMenuId: menuRows.Breakfast,
      periodId: periods.mornings,
    });
    expect(await choice(v.bar, madrid(MONDAY, "08:45"))).toEqual({
      defaultMenuId: menuRows.Breakfast,
      periodId: periods.mornings,
    });
  });

  it("closes every zone in a department between periods while keeping its published menus", async () => {
    const v = await timed();
    for (const zoneId of [v.bar, v.diningRoom, v.terrace]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, zoneId, { at: madrid(MONDAY, "17:00") }),
      );
      expect(offers.defaultMenuId).toBeNull();
      expect(offers.service.open).toBe(false);
      expect(offers.menus).toHaveLength(5);
      expect(offers.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
    }
  });

  it("reads the weekend's own slots, and a Friday slot past midnight on Saturday until it ends", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    expect(await choice(v.diningRoom, madrid(SATURDAY, "10:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect(await choice(v.diningRoom, madrid(SATURDAY, "13:00"))).toEqual({
      defaultMenuId: menuRows.Lunch,
      periodId: periods.noon,
    });
    expect(await choice(v.diningRoom, madrid(SATURDAY, "01:00"))).toEqual({
      defaultMenuId: menuRows.Nightcaps,
      periodId: periods.lateNight,
    });
    expect(await choice(v.diningRoom, madrid(SATURDAY, "02:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
  });

  it("follows the clock's own reading on a day it changes", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const backward = clockChangeAfter(ZONE, "2027-07-01T00:00:00Z", "backward");
    const precedingBusinessDay = (slots: MenuSlot[]) =>
      restaurantWeek(periods, (weekday) =>
        weekday === 6 ? [slot(periods.noon, "13:00", "17:00"), ...slots] : null,
      );
    const skipped = minutesAfter(forward.before, 16);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        precedingBusinessDay([slot(periods.lateNight, skipped, "04:00")]),
        AT,
        1,
      ),
    );
    expect(await choice(v.diningRoom, forward.instant)).toEqual({
      defaultMenuId: menuRows.Nightcaps,
      periodId: periods.lateNight,
    });
    expect(await choice(v.diningRoom, new Date(forward.instant.getTime() - 60_000))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });

    const boundary = minutesAfter(backward.after, 30);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        precedingBusinessDay([
          slot(periods.lateNight, "00:30", boundary),
          slot(periods.mornings, boundary, "05:00"),
        ]),
        AT,
        1,
      ),
    );
    for (const occurrence of [0, 1]) {
      const at = (time: string) => madrid(backward.date, time, occurrence);
      expect((await resolve(v.diningRoom, at(backward.after))).periodId).toBe(periods.lateNight);
      expect((await resolve(v.diningRoom, at(minutesAfter(boundary, -1)))).periodId).toBe(
        periods.lateNight,
      );
      expect((await resolve(v.diningRoom, at(boundary))).periodId).toBe(periods.mornings);
      expect((await resolve(v.diningRoom, at(minutesAfter(boundary, 15)))).periodId).toBe(
        periods.mornings,
      );
    }
  });

  it("applies no slot when the venue's clock cannot be read", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      await tx.execute(
        sql`update settings set doc = json_set(doc, '$.timeZone', 'Mars/Base') where module = 'business_day'`,
      );
    });
    for (const zoneId of [v.diningRoom, v.bar])
      expect(await choice(zoneId, madrid(MONDAY, "10:00"))).toEqual({
        defaultMenuId: null,
        periodId: null,
      });
  });

  it("is refused for a zone of an inactive department", async () => {
    const v = await timed();
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
    await expect(resolve(v.counter, madrid(MONDAY, "12:30"))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: v.counter },
    });
  });

  it("leaves an inactive menu out of the list while a period still names it as the default", async () => {
    const v = await timed();
    await scoped((tx) =>
      tx.update(menus).set({ active: false }).where(eq(menus.id, v.menus.Breakfast)),
    );
    const resolved = await resolve(v.diningRoom, madrid(MONDAY, "10:00"));
    expect(resolved.orderableMenuIds).toEqual([v.menus.Breakfast]);
    expect(resolved.customerMenuId).toBe(v.menus.Breakfast);
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.diningRoom, { at: madrid(MONDAY, "10:00") }),
    );
    expect(offers.defaultMenuId).toBeNull();
    expect(offers.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });
});

describe("a special date's menu timetable", () => {
  it("replaces the department's week that date, an empty one closing the department all day", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    const christmas = await saveDay(v, CHRISTMAS, {
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "11:00" },
        slot(periods.brunch, "11:00", "15:00"),
        { periodId: null, startsAt: "15:00", endsAt: "06:00" },
      ],
    });
    const at = (time: string) => madrid(CHRISTMAS, time);
    expect(await choice(v.diningRoom, at("10:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect(await choice(v.diningRoom, at("12:00"))).toEqual({
      defaultMenuId: menuRows["Christmas brunch"],
      periodId: periods.brunch,
    });
    expect(await choice(v.diningRoom, at("16:00"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });
    expect((await resolve(v.diningRoom, madrid("2026-12-26", "01:00"))).periodId).toBeNull();
    // Deli has no timetable of its own that date, so it follows its week.
    expect(await choice(v.counter, at("12:00"))).toEqual({
      defaultMenuId: menuRows["Deli takeaway"],
      periodId: periods.deliMidday,
    });

    await saveDay(v, CHRISTMAS, {
      id: christmas.id,
      paint: [
        { periodId: null, startsAt: "06:00", endsAt: "09:00" },
        slot(periods.mornings, "09:00", "11:00"),
        { periodId: null, startsAt: "11:00", endsAt: "06:00" },
      ],
    });
    expect(await choice(v.bar, at("10:00"))).toEqual({
      defaultMenuId: menuRows.Breakfast,
      periodId: periods.mornings,
    });

    await saveDay(v, CHRISTMAS, {
      id: christmas.id,
      paint: [{ periodId: null, startsAt: "06:00", endsAt: "06:00" }],
    });
    for (const time of ["10:00", "12:00"])
      expect(await choice(v.diningRoom, at(time))).toEqual({
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
      saveDay(v, date, { paint: [slot(v.periods.mornings, "00:30", skipped)] }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges.0.endsAt", reason: "clock_skips", date },
    });
    await expect(
      saveDay(v, date, {
        paint: [
          slot(v.periods.lateNight, "00:00", "00:30"),
          slot(v.periods.mornings, skipped, "05:00"),
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

  it("refuses a department that does not exist", async () => {
    const v = await timed();
    const departmentId = randomUUID();
    await expect(saveDay({ ...v, restaurant: departmentId }, CHRISTMAS)).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId },
    });
  });
});

describe("the timetable's writers", () => {
  it("checks structural ranges but skips clock-gap checks when the clock cannot be read", async () => {
    const v = await timed();
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"Mars/Base"}) where module = 'business_day'`,
    );
    const date = await saveDay(v, "2027-03-27", {
      paint: [slot(v.periods.mornings, "00:30", "02:30")],
    });
    expect(await paintedRanges(v.periods.mornings)).toEqual([
      { date: "2027-03-27", startsAt: "00:30:00", endsAt: "02:30:00" },
    ]);
    await expect(
      saveDay(v, "2027-03-27", {
        id: date.id,
        paint: [slot(v.periods.mornings, "01:00", "12:00")],
      }),
    ).rejects.toMatchObject({
      code: "special_day.invalid",
      params: { field: "paint.0.ranges", reason: "order" },
    });
  });

  it("refuse a period, menu or slot from another department, and an unknown period", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    const absentMenu = randomUUID();
    await scoped((tx) =>
      updateMenuPeriod(tx, periods.supper, { name: "Dinners", menuId: menuRows.Dinner }),
    );
    expect(
      await scoped((tx) => updateMenuPeriod(tx, periods.supper, { menuId: menuRows.Cocktails })),
    ).toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, periods.supper)),
    ).toEqual([{ name: "Dinners", menuId: menuRows.Cocktails }]);
    expect(
      await scoped((tx) => updateMenuPeriod(tx, periods.supper, { name: "Late supper" })),
    ).toBeUndefined();
    expect(
      await db
        .select({ name: menuPeriods.name, menuId: menuPeriods.menuId })
        .from(menuPeriods)
        .where(eq(menuPeriods.id, periods.supper)),
    ).toEqual([{ name: "Late supper", menuId: menuRows.Cocktails }]);
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    const restaurant = model.departments.find((entry) => entry.id === v.restaurant)!;
    expect(restaurant.periods.find((period) => period.id === periods.supper)).toMatchObject({
      name: "Late supper",
      menuId: menuRows.Cocktails,
    });
    // A partial update is still checked like a whole one.
    await expect(
      scoped((tx) => updateMenuPeriod(tx, periods.supper, { menuId: absentMenu })),
    ).rejects.toMatchObject({
      code: "menu.not_found",
      params: { menuId: absentMenu },
    });
    await expect(
      scoped((tx) => updateMenuPeriod(tx, periods.supper, { name: "  " })),
    ).rejects.toMatchObject(invalid("name"));
  });

  it("changes a period's menus without a department membership list and preserves other periods", async () => {
    const v = await timed();
    await scoped((tx) =>
      updateMenuPeriod(tx, v.periods.mornings, {
        menuId: v.menus.Coffee,
        staffMenuIds: [v.menus.Drinks],
      }),
    );
    for (const zoneId of [v.bar, v.diningRoom, v.terrace])
      expect(await choice(zoneId, madrid(MONDAY, "10:00"))).toEqual({
        defaultMenuId: v.menus.Coffee,
        periodId: v.periods.mornings,
      });
    expect(await choice(v.bar, madrid(MONDAY, "12:30"))).toEqual({
      defaultMenuId: v.menus.Lunch,
      periodId: v.periods.noon,
    });
  });

  it("keeps each business day independent of neighbouring special dates", async () => {
    const v = await timed();
    const { periods } = v;
    const fridayTail = (endsAt: string) =>
      restaurantWeek(periods, (weekday) =>
        weekday === 5
          ? [slot(periods.mornings, "09:00", "12:00"), slot(periods.lateNight, "22:00", endsAt)]
          : null,
      );
    // Saturday 3 October is past at AT: its clash with the Friday before is history.
    await saveDay(v, "2026-10-03", { paint: [slot(periods.mornings, "01:00", "03:00")] });
    await scoped((tx) => replaceMenuWeek(tx, v.restaurant, fridayTail("03:00"), AT, 1));
    await scoped((tx) => replaceMenuWeek(tx, v.restaurant, fridayTail("02:00"), AT, 1));
    // Tuesday 6 October is yesterday at AT, so it is read, but its pair with Monday is past.
    await saveDay(v, "2026-10-06", { paint: [slot(periods.mornings, "01:00", "03:00")] });
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        restaurantWeek(periods, (weekday) =>
          weekday === 1 ? [slot(periods.lateNight, "22:00", "03:00")] : null,
        ),
        AT,
        1,
      ),
    );
    await scoped((tx) => replaceMenuWeek(tx, v.restaurant, fridayTail("02:00"), AT, 1));

    await saveDay(v, "2026-10-24", { paint: [slot(periods.mornings, "02:30", "05:00")] });
    await scoped((tx) => replaceMenuWeek(tx, v.restaurant, fridayTail("03:00"), AT, 1));
    // The replacement week was written.
    expect((await resolve(v.diningRoom, madrid("2026-10-31", "02:30"))).periodId).toBe(
      periods.lateNight,
    );
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.restaurant, weekOf(() => []).slice(1), AT, 1)),
    ).rejects.toMatchObject(invalid("days"));
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.restaurant,
          weekOf(() => []),
          AT,
          1,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          randomUUID(),
          weekOf(() => []),
          AT,
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "department.not_found" });
  });

  it("deleting a painted period removes its staff menus", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    await scoped((tx) =>
      updateMenuPeriod(tx, periods.supper, { staffMenuIds: [menuRows.Cocktails] }),
    );
    expect(
      (
        await db
          .select({ ids: menuPeriods.staffMenuIds })
          .from(menuPeriods)
          .where(eq(menuPeriods.id, periods.supper))
      ).flatMap((row) => row.ids.map((menuId) => ({ menuId }))),
    ).toEqual([{ menuId: menuRows.Cocktails }]);
    await scoped((tx) => deletePeriod(tx, periods.supper, null, AT, 1));
    expect(await db.select().from(menuPeriods).where(eq(menuPeriods.id, periods.supper))).toEqual(
      [],
    );
  });
});

describe("the opening-hours model's seasons", () => {
  it("lists the seasons, every season's week, and the current season's week by business day", async () => {
    const v = await venue({ timetable: false });
    const seasons = await scoped(async (tx) => {
      const dinner = (
        await saveMenuPeriod(tx, v.restaurant, {
          name: "Dinner",
          menuId: v.menus.Dinner,
          staffMenuIds: [],
        })
      ).id;
      await replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf(() => []),
        AT,
        1,
      );
      const winter = (await readSeasons(tx)).find(
        (season) => season.name === starterSeasonName("Winter", "es"),
      )!;
      await replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf((weekday) => (weekday === 5 ? [slot(dinner, "20:00", "23:00")] : [])),
        AT,
        1,
        { seasonId: winter.id },
      );
      await replaceZoneClosedWeek(
        tx,
        v.diningRoom,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          ranges: weekday === 5 ? [{ startsAt: "16:00", endsAt: "18:00" }] : [],
        })),
        1,
        AT,
        { seasonId: winter.id },
      );
      return { dinner, all: await readSeasons(tx) };
    });
    const id = (name: StarterSeason) =>
      seasons.all.find((season) => season.name === starterSeasonName(name, "es"))!.id;
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

    const december = await scoped((tx) => readOpeningHoursModel(tx, madrid("2026-12-04", "12:00")));
    expect(december.seasons).toEqual([
      {
        id: id("Spring"),
        name: starterSeasonName("Spring", "es"),
        startsOn: "03-01",
        colour: "green",
      },
      {
        id: id("Summer"),
        name: starterSeasonName("Summer", "es"),
        startsOn: "06-01",
        colour: "amber",
      },
      {
        id: id("Autumn"),
        name: starterSeasonName("Autumn", "es"),
        startsOn: "09-01",
        colour: "orange",
      },
      {
        id: id("Winter"),
        name: starterSeasonName("Winter", "es"),
        startsOn: "12-01",
        colour: "blue",
      },
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
    expect(
      restaurant.seasonWeeks.flatMap(({ week }) =>
        week
          .filter(({ slots }) => slots.some(({ periodId }) => periodId === seasons.dinner))
          .map(({ weekday }) => weekday),
      ),
    ).toEqual([5]);
    const diningRoom = restaurant.zones.find((zone) => zone.id === v.diningRoom)!;
    expect(diningRoom.seasonWeeks).toEqual([
      { seasonId: id("Spring"), week: empty("ranges") },
      { seasonId: id("Summer"), week: empty("ranges") },
      { seasonId: id("Autumn"), week: empty("ranges") },
      { seasonId: id("Winter"), week: closedFriday },
    ]);
    expect(
      diningRoom.seasonWeeks.find((entry) => entry.seasonId === december.currentSeasonId)!.week,
    ).toEqual(closedFriday);

    const july = await scoped((tx) => readOpeningHoursModel(tx, madrid("2026-07-03", "12:00")));
    expect(july.currentSeasonId).toBe(id("Summer"));
    const summer = july.departments.find((department) => department.id === v.restaurant)!;
    expect(
      summer.seasonWeeks.find((entry) => entry.seasonId === july.currentSeasonId)!.week[5],
    ).toEqual({ weekday: 5, slots: [] });
    expect(
      summer.zones
        .find((zone) => zone.id === v.diningRoom)!
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
        v.restaurant,
        weekOf(() => []),
        AT,
        1,
      ),
    );
    const ids = await scoped((tx) => readSeasons(tx));
    const model = await scoped((tx) => readOpeningHoursModel(tx, madrid("2026-12-01", "03:00")));
    expect(model.currentSeasonId).toBe(
      ids.find((season) => season.name === starterSeasonName("Autumn", "es"))!.id,
    );
  });

  it("when the clock cannot be read, has no current season and still lists the first season's week", async () => {
    const v = await venue({ timetable: false });
    const spring = await scoped(async (tx) => {
      const dinner = (
        await saveMenuPeriod(tx, v.restaurant, {
          name: "Dinner",
          menuId: v.menus.Dinner,
          staffMenuIds: [],
        })
      ).id;
      await replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf(() => []),
        AT,
        1,
      );
      const first = (await readSeasons(tx))[0]!;
      await replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf((weekday) => (weekday === 2 ? [slot(dinner, "20:00", "23:00")] : [])),
        AT,
        1,
        { seasonId: first.id },
      );
      await tx.execute(
        sql`update settings set doc = json_set(doc, '$.timeZone', 'Mars/Base') where module = 'business_day'`,
      );
      return { dinner, first };
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(spring.first.name).toBe(starterSeasonName("Spring", "es"));
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
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.seasons).toEqual([]);
    expect(model.currentSeasonId).toBeNull();
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.seasonWeeks).toEqual([]);
    expect(restaurant.zones.find((zone) => zone.id === v.diningRoom)!.seasonWeeks).toEqual([]);
  });
});

describe("a period no longer placed anywhere but a past special day", () => {
  it("a period painted only on a past special day has no weekly paint and is deleted with its special-day paint", async () => {
    const v = await timed();
    const { periods } = v;
    await saveDay(v, "2025-12-25", {
      paint: [slot(periods.brunch, "11:00", "15:00")],
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(
      restaurant.seasonWeeks.flatMap(({ week }) =>
        week.flatMap(({ slots }) => slots.filter(({ periodId }) => periodId === periods.brunch)),
      ),
    ).toEqual([]);

    await scoped((tx) => deletePeriod(tx, periods.brunch, null, AT, 1));
    expect(await db.select().from(menuPeriods).where(eq(menuPeriods.id, periods.brunch))).toEqual(
      [],
    );
  });
});

describe("a zone moved to another department", () => {
  it("uses the new department's current period and preserves the other zone's menus", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      await configureZone(tx, { zoneId: v.bar, departmentId: v.deli });
    });
    const at = madrid(MONDAY, "13:00");
    const moved = await scoped((tx) => listZoneOffers(tx, v.bar, { at }));
    expect(moved.defaultMenuId).toBe(v.menus["Deli takeaway"]);
    expect(moved.menus.map((menu) => menu.id)).toEqual([v.menus["Deli takeaway"]]);
    const other = await scoped((tx) => listZoneOffers(tx, v.terrace, { at }));
    expect(other.defaultMenuId).toBe(v.menus.Lunch);
    expect(other.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      v.menus.Lunch,
    ]);
  });

  it("keeps period membership when a zone is configured again within its department", async () => {
    const v = await timed();
    const before = await scoped((tx) => readOpeningHoursModel(tx, AT));
    await scoped((tx) => configureZone(tx, { zoneId: v.bar, departmentId: v.restaurant }));
    expect(await scoped((tx) => readOpeningHoursModel(tx, AT))).toEqual(before);
    expect(await choice(v.bar, madrid(MONDAY, "10:00"))).toEqual({
      defaultMenuId: v.menus.Breakfast,
      periodId: v.periods.mornings,
    });
  });
});

/** Adds Tortilla to Breakfast, republishes it, and records one Dining room order line from it. */
async function recordedLine(v: Timed) {
  const nodeId = await seedNode(db);
  await db.execute(sql`
    insert into units (id, seed_key, staff_name, staff_abbreviation, name, abbreviation, precision, hardware_unit)
    values (${randomUUID()}, 'each', 'Each', 'ea', '{"en":"each"}', '{"en":"ea"}', 0, null)`);
  return scoped(async (tx) => {
    const product = await createProduct(tx, {
      categoryId: null,
      name: "Tortilla",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "general",
    });
    const offer = await addProductToMenu(tx, {
      menuId: v.menus.Breakfast,
      productId: product.id,
      grossPrice: "4.50",
    });
    await publish(tx, v.menus.Breakfast);
    const orderId = randomUUID();
    await tx.execute(sql`
      insert into working_orders (id, source, node_id, order_number, opened_at, dining)
      values (${orderId}, 'dashboard', ${nodeId}, 1, ${AT.toISOString()}, 'eat_in')`);
    await recordOrderServiceContext(tx, orderId, v.diningRoom);
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
      takeawayVatClass: "general",
      lineTotal: 450,
      category: "Uncategorised",
    });
    await stampFixtureLineContexts(
      tx,
      orderId,
      [{ workingOrderLineId: lineId, menuItemId: offer.id }],
      await listZoneOffers(tx, v.diningRoom),
    );
  });
}

const lineContexts = () =>
  db.execute(sql`select * from working_order_lines where menu_item_id is not null order by id`);

/** The restaurant's painted day rows and ranges a special day holds on `date`. */
const paintOn = async (_v: Venue, date: string) => {
  const onDate = eq(specialDayDates.date, date);
  const days = await db
    .select({ id: openingHours.id })
    .from(openingHours)
    .innerJoin(specialDayDates, eq(specialDayDates.id, openingHours.specialDayDateId))
    .where(onDate);
  const ranges = await db
    .select({
      periodId: openingHours.periodId,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
    })
    .from(openingHours)

    .innerJoin(specialDayDates, eq(specialDayDates.id, openingHours.specialDayDateId))
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
        slot(periods.mornings, "09:00", "11:00"),
        { periodId: null, startsAt: "11:00", endsAt: "12:00" },
      ],
    });
    await saveDay(v, "2026-12-26", { paint: [slot(periods.mornings, "01:00", "03:00")] });
    const neighbour = await paintOn(v, "2026-12-26");
    expect(neighbour.ranges).toHaveLength(1);
    // The week runs Mornings until 12:00; the painted date closes at 11:00.
    expect(await choice(v.diningRoom, madrid(CHRISTMAS, "11:30"))).toEqual({
      defaultMenuId: null,
      periodId: null,
    });

    await saveDay(v, CHRISTMAS, { id: christmas.id });
    expect(await paintOn(v, CHRISTMAS)).toEqual({ days: 0, ranges: [] });
    expect(await choice(v.diningRoom, madrid(CHRISTMAS, "11:30"))).toEqual({
      defaultMenuId: v.menus.Breakfast,
      periodId: periods.mornings,
    });

    await scoped((tx) => deleteSpecialDay(tx, christmas.id, AT, 1));
    expect(await paintOn(v, CHRISTMAS)).toEqual({ days: 0, ranges: [] });
    expect(
      await db.select().from(specialDayDates).where(eq(specialDayDates.specialDayId, christmas.id)),
    ).toEqual([]);
    for (const time of ["10:00", "11:30"])
      expect(await choice(v.diningRoom, madrid(CHRISTMAS, time))).toEqual({
        defaultMenuId: v.menus.Breakfast,
        periodId: periods.mornings,
      });
    expect(await paintOn(v, "2026-12-26")).toEqual(neighbour);
    expect((await lineContexts()).rows).toEqual(recorded.rows);
  });
});

describe("the offers a zone lists at an instant", () => {
  it("marks the running period's default, falling back within its menus", async () => {
    const v = await timed();
    const at = madrid(MONDAY, "10:00");
    const offers = await scoped((tx) => listZoneOffers(tx, v.bar, { at }));
    expect(Object.keys(offers).sort()).toEqual([
      "defaultMenuId",
      "liveFields",
      "menus",
      "offers",
      "service",
      "setMenus",
    ]);
    expect(offers.setMenus).toEqual([]);
    expect(offers.defaultMenuId).toBe(v.menus.Breakfast);
    expect(offers.menus.filter((menu) => menu.isDefault).map((menu) => menu.id)).toEqual([
      v.menus.Breakfast,
    ]);
    const without = await scoped((tx) => listZoneOffers(tx, v.bar, { at, withDefault: false }));
    expect(without.defaultMenuId).toBeNull();
    expect(without.menus.some((menu) => menu.isDefault)).toBe(false);
    expect(without.menus.map((menu) => menu.id)).toEqual(offers.menus.map((menu) => menu.id));

    const unpublished = await timed({ unpublished: ["Breakfast"] });
    await scoped((tx) =>
      updateMenuPeriod(tx, unpublished.periods.mornings, {
        staffMenuIds: [unpublished.menus.Drinks],
      }),
    );
    const fallback = await scoped((tx) => listZoneOffers(tx, unpublished.bar, { at }));
    expect(fallback.defaultMenuId).toBe(unpublished.menus.Drinks);
  });

  it("resolves the default among the menus a caller already found served", async () => {
    const v = await timed();
    const at = madrid(MONDAY, "10:00");
    const served = (ids: string[]) => scoped((tx) => resolveDefaultMenu(tx, v.bar, at, ids));
    expect(await served([v.menus.Breakfast, v.menus.Coffee])).toBe(v.menus.Breakfast);
    expect(await served([v.menus.Drinks, v.menus.Breakfast])).toBe(v.menus.Breakfast);
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
        const offers = await listZoneOffers(tx, v.bar, { withDefault: false });
        expect(offers.service.zoneOpen).toBe(true);
        expect(
          spy.mock.calls
            .map(([query]) => (query as unknown as { sql: string }).sql)
            .filter((text) => /"opening_hours"/.test(text)),
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
    const before = await scoped((tx) => readOpeningHoursModel(tx, AT));
    const statements = await statementsOf((tx) =>
      configureZone(tx, { zoneId: v.bar, departmentId: v.deli }),
    );
    expect(statements.filter((text) => /"zone_(all_day|period)_menus"/.test(text))).toEqual([]);
    const moved = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(MONDAY, "13:00") }));
    expect(moved.menus.map((menu) => ({ id: menu.id, orderable: menu.orderable }))).toEqual([
      { id: v.menus["Deli takeaway"], orderable: true },
    ]);
    expect(moved.defaultMenuId).toBe(v.menus["Deli takeaway"]);
    const after = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(after.departments.map((department) => ({ ...department, zones: [] }))).toEqual(
      before.departments.map((department) => ({ ...department, zones: [] })),
    );
    expect(before.departments.find((d) => d.id === v.restaurant)!.zones.map((z) => z.id)).toEqual([
      v.bar,
      v.diningRoom,
      v.terrace,
    ]);
    expect(after.departments.find((d) => d.id === v.restaurant)!.zones.map((z) => z.id)).toEqual([
      v.diningRoom,
      v.terrace,
    ]);
    expect(after.departments.find((d) => d.id === v.deli)!.zones.map((z) => z.id)).toEqual([
      v.bar,
      v.counter,
    ]);
    const unchanged = await scoped((tx) =>
      listZoneOffers(tx, v.diningRoom, { at: madrid(MONDAY, "13:00") }),
    );
    expect(unchanged.defaultMenuId).toBe(v.menus.Lunch);
  });

  /** Twenty one-hour slots over Sunday and Monday, alternating the five Restaurant periods. */
  const twentySlots = (p: Timed["periods"]) => {
    const ids = [p.mornings, p.noon, p.supper, p.lateNight, p.brunch];
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
        v.restaurant,
        weekOf((weekday) => (weekday === 1 ? [slot(v.periods.mornings, "09:00", "12:00")] : [])),
        AT,
        1,
      ),
    );
    const few = await statementsOf((tx) => resolveDepartmentService(tx, v.restaurant, at));
    await scoped(async (tx) => {
      await replaceMenuWeek(tx, v.restaurant, twentySlots(v.periods), AT, 1);
      await updateMenuPeriod(tx, v.periods.supper, {
        staffMenuIds: [v.menus.Coffee, v.menus.Cocktails, v.menus.Drinks],
      });
    });
    const many = await statementsOf((tx) => resolveDepartmentService(tx, v.restaurant, at));
    expect(many).toHaveLength(few.length);
    const service = await scoped((tx) => resolveDepartmentService(tx, v.restaurant, at));
    expect(service.periodId).toBe(v.periods.supper);
    expect(service.orderableMenuIds).toEqual([
      v.menus.Dinner,
      v.menus.Coffee,
      v.menus.Cocktails,
      v.menus.Drinks,
    ]);
  });

  it("prices every period menu without reading ranges, dates or the venue clock", async () => {
    const plain = await timed();
    const busy = await timed();
    await scoped(async (tx) => {
      for (const v of [plain, busy])
        await updateMenuPeriod(tx, v.periods.mornings, { staffMenuIds: [v.menus.Drinks] });
      await replaceMenuWeek(
        tx,
        plain.restaurant,
        weekOf(() => []),
        AT,
        1,
      );
      await replaceMenuWeek(tx, busy.restaurant, twentySlots(busy.periods), AT, 1);
    });
    const read = (v: Timed) =>
      statementsOf((tx) =>
        listZoneOffers(tx, v.bar, { menuItemIds: [randomUUID()], withDefault: false }),
      );
    const none = await read(plain);
    const lots = await read(busy);
    const v = busy;
    expect(lots).toHaveLength(none.length);
    const runningPeriodReads = /"settings"/;
    expect(lots.filter((text) => runningPeriodReads.test(text))).toEqual([]);
    const priced = await scoped((tx) => listZoneOffers(tx, v.bar, { withDefault: false }));
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
        v.menus.Breakfast,
        v.menus.Lunch,
        v.menus.Dinner,
        v.menus.Nightcaps,
        v.menus["Christmas brunch"],
        v.menus.Drinks,
      ].sort(),
    );
    expect(priced.menus.every((menu) => menu.orderable && !menu.isDefault)).toBe(true);
    const withDefault = await statementsOf((tx) => listZoneOffers(tx, v.bar));
    expect(withDefault.some((text) => runningPeriodReads.test(text))).toBe(true);
  });
});

describe("the editor's model", () => {
  it("lists a venue with no periods and no seasons, and no department season weeks", async () => {
    await venue({ timetable: false });
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.seasons).toEqual([]);
    for (const department of model.departments) {
      expect(department.periods).toEqual([]);
      expect(department.seasonWeeks).toEqual([]);
    }
  });

  it("names every menu with whether it is active, for a venue viewer who cannot read the menus", async () => {
    const v = await venue({ timetable: false });
    await scoped((tx) =>
      tx.update(menus).set({ active: false }).where(eq(menus.id, v.menus.Dinner)),
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.menus.map((menu) => menu.name).sort()).toEqual(Object.keys(v.menus).sort());
    expect(model.menus.find((menu) => menu.id === v.menus.Dinner)).toEqual({
      id: v.menus.Dinner,
      name: "Dinner",
      active: false,
      includes: [],
    });
    expect(model.menus.filter((menu) => !menu.active)).toHaveLength(1);
  });

  it("lists every department, its periods with their days and its season weeks", async () => {
    const v = await timed();
    const { menus: menuRows, periods } = v;
    await scoped(async (tx) => {
      await (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })();
    });
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    const seasonIds = (await scoped((tx) => readSeasons(tx))).map((season) => season.id);
    const inEverySeason = <T>(week: T) => seasonIds.map((seasonId) => ({ seasonId, week }));

    expect(model.dayCutover).toBe("06:00");
    expect(model.departments.map((department) => department.id)).toEqual(
      (await scoped((tx) => listDepartments(tx))).map((department) => department.id),
    );
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      active: true,
      zones: [
        {
          id: v.bar,
          name: "Bar",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.diningRoom,
          name: "Dining room",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.terrace,
          name: "Terrace",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
      ],
      periods: [
        {
          id: periods.brunch,
          name: "Festive brunch",
          menuId: menuRows["Christmas brunch"],
          colour: "lime",
          staffMenuIds: [],
          floorPlanSetId: null,
        },
        {
          id: periods.lateNight,
          name: "Late night",
          menuId: menuRows.Nightcaps,
          colour: "yellow",
          staffMenuIds: [],
          floorPlanSetId: null,
        },
        {
          id: periods.mornings,
          name: "Mornings",
          menuId: menuRows.Breakfast,
          colour: "red",
          staffMenuIds: [],
          floorPlanSetId: null,
        },
        {
          id: periods.noon,
          name: "Noon",
          menuId: menuRows.Lunch,
          colour: "orange",
          staffMenuIds: [],
          floorPlanSetId: null,
        },
        {
          id: periods.supper,
          name: "Supper",
          menuId: menuRows.Dinner,
          colour: "amber",
          staffMenuIds: [],
          floorPlanSetId: null,
        },
      ],
      seasonWeeks: inEverySeason(restaurantWeek(periods)),
    });
    expect(model.departments.find((department) => department.id === v.deli)).toBeUndefined();
    expect(
      await db.select().from(menuPeriods).where(eq(menuPeriods.id, periods.deliMidday)),
    ).toContainEqual(expect.objectContaining({ id: periods.deliMidday, departmentId: v.deli }));
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
        /from "settings"/.test((query as unknown as { sql: string }).sql),
      ).length;
      prepared.mockRestore();
      return reads;
    });

  it("is read once when ranges need it", async () => {
    const v = await timed();
    const { periods } = v;
    expect(
      await clockReads((tx) => replaceMenuWeek(tx, v.restaurant, restaurantWeek(periods), AT, 1)),
    ).toBe(1);
  });
});

describe("department service periods", () => {
  const FRIDAY = "2026-10-16";
  const serviceVenue = async () => {
    const v = await venue({ timetable: false });
    await seedBusinessDay(db, { dayCutover: "06:00:00" });
    return scoped(async (tx) => {
      const lunch = (
        await saveMenuPeriod(tx, v.restaurant, {
          name: "Lunch",
          colour: "blue",
          menuId: v.menus.Lunch,
          staffMenuIds: [v.menus.Drinks, v.menus.Coffee],
        })
      ).id;
      const afternoon = (
        await saveMenuPeriod(tx, v.restaurant, {
          name: "Afternoon",
          colour: "amber",
          menuId: v.menus.Coffee,
          staffMenuIds: [],
        })
      ).id;
      const night = (
        await saveMenuPeriod(tx, v.restaurant, {
          name: "Night",
          colour: "grey",
          menuId: v.menus.Dinner,
          staffMenuIds: [],
        })
      ).id;
      await replaceMenuWeek(
        tx,
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
        1,
      );
      return { ...v, lunch, afternoon, night };
    });
  };
  type ServiceVenue = Awaited<ReturnType<typeof serviceVenue>>;
  const read = (v: ServiceVenue, date: string, time: string) =>
    scoped((tx) => resolveDepartmentService(tx, v.restaurant, madrid(date, time)));

  it("keys the running period's occurrence as the floor layout rule does", async () => {
    const v = await serviceVenue();
    expect((await read(v, FRIDAY, "13:00")).periodOccurrenceKey).toBe(
      occurrenceKey(v.restaurant, FRIDAY, {
        periodId: v.lunch,
        startsAt: "12:00",
        endsAt: "14:00",
      }),
    );
  });

  it("offers the running merged run or the run that ended last today", async () => {
    const v = await serviceVenue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
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
        1,
      ),
    );
    expect(await read(v, FRIDAY, "11:59")).toMatchObject({ keepOpen: null });
    expect(await read(v, FRIDAY, "13:50")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: true,
      },
    });
    expect(await read(v, FRIDAY, "15:10")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: false,
      },
    });
    expect(await read(v, FRIDAY, "18:30")).toMatchObject({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "19:00",
        running: true,
      },
    });
  });

  it("does not offer keep-open when the venue clock cannot be read", async () => {
    const v = await serviceVenue();
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"not/a-zone"}) where module = 'business_day'`,
    );
    expect(await read(v, FRIDAY, "14:15")).toMatchObject({ open: true });
  });

  it("keeps all period menus once while marking the running customer and staff menus orderable", async () => {
    const v = await serviceVenue();
    await timed();
    const result = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "13:59") }));
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
      },
    });
    expect(result.defaultMenuId).toBe(v.menus.Lunch);
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
        { id: v.menus.Lunch, audience: "customer", orderable: true, isDefault: true },
        { id: v.menus.Drinks, audience: "staff", orderable: true, isDefault: false },
        { id: v.menus.Coffee, audience: "staff", orderable: true, isDefault: false },
        { id: v.menus.Dinner, audience: "customer", orderable: false, isDefault: false },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const afternoon = await scoped((tx) =>
      listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "14:00") }),
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
      },
    });
    expect(afternoon.menus.find((menu) => menu.id === v.menus.Coffee)).toMatchObject({
      audience: "customer",
      orderable: true,
      isDefault: true,
    });
    expect(afternoon.menus.filter((menu) => menu.orderable).map((menu) => menu.id)).toEqual([
      v.menus.Coffee,
    ]);
  });

  it("falls back only to a served menu of the running period when its customer menu is unpublished", async () => {
    const v = await timed({ unpublished: ["Breakfast"] });
    await scoped((tx) =>
      updateMenuPeriod(tx, v.periods.mornings, { staffMenuIds: [v.menus.Drinks] }),
    );
    const result = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(MONDAY, "10:00") }));
    expect(result.defaultMenuId).toBe(v.menus.Drinks);
    expect(result.menus.filter((menu) => menu.isDefault).map((menu) => menu.id)).toEqual([
      v.menus.Drinks,
    ]);
    expect(result.menus.find((menu) => menu.id === v.menus.Lunch)).toMatchObject({
      isDefault: false,
      orderable: false,
    });
    await scoped((tx) => updateMenuPeriod(tx, v.periods.mornings, { staffMenuIds: [] }));
    const unserved = await scoped((tx) =>
      listZoneOffers(tx, v.bar, { at: madrid(MONDAY, "10:00") }),
    );
    expect(unserved.service.open).toBe(true);
    expect(unserved.defaultMenuId).toBeNull();
    expect(unserved.menus).toHaveLength(4);
    expect(unserved.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });

  it("refuses an asserted menu version outside the period membership while retaining closed-period versions", async () => {
    const v = await serviceVenue();
    const running = await scoped((tx) =>
      listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "13:59") }),
    );
    const lunch = running.menus.find((menu) => menu.id === v.menus.Lunch)!;
    const asserted = [{ menuId: lunch.id, versionId: lunch.versionId }];
    const closed = await scoped((tx) =>
      listZoneOffers(tx, v.bar, {
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
      updateMenuPeriod(tx, v.lunch, {
        menuId: v.menus.Coffee,
        staffMenuIds: [v.menus.Drinks],
      }),
    );
    await expect(
      scoped((tx) => listZoneOffers(tx, v.bar, { asserted, withDefault: false })),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
    });
  });

  it("offers no department-list menus without periods", async () => {
    const v = await venue({ timetable: false });
    const result = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "13:59") }));
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
      setMenus: [],
      liveFields: NO_LIVE_FIELDS,
    });
  });

  it("keeps period menus for a stored basket when closed, with none orderable and no default", async () => {
    const v = await serviceVenue();
    const result = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "20:00") }));
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
      },
    });
    expect(result.defaultMenuId).toBeNull();
    expect(result.menus.map((menu) => menu.id).sort()).toEqual(
      [v.menus.Lunch, v.menus.Drinks, v.menus.Coffee, v.menus.Dinner].sort(),
    );
    expect(result.menus.every((menu) => !menu.orderable && !menu.isDefault)).toBe(true);
  });

  it("marks every period menu orderable when the venue clock cannot be read", async () => {
    const v = await serviceVenue();
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"Unreadable/Clock"}) where module = 'business_day'`,
    );
    const result = await scoped((tx) => listZoneOffers(tx, v.bar, { at: madrid(FRIDAY, "20:00") }));
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
        v.restaurant,
        weekOf(() => []),
        AT,
        1,
      ),
    );
    const issues = await scoped((tx) => listVenueReadiness(tx));
    expect(issues.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.deli, departmentName: "Deli" },
      { code: "department.no_periods", departmentId: v.restaurant, departmentName: "Restaurant" },
    ]);
    expect(issues.some((issue) => (issue.code as string) === "zone.menu_missing")).toBe(false);
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
    const after = await scoped((tx) => listVenueReadiness(tx));
    expect(after.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.restaurant, departmentName: "Restaurant" },
    ]);
  });

  it("readiness judges distinct published period menus and ignores the retired department list", async () => {
    const v = await serviceVenue();
    const issues = await scoped((tx) => listVenueReadiness(tx));
    expect(issues.filter((issue) => issue.code === "department.no_periods")).toEqual([
      { code: "department.no_periods", departmentId: v.deli, departmentName: "Deli" },
    ]);
    const bar = issues.filter((issue) => "zoneId" in issue && issue.zoneId === v.bar);
    expect(bar).toHaveLength(4);
    expect(bar.every((issue) => issue.code === "zone.menu_empty")).toBe(true);
    expect(
      bar.flatMap((issue) => (issue.code === "zone.menu_empty" ? [issue.menuId] : [])).sort(),
    ).toEqual([v.menus.Lunch, v.menus.Coffee, v.menus.Dinner, v.menus.Drinks].sort());
  });

  it("reads opening hours with period colours, ordered staff menus and all seven days", async () => {
    const v = await serviceVenue();
    await db.update(menuPeriods).set({ colour: "blue" }).where(eq(menuPeriods.id, v.lunch));
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${v.deli})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${v.deli}`);
      })(),
    );
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    const seasonIds = (await scoped((tx) => readSeasons(tx))).map((season) => season.id);
    const inEverySeason = <T>(week: T) => seasonIds.map((seasonId) => ({ seasonId, week }));
    expect(model.dayCutover).toBe("06:00");
    expect(model.departments.map((department) => department.id)).toEqual([v.restaurant]);
    expect(model.departments.find((department) => department.id === v.restaurant)).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      active: true,
      zones: [
        {
          id: v.bar,
          name: "Bar",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.diningRoom,
          name: "Dining room",
          seasonWeeks: inEverySeason(
            [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: [] })),
          ),
        },
        {
          id: v.terrace,
          name: "Terrace",
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
          menuId: v.menus.Coffee,
          staffMenuIds: [],
          floorPlanSetId: null,
        },
        {
          id: v.lunch,
          name: "Lunch",
          colour: "blue",
          menuId: v.menus.Lunch,
          staffMenuIds: [v.menus.Drinks, v.menus.Coffee],
          floorPlanSetId: null,
        },
        {
          id: v.night,
          name: "Night",
          colour: "grey",
          menuId: v.menus.Dinner,
          staffMenuIds: [],
          floorPlanSetId: null,
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
    await serviceVenue();
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model).toMatchObject({ timeZone: "Europe/Madrid", clockReadable: true });
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"unreadable"}) where module = 'business_day'`,
    );
    expect(await scoped((tx) => readOpeningHoursModel(tx, AT))).toMatchObject({
      timeZone: "unreadable",
      clockReadable: false,
    });
  });

  it("names direct menu inclusions without treating nested inclusions as direct", async () => {
    const v = await serviceVenue();
    await scoped(async (tx) => {
      const lunch = await requireMenuRoot(tx, v.menus.Lunch);
      const drinks = await requireMenuRoot(tx, v.menus.Drinks);
      const coffee = await requireMenuRoot(tx, v.menus.Coffee);
      await addMember(tx, lunch, { kind: "section", sectionId: drinks });
      await addMember(tx, drinks, { kind: "section", sectionId: coffee });
    });
    await db.update(menus).set({ active: false }).where(eq(menus.id, v.menus.Dinner));
    const model = await scoped((tx) => readOpeningHoursModel(tx, AT));
    expect(model.menus.find((menu) => menu.id === v.menus.Lunch)).toEqual({
      id: v.menus.Lunch,
      name: "Lunch",
      active: true,
      includes: ["Drinks"],
    });
    expect(model.menus.find((menu) => menu.id === v.menus.Drinks)?.includes).toEqual(["Coffee"]);
    expect(model.menus.find((menu) => menu.id === v.menus.Dinner)).toEqual({
      id: v.menus.Dinner,
      name: "Dinner",
      active: false,
      includes: [],
    });
  });

  it.each([
    ["13:59", true],
    ["14:00", false],
    ["11:59", false],
  ] as const)("at %s Lunch's menus are orderable: %s", async (time, select) => {
    const v = await serviceVenue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf((day) => (day === 5 ? [slot(v.lunch, "12:00", "14:00")] : [])),
        AT,
        1,
      ),
    );
    const service = await read(v, FRIDAY, time);
    const menuRows = [v.menus.Lunch, v.menus.Drinks, v.menus.Coffee];
    expect(service.orderableMenuIds).toEqual(select ? menuRows : []);
    expect(service.open).toBe(time >= "12:00" && time < "14:00");
  });

  it("keeps a period's menus orderable through a repeated wall minute until its end", async () => {
    const v = await serviceVenue();
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf((day) => (day === 6 ? [slot(v.night, "21:00", "03:00")] : [])),
        AT,
        1,
      ),
    );
    const repeated = localTimeOccurrences("2026-10-25", "02:20", ZONE);
    expect(repeated).toHaveLength(2);
    for (const instant of repeated) {
      expect(
        await scoped((tx) => resolveDepartmentService(tx, v.restaurant, instant)),
      ).toMatchObject({ orderableMenuIds: [v.menus.Dinner] });
      const service = await scoped((tx) => resolveDepartmentService(tx, v.restaurant, instant));
      expect(service.endedMenus.map((entry) => entry.menuId)).not.toContain(v.menus.Dinner);
    }
    expect(await read(v, "2026-10-25", "03:00")).toMatchObject({ orderableMenuIds: [] });
    expect((await read(v, "2026-10-25", "03:00")).endedMenus).toEqual([
      { menuId: v.menus.Dinner, periodName: "Night" },
    ]);
  });

  it("unions a shared staff menu without reviving its ended selling root", async () => {
    const v = await serviceVenue();
    expect(await read(v, FRIDAY, "14:00")).toMatchObject({
      orderableMenuIds: [v.menus.Coffee],
    });
  });

  it("names each ended menu's period, the one that ended last when two share a menu", async () => {
    const v = await serviceVenue();
    expect((await read(v, FRIDAY, "20:00")).endedMenus).toEqual([
      { menuId: v.menus.Lunch, periodName: "Lunch" },
      { menuId: v.menus.Drinks, periodName: "Lunch" },
      { menuId: v.menus.Coffee, periodName: "Afternoon" },
    ]);
  });

  it("orders the current customer and staff menus and switches at the exact boundary", async () => {
    const v = await serviceVenue();
    expect(await read(v, FRIDAY, "13:59")).toEqual({
      keepOpen: {
        periodId: v.lunch,
        periodName: "Lunch",
        endsAt: "14:00",
        running: true,
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.lunch,
      periodName: "Lunch",
      periodOccurrenceKey: expect.any(String),
      customerMenuId: v.menus.Lunch,
      orderableMenuIds: [v.menus.Lunch, v.menus.Drinks, v.menus.Coffee],
      endedMenus: [],
    });
    expect(await read(v, FRIDAY, "14:00")).toEqual({
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: true,
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.afternoon,
      periodName: "Afternoon",
      periodOccurrenceKey: expect.any(String),
      customerMenuId: v.menus.Coffee,
      orderableMenuIds: [v.menus.Coffee],
      endedMenus: [
        { menuId: v.menus.Lunch, periodName: "Lunch" },
        { menuId: v.menus.Drinks, periodName: "Lunch" },
      ],
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
      },
      departmentId: v.restaurant,
      open: true,
      periodId: v.night,
      periodName: "Night",
      periodOccurrenceKey: expect.any(String),
      customerMenuId: v.menus.Dinner,
      orderableMenuIds: [v.menus.Dinner],
      endedMenus: [
        { menuId: v.menus.Lunch, periodName: "Lunch" },
        { menuId: v.menus.Drinks, periodName: "Lunch" },
        { menuId: v.menus.Coffee, periodName: "Afternoon" },
      ],
    });
    expect(await read(v, SATURDAY, "03:00")).toEqual({
      keepOpen: {
        periodId: v.night,
        periodName: "Night",
        endsAt: "03:00",
        running: false,
      },
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      periodOccurrenceKey: null,
      customerMenuId: null,
      orderableMenuIds: [],
      endedMenus: [
        { menuId: v.menus.Lunch, periodName: "Lunch" },
        { menuId: v.menus.Drinks, periodName: "Lunch" },
        { menuId: v.menus.Coffee, periodName: "Afternoon" },
        { menuId: v.menus.Dinner, periodName: "Night" },
      ],
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
      endedMenus: [],
    });
  });

  it("closes in a gap and lists only the menus that ended in the current business day", async () => {
    const v = await serviceVenue();
    expect(await read(v, FRIDAY, "20:00")).toEqual({
      keepOpen: {
        periodId: v.afternoon,
        periodName: "Afternoon",
        endsAt: "19:00",
        running: false,
      },
      departmentId: v.restaurant,
      open: false,
      periodId: null,
      periodName: null,
      periodOccurrenceKey: null,
      customerMenuId: null,
      orderableMenuIds: [],
      endedMenus: [
        { menuId: v.menus.Lunch, periodName: "Lunch" },
        { menuId: v.menus.Drinks, periodName: "Lunch" },
        { menuId: v.menus.Coffee, periodName: "Afternoon" },
      ],
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
      endedMenus: [],
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
      endedMenus: [],
    });
    expect(await read(v, FRIDAY, "15:00")).toMatchObject({
      open: true,
      periodId: v.lunch,
      orderableMenuIds: [v.menus.Lunch, v.menus.Drinks, v.menus.Coffee],
    });
    expect(await read(v, SATURDAY, "02:30")).toMatchObject({ open: true, periodId: v.lunch });
    expect((await read(v, SATURDAY, "06:10")).endedMenus).toEqual([]);
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
      endedMenus: [],
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
      endedMenus: [],
    });
    await saveDay(v, FRIDAY, { id: date.id, closedAllDay: true });
    expect(await read(v, FRIDAY, "13:00")).toMatchObject({ open: false, orderableMenuIds: [] });
    expect((await read(v, SATURDAY, "06:10")).endedMenus).toEqual([]);
  });

  it("fails open with each distinct period menu when the clock cannot be read", async () => {
    const v = await serviceVenue();
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"not/a-zone"}) where module = 'business_day'`,
    );
    const service = await scoped((tx) => resolveDepartmentService(tx, v.restaurant, AT));
    expect(service).toMatchObject({
      departmentId: v.restaurant,
      open: true,
      periodId: null,
      periodName: null,
      periodOccurrenceKey: null,
      customerMenuId: null,
      endedMenus: [],
    });
    expect(new Set(service.orderableMenuIds)).toEqual(
      new Set([v.menus.Lunch, v.menus.Drinks, v.menus.Coffee, v.menus.Dinner]),
    );
    expect(service.orderableMenuIds).toHaveLength(4);
  });

  it("reports an empty department closed", async () => {
    const v = await serviceVenue();
    expect(await scoped((tx) => resolveDepartmentService(tx, v.deli, AT))).toEqual({
      keepOpen: null,
      departmentId: v.deli,
      open: false,
      periodId: null,
      periodName: null,
      periodOccurrenceKey: null,
      customerMenuId: null,
      orderableMenuIds: [],
      endedMenus: [],
    });
  });
});

describe("the routing that names a period", () => {
  it("lists each cell with a line for the period, and deleting the period takes only those lines", async () => {
    const v = await timed();
    const { periods } = v;
    const [kitchen] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(sql`true`);
    const [cocktails] = await db
      .insert(categories)
      .values({ name: "Cocktails" })
      .returning({ id: categories.id });
    const mojito = await scoped((tx) =>
      createProduct(tx, {
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
          .values({ stationId: kitchen!.id, ...values })
          .returning({ id: routingCells.id })
      )[0]!.id;
    const line = (cellId: string, periodId: string, noPreparation = false) =>
      db
        .insert(routingCellPeriods)
        .values({ cellId, periodId, stationId: noPreparation ? null : kitchen!.id, noPreparation });
    const cocktailsEverywhere = await cell({ categoryId: cocktails!.id });
    await line(cocktailsEverywhere, periods.supper);
    await line(cocktailsEverywhere, periods.noon, true);
    await line(await cell({ productId: mojito!.id, zoneId: v.terrace }), periods.supper, true);
    await line(await cell({ categoryId: cocktails!.id, zoneId: v.diningRoom }), periods.supper);
    await line(await cell({ zoneId: v.diningRoom }), periods.supper);
    await line(await cell({ noCategory: true }), periods.mornings);
    await cell({ categoryId: cocktails!.id, zoneId: v.bar });

    const uses = async () => {
      const routing = await scoped((tx) => readRoutingUses(tx));
      return new Map(Object.values(periods).map((id) => [id, routing.get(id) ?? []]));
    };
    const before = await uses();
    expect(before.get(periods.supper)).toEqual([
      { rowKind: "all", rowLabel: null, zoneName: "Dining room" },
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Cocktails", zoneName: "Dining room" },
      { rowKind: "product", rowLabel: "Cocktails › Mojito", zoneName: "Terrace" },
    ]);
    expect(before.get(periods.noon)).toEqual([
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
    ]);
    expect(before.get(periods.mornings)).toEqual([
      { rowKind: "no_category", rowLabel: null, zoneName: null },
    ]);
    expect(before.get(periods.lateNight)).toEqual([]);

    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf(() => [slot(periods.noon, "12:00", "16:00")]),
        AT,
        1,
      );
      await deletePeriod(tx, periods.supper, null, AT, 1);
    });
    expect(
      await db
        .select({ periodId: routingCellPeriods.periodId })
        .from(routingCellPeriods)
        .where(eq(routingCellPeriods.cellId, cocktailsEverywhere)),
    ).toEqual([{ periodId: periods.noon }]);
    expect(await db.select().from(routingCells)).toHaveLength(6);
    expect((await uses()).get(periods.noon)).toEqual([
      { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
    ]);
  });

  it("names each row by its path and lists the cells in the Routing tab's order", async () => {
    const v = await timed();
    const { periods } = v;
    await db.update(floorZones).set({ displayOrder: 5 }).where(eq(floorZones.id, v.diningRoom));
    const [kitchen] = await db
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(sql`true`);
    const { drinksCocktails, brunchCocktails, mojito, bread } = await scoped(async (tx) => {
      const drinks = (await createCategory(tx, { name: "Drinks" })).id;
      const brunch = (await createCategory(tx, { name: "Brunch" })).id;
      const product = async (name: string, categoryId: string | null) =>
        (
          await createProduct(tx, {
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
      { productId: mojito, zoneId: v.terrace },
      { categoryId: drinksCocktails, zoneId: v.diningRoom },
      { categoryId: drinksCocktails, zoneId: v.terrace },
      { categoryId: drinksCocktails },
      { categoryId: brunchCocktails },
      { zoneId: v.diningRoom },
    ]) {
      const [cell] = await db
        .insert(routingCells)
        .values({ stationId: kitchen!.id, ...values })
        .returning({ id: routingCells.id });
      await db
        .insert(routingCellPeriods)
        .values({ cellId: cell!.id, periodId: periods.supper, stationId: kitchen!.id });
    }
    const routing = await scoped((tx) => readRoutingUses(tx, periods.supper));
    expect(routing.get(periods.supper)).toEqual([
      { rowKind: "all", rowLabel: null, zoneName: "Dining room" },
      { rowKind: "category", rowLabel: "Brunch › Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: null },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: "Terrace" },
      { rowKind: "category", rowLabel: "Drinks › Cocktails", zoneName: "Dining room" },
      { rowKind: "product", rowLabel: "Drinks › Cocktails › Mojito", zoneName: "Terrace" },
      { rowKind: "no_category", rowLabel: null, zoneName: null },
      { rowKind: "product", rowLabel: "Bread", zoneName: null },
    ]);
  });
});

describe("a service period occurrence", () => {
  async function occurrenceVenue() {
    const v = await venue({ timetable: false });
    await seedBusinessDay(db, { dayCutover: "06:00:00" });
    const period = await scoped((tx) =>
      saveMenuPeriod(tx, v.restaurant, {
        name: "Same name",
        menuId: v.menus.Lunch,
        staffMenuIds: [],
      }),
    );
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.restaurant,
        weekOf(() => [
          slot(period.id, "12:00", "14:00"),
          slot(period.id, "18:00", "20:00"),
          slot(period.id, "22:00", "02:00"),
        ]),
        AT,
        1,
      ),
    );
    return { ...v, periodId: period.id };
  }

  it("distinguishes repeated days and runs and shares the authoritative key across zone offers and polls", async () => {
    const v = await occurrenceVenue();
    const key = (date: string, time: string) =>
      scoped((tx) => resolveDepartmentService(tx, v.restaurant, madrid(date, time)));
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
    for (const zoneId of [v.diningRoom, v.bar]) {
      const offers = await scoped((tx) =>
        listZoneOffers(tx, zoneId, { at: madrid(MONDAY, "13:00") }),
      );
      const poll = await scoped((tx) => menuState(tx, zoneId, madrid(MONDAY, "13:00")));
      expect(offers.service.periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
      expect(poll.service.periodOccurrenceKey).toBe(lunch.periodOccurrenceKey);
      expect(offers.defaultMenuId).toBe(v.menus.Lunch);
      expect(offers.menus.find((menu) => menu.id === v.menus.Lunch)).toMatchObject({
        isDefault: true,
        orderable: true,
        endedPeriodName: null,
      });
    }
    expect((await key(MONDAY, "16:00")).periodOccurrenceKey).toBeNull();
  });

  it("uses the actual special-day range and returns null without a readable clock or running period", async () => {
    const v = await occurrenceVenue();
    await saveDay(v, CHRISTMAS, { paint: [slot(v.periodId, "11:00", "16:00")] });
    expect(
      (await scoped((tx) => resolveDepartmentService(tx, v.restaurant, madrid(CHRISTMAS, "13:00"))))
        .periodOccurrenceKey,
    ).toBe(JSON.stringify([v.restaurant, CHRISTMAS, v.periodId, "11:00"]));
    expect(
      (await scoped((tx) => resolveDepartmentService(tx, v.deli, madrid(CHRISTMAS, "13:00"))))
        .periodOccurrenceKey,
    ).toBeNull();
    expect(
      (await scoped((tx) => menuState(tx, randomUUID(), madrid(CHRISTMAS, "13:00")))).service
        .periodOccurrenceKey,
    ).toBeNull();
    await db.run(
      sql`update settings set doc = json_set(doc, '$.timeZone', ${"not/a-zone"}) where module = 'business_day'`,
    );
    const service = await scoped((tx) => resolveDepartmentService(tx, v.restaurant, AT));
    expect(service.periodOccurrenceKey).toBeNull();
    expect(service.open).toBe(true);
    expect(service.orderableMenuIds).toEqual([v.menus.Lunch]);
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
          const offers = await listZoneOffers(tx, v.diningRoom, {
            at: madrid(MONDAY, "13:00"),
            ...(withDefault ? {} : { withDefault: false as const }),
          });
          const clockReads = prepared.mock.calls.filter(([query]) =>
            /from "settings"/.test((query as unknown as { sql: string }).sql),
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
    expect(pricing.offers.menus.find((menu) => menu.id === v.menus.Lunch)).toMatchObject({
      orderable: true,
      endedPeriodName: null,
    });
  });
});

describe("placeOpenPeriod", () => {
  it("names the period in the venue's staff language when no language is passed", async () => {
    await seedTaxpayer(db);
    const v = await venue({ timetable: false });
    await scoped((tx) => placeOpenPeriod(tx, v.restaurant, v.menus.Lunch));
    expect(
      await db
        .select({ name: menuPeriods.name })
        .from(menuPeriods)
        .where(eq(menuPeriods.departmentId, v.restaurant)),
    ).toEqual([{ name: STARTER_PERIOD_NAMES.Open.es }]);
  });
});
