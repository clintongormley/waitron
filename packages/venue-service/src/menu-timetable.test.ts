import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
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
import {
  setDepartmentAllDayMenu,
  setDepartmentMenus,
  setZoneAllDayMenu,
} from "./department-menus.js";
import { duplicateHolidayNamedSpecialDates } from "./holidays.js";
import { deleteSpecialDate, saveSpecialDate } from "./hours.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import type { SpecialDateInput } from "./hours-types.js";
import {
  MENU_TIMETABLE_CALENDAR_PARTICIPANT,
  clearSpecialDateMenus,
  deleteMenuPeriod,
  readMenuTimetableModel,
  replaceMenuWeek,
  resolveDefaultMenu,
  resolveZoneMenus,
  saveMenuPeriod,
  saveSpecialDateMenus,
  setZonePeriodMenu,
} from "./menu-timetable.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  deactivateDepartment,
  listDepartments,
  listZoneOffers,
  recordOrderServiceContext,
  recordWorkingLineContexts,
} from "./operations.js";
import { menuDayTimetables, menuSlots, zonePeriodMenus } from "./schema/menus.js";
import { specialDates } from "./schema/hours.js";
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

/**
 * Restaurant (Barra, Sala, Terraza) lists every menu but Deli para llevar, all-day Bebidas; Deli
 * (Mostrador deli) lists Deli para llevar, all-day too. With `timetable`, Restaurant has its four
 * named periods and Brunch navideño, and the week {@link restaurantWeek}; Deli has Mediodía deli,
 * 12:00–15:00 every day.
 */
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
    await setDepartmentMenus(
      tx,
      cfg,
      restaurant,
      MENU_NAMES.filter((name) => name !== "Deli para llevar").map((name) => menus[name]),
    );
    await setDepartmentAllDayMenu(tx, cfg, restaurant, menus.Bebidas);
    await setDepartmentMenus(tx, cfg, deli, [menus["Deli para llevar"]]);
    await setDepartmentAllDayMenu(tx, cfg, deli, menus["Deli para llevar"]);
    const v = { cfg, locationId, restaurant, deli, barra, sala, terraza, mostrador, menus };
    if (options.timetable === false) return { ...v, periods: null };
    const period = async (departmentId: string, name: string, menu: MenuName) =>
      (await saveMenuPeriod(tx, cfg, departmentId, { id: null, name, menuId: menus[menu] })).id;
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
  scoped((tx) => resolveZoneMenus(tx, v.cfg, zoneId, at));
/** The default and the period in force, the two fields the cases below vary. */
const choice = async (v: Venue, zoneId: string, at: Date) => {
  const { defaultMenuId, periodId } = await resolve(v, zoneId, at);
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
  scoped((tx) => saveSpecialDate(tx, v.cfg, null, dateInput(date, overrides), AT));
const dateMenus = (v: Venue, specialDateId: string, slots: MenuSlot[], at = AT) =>
  scoped((tx) => saveSpecialDateMenus(tx, v.cfg, specialDateId, v.restaurant, slots, at));

const invalid = (field: string, extra: Record<string, string> = {}) => ({
  code: "menu_timetable.invalid",
  params: { field, ...extra },
});

describe("the menu a zone starts on", () => {
  it("follows the week's named periods, start included and end excluded, with the all-day default in a gap", async () => {
    const v = await timed();
    const { menus, periods } = v;
    expect(await resolve(v, v.sala, madrid(MONDAY, "10:00"))).toEqual({
      departmentId: v.restaurant,
      availableMenuIds: MENU_NAMES.filter((name) => name !== "Deli para llevar").map(
        (name) => menus[name],
      ),
      defaultMenuId: menus.Desayunos,
      periodId: periods.mananas,
    });
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
        defaultMenuId: menus.Bebidas,
        periodId: null,
      });
  });

  it("takes a zone's own menu for a named period, and the period's menu where the zone has none", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.noches, menus.Cócteles);
    });
    expect((await resolve(v, v.barra, madrid(MONDAY, "10:00"))).defaultMenuId).toBe(menus.Café);
    expect((await resolve(v, v.terraza, madrid(MONDAY, "10:00"))).defaultMenuId).toBe(
      menus.Desayunos,
    );
    for (const zoneId of [v.barra, v.terraza])
      expect((await resolve(v, zoneId, madrid(MONDAY, "12:30"))).defaultMenuId).toBe(
        menus.Almuerzo,
      );
    expect((await resolve(v, v.barra, madrid(MONDAY, "18:30"))).defaultMenuId).toBe(menus.Cócteles);
    expect((await resolve(v, v.terraza, madrid(MONDAY, "18:30"))).defaultMenuId).toBe(menus.Cena);

    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, null));
    expect((await resolve(v, v.barra, madrid(MONDAY, "10:00"))).defaultMenuId).toBe(
      menus.Desayunos,
    );
  });

  it("keeps a zone's period menu on every day the period runs, after only Monday's slots were edited", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
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
      defaultMenuId: menus.Café,
      periodId: periods.mananas,
    });
    expect(await choice(v, v.barra, madrid(MONDAY, "08:45"))).toEqual({
      defaultMenuId: menus.Café,
      periodId: periods.mananas,
    });
  });

  it("lets a zone's all-day menu fill the gaps without beating the department's periods", async () => {
    const v = await timed();
    await scoped((tx) => setZoneAllDayMenu(tx, v.cfg, v.terraza, v.menus.Café));
    expect((await resolve(v, v.terraza, madrid(MONDAY, "12:30"))).defaultMenuId).toBe(
      v.menus.Almuerzo,
    );
    expect((await resolve(v, v.terraza, madrid(MONDAY, "17:00"))).defaultMenuId).toBe(v.menus.Café);
  });

  it("reads the weekend's own slots, and a Friday slot past midnight on Saturday until it ends", async () => {
    const v = await timed();
    const { menus, periods } = v;
    expect(await choice(v, v.sala, madrid(SATURDAY, "10:00"))).toEqual({
      defaultMenuId: menus.Bebidas,
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
      defaultMenuId: menus.Bebidas,
      periodId: null,
    });
  });

  it("follows the clock's own reading on a day it changes", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const backward = clockChangeAfter(ZONE, "2027-07-01T00:00:00Z", "backward");
    // Both are Sundays (weekday 0), so a Sunday slot of the week is placed on each.
    const sunday = (slots: MenuSlot[]) =>
      restaurantWeek(periods, (weekday) =>
        weekday === 0 ? [...slots, slot(periods.mediodia, "13:00", "17:00")] : null,
      );
    const skipped = minutesAfter(forward.before, 16);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        sunday([slot(periods.madrugada, skipped, "04:00")]),
        AT,
      ),
    );
    expect(await choice(v, v.sala, forward.instant)).toEqual({
      defaultMenuId: menus.Copas,
      periodId: periods.madrugada,
    });
    expect(await choice(v, v.sala, new Date(forward.instant.getTime() - 60_000))).toEqual({
      defaultMenuId: menus.Bebidas,
      periodId: null,
    });

    const boundary = minutesAfter(backward.after, 30);
    await scoped((tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        sunday([
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
      await setZonePeriodMenu(tx, v.cfg, v.barra, v.periods.mananas, v.menus.Café);
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
    });
    for (const zoneId of [v.sala, v.barra])
      expect(await choice(v, zoneId, madrid(MONDAY, "10:00"))).toEqual({
        defaultMenuId: v.menus.Bebidas,
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
    expect(resolved.availableMenuIds).not.toContain(v.menus.Desayunos);
    expect(resolved.defaultMenuId).toBe(v.menus.Desayunos);
    const offers = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.sala, { at: madrid(MONDAY, "10:00") }),
    );
    expect(offers.defaultMenuId).toBe(v.menus.Almuerzo);
  });
});

describe("a special date's menu timetable", () => {
  it("replaces the department's week that date, an empty one leaving the all-day default all day", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const at = (time: string) => madrid(CHRISTMAS, time);
    expect(await choice(v, v.sala, at("10:00"))).toEqual({
      defaultMenuId: menus.Bebidas,
      periodId: null,
    });
    expect(await choice(v, v.sala, at("12:00"))).toEqual({
      defaultMenuId: menus["Brunch de Navidad"],
      periodId: periods.brunch,
    });
    expect(await choice(v, v.sala, at("16:00"))).toEqual({
      defaultMenuId: menus.Bebidas,
      periodId: null,
    });
    // Christmas is a Friday: the week's Madrugada does not run into Saturday either.
    expect((await resolve(v, v.sala, madrid("2026-12-26", "01:00"))).periodId).toBeNull();
    // Deli has no timetable of its own that date, so it follows its week.
    expect(await choice(v, v.mostrador, at("12:00"))).toEqual({
      defaultMenuId: menus["Deli para llevar"],
      periodId: periods.mediodiaDeli,
    });

    await scoped(async (tx) => {
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
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
      defaultMenuId: menus.Café,
      periodId: periods.mananas,
    });

    await dateMenus(v, christmas.id, []);
    for (const time of ["10:00", "12:00"])
      expect(await choice(v, v.sala, at(time))).toEqual({
        defaultMenuId: menus.Bebidas,
        periodId: null,
      });
  });

  it("is not closed by a whole-venue closure, and its slots still count beside the neighbours", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const christmas = await makeDate(v, CHRISTMAS, { closeWholeVenue: true });
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const at = (time: string) => madrid(CHRISTMAS, time);
    expect((await resolve(v, v.sala, at("12:00"))).defaultMenuId).toBe(menus["Brunch de Navidad"]);
    expect((await resolve(v, v.sala, at("16:00"))).defaultMenuId).toBe(menus.Bebidas);
    expect((await resolve(v, v.mostrador, at("12:00"))).periodId).toBe(periods.mediodiaDeli);
    // Its tail would run into Saturday's Mediodía, 13:00.
    await expect(
      dateMenus(v, christmas.id, [slot(periods.madrugada, "23:00", "14:00")]),
    ).rejects.toMatchObject(invalid("slots", { date: "2026-12-26", departmentId: v.restaurant }));
  });

  it("refuses a slot opening or closing at a minute the clock skips that date, writing nothing", async () => {
    const v = await timed();
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const skipped = minutesAfter(forward.before, 16);
    const date = await makeDate(v, forward.date);
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

  it("goes back to the normal week when cleared", async () => {
    const v = await timed();
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, []);
    await scoped((tx) => clearSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, AT));
    expect(await choice(v, v.sala, madrid(CHRISTMAS, "10:00"))).toEqual({
      defaultMenuId: v.menus.Desayunos,
      periodId: v.periods.mananas,
    });
    // Clearing a date with no timetable changes nothing.
    await scoped((tx) => clearSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, AT));
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
      await expect(
        scoped((tx) => clearSpecialDateMenus(tx, cfg, specialDateId, departmentId, AT)),
      ).rejects.toMatchObject(refusal);
    }
  });
});

describe("the timetable's writers", () => {
  it("check every special date's neighbours, and no skipped minute, when the venue's clock cannot be read", async () => {
    const v = await timed();
    const { periods } = v;
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const march = await makeDate(v, forward.date);
    const past = await makeDate(v, "2026-10-03");
    await dateMenus(v, past.id, [slot(periods.mananas, "01:00", "03:00")]);
    await scoped(async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
    });
    // Nothing is known to be skipped on an unreadable clock.
    await dateMenus(v, march.id, [
      slot(periods.mananas, "00:30", minutesAfter(forward.before, 16)),
    ]);
    // Without a today, the past Saturday's clash with Friday's tail counts.
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          restaurantWeek(periods, (weekday) =>
            weekday === 5 ? [slot(periods.madrugada, "22:00", "02:00")] : null,
          ),
          AT,
        ),
      ),
    ).rejects.toMatchObject(invalid("date", { date: "2026-10-03", departmentId: v.restaurant }));
  });

  it("refuse a period, menu or slot from another department, and an unknown period", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await expect(
      scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.mostrador, periods.mananas, menus.Desayunos)),
    ).rejects.toMatchObject(invalid("periodId"));
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, v.restaurant, {
          id: null,
          name: "Para llevar",
          menuId: menus["Deli para llevar"],
        }),
      ),
    ).rejects.toMatchObject({
      code: "department_menu.not_found",
      params: { departmentId: v.restaurant, menuId: menus["Deli para llevar"] },
    });
    await expect(
      scoped((tx) =>
        setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus["Deli para llevar"]),
      ),
    ).rejects.toMatchObject({
      code: "department_menu.not_found",
      params: { departmentId: v.restaurant, menuId: menus["Deli para llevar"] },
    });
    await expect(
      scoped((tx) =>
        replaceMenuWeek(
          tx,
          v.cfg,
          v.restaurant,
          restaurantWeek(periods, (weekday) =>
            weekday === 1 ? [slot(periods.mediodiaDeli, "09:00", "12:00")] : null,
          ),
          AT,
        ),
      ),
    ).rejects.toMatchObject(invalid("days.1.slots.0.periodId"));
    const christmas = await makeDate(v, CHRISTMAS);
    await expect(
      dateMenus(v, christmas.id, [slot(periods.mediodiaDeli, "09:00", "12:00")]),
    ).rejects.toMatchObject(invalid("slots.0.periodId"));
    const unknown = randomUUID();
    await expect(
      scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, unknown, menus.Café)),
    ).rejects.toMatchObject({ code: "menu_period.not_found", params: { periodId: unknown } });
    await expect(scoped((tx) => deleteMenuPeriod(tx, v.cfg, unknown))).rejects.toMatchObject({
      code: "menu_period.not_found",
      params: { periodId: unknown },
    });
    await expect(
      scoped((tx) => setZonePeriodMenu(tx, v.cfg, unknown, periods.mananas, menus.Café)),
    ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId: unknown } });
    // Another venue's period is unknown here.
    const other = await timed();
    for (const write of [
      (tx: Transaction) => deleteMenuPeriod(tx, v.cfg, other.periods.mananas),
      (tx: Transaction) => setZonePeriodMenu(tx, v.cfg, v.barra, other.periods.mananas, null),
    ])
      await expect(scoped(write)).rejects.toMatchObject({
        code: "menu_period.not_found",
        params: { periodId: other.periods.mananas },
      });
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, v.restaurant, {
          id: other.periods.mananas,
          name: "Mañanas",
          menuId: menus.Desayunos,
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu_period.not_found",
      params: { periodId: other.periods.mananas },
    });
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, other.restaurant, {
          id: null,
          name: "Tardes",
          menuId: menus.Desayunos,
        }),
      ),
    ).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId: other.restaurant },
    });
  });

  it("rename and re-point a period, and refuse a name the department already uses", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const renamed = await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.restaurant, {
        id: periods.noches,
        name: " Cenas ",
        menuId: menus.Cócteles,
      }),
    );
    expect(renamed).toEqual({ id: periods.noches, name: "Cenas", menuId: menus.Cócteles });
    expect((await resolve(v, v.sala, madrid(MONDAY, "18:30"))).defaultMenuId).toBe(menus.Cócteles);
    for (const [id, name] of [
      [null, "Mañanas"],
      [null, " Mañanas "],
      [periods.noches, "Mañanas"],
      [null, "  "],
    ] as const)
      await expect(
        scoped((tx) => saveMenuPeriod(tx, v.cfg, v.restaurant, { id, name, menuId: menus.Café })),
      ).rejects.toMatchObject(invalid("name"));
    // The same name in another department is its own period.
    await scoped((tx) =>
      saveMenuPeriod(tx, v.cfg, v.deli, {
        id: null,
        name: "Mañanas",
        menuId: menus["Deli para llevar"],
      }),
    );
    // A period moved to a department other than its own is unknown there.
    await expect(
      scoped((tx) =>
        saveMenuPeriod(tx, v.cfg, v.deli, {
          id: periods.noches,
          name: "Noches",
          menuId: menus["Deli para llevar"],
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu_period.not_found",
      params: { periodId: periods.noches },
    });
  });

  it("refuse removing a menu a zone's period menu or a period names, naming every use", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café));
    const without = (name: MenuName) =>
      MENU_NAMES.filter((menu) => menu !== name && menu !== "Deli para llevar").map(
        (menu) => menus[menu],
      );
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, without("Café"))),
    ).rejects.toMatchObject({
      code: "department_menu.in_use",
      params: {
        departmentId: v.restaurant,
        menuId: menus.Café,
        uses: [{ kind: "zone_period", zoneId: v.barra, periodId: periods.mananas }],
      },
    });
    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, without("Desayunos"))),
    ).rejects.toMatchObject({
      code: "department_menu.in_use",
      params: { uses: [{ kind: "period", periodId: periods.mananas }] },
    });
  });

  it("refuse a week whose slot past midnight overlaps a coming special date's, and ignore a past pair", async () => {
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
    await expect(
      scoped((tx) => replaceMenuWeek(tx, v.cfg, v.restaurant, fridayTail("03:00"), AT)),
    ).rejects.toMatchObject(invalid("date", { date: "2026-10-24", departmentId: v.restaurant }));
    // The refused week was not written.
    expect((await resolve(v, v.sala, madrid("2026-10-31", "02:30"))).periodId).toBeNull();
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

  it("refuse deleting a period still placed, naming every day; once none does, delete it with its zones' menus", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, periods.noches, menus.Cócteles));
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
      await db.select().from(zonePeriodMenus).where(eq(zonePeriodMenus.zoneId, v.barra)),
    ).toEqual([]);
  });
});

describe("a period no longer placed anywhere but a past special date", () => {
  it("is shown with that date, which can be cleared, so its menu can leave the list", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const lastChristmas = await makeDate(v, "2025-12-25");
    await dateMenus(v, lastChristmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const listWithout = MENU_NAMES.filter(
      (name) => name !== "Brunch de Navidad" && name !== "Deli para llevar",
    ).map((name) => menus[name]);

    await expect(
      scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, listWithout)),
    ).rejects.toMatchObject({
      code: "department_menu.in_use",
      params: { uses: [{ kind: "period", periodId: periods.brunch }] },
    });
    const use = { kind: "special_date", specialDateId: lastChristmas.id, date: "2025-12-25" };
    await expect(scoped((tx) => deleteMenuPeriod(tx, v.cfg, periods.brunch))).rejects.toMatchObject(
      { code: "menu_period.in_use", params: { periodId: periods.brunch, uses: [use] } },
    );
    const model = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));
    expect(model.specialDates).toContainEqual({
      id: lastChristmas.id,
      date: "2025-12-25",
      name: "Navidad",
      timetables: [{ departmentId: v.restaurant, slots: [slot(periods.brunch, "11:00", "15:00")] }],
    });
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    expect(restaurant.periods.find((period) => period.id === periods.brunch)!.uses).toEqual([use]);

    await scoped((tx) => clearSpecialDateMenus(tx, v.cfg, lastChristmas.id, v.restaurant, AT));
    await scoped((tx) => deleteMenuPeriod(tx, v.cfg, periods.brunch));
    await scoped((tx) => setDepartmentMenus(tx, v.cfg, v.restaurant, listWithout));
    const after = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));
    expect(after.specialDates.map((date) => date.id)).not.toContain(lastChristmas.id);
  });
});

describe("a zone moved to another department", () => {
  it("loses its all-day and period menus in the same transaction", async () => {
    const v = await timed();
    const left = await scoped(async (tx) => {
      await setZoneAllDayMenu(tx, v.cfg, v.barra, v.menus.Desayunos);
      await setZonePeriodMenu(tx, v.cfg, v.barra, v.periods.mananas, v.menus.Café);
      await setZonePeriodMenu(tx, v.cfg, v.terraza, v.periods.mananas, v.menus.Café);
      await configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.deli });
      return {
        allDay: (await tx.execute(sql`select 1 from zone_all_day_menus where zone_id = ${v.barra}`))
          .rows,
        period: (await tx.execute(sql`select 1 from zone_period_menus where zone_id = ${v.barra}`))
          .rows,
        kept: (await tx.execute(sql`select 1 from zone_period_menus where zone_id = ${v.terraza}`))
          .rows,
      };
    });
    expect(left).toEqual({ allDay: [], period: [], kept: [{ 1: 1 }] });
  });

  it("keeps them when configured again within its own department, and lets an inactive zone's be cleared", async () => {
    const v = await timed();
    await scoped(async (tx) => {
      await setZonePeriodMenu(tx, v.cfg, v.barra, v.periods.mananas, v.menus.Café);
      await configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.restaurant });
    });
    expect((await resolve(v, v.barra, madrid(MONDAY, "10:00"))).defaultMenuId).toBe(v.menus.Café);
    await scoped((tx) =>
      setZonePeriodMenu(
        tx,
        v.cfg,
        v.mostrador,
        v.periods.mediodiaDeli,
        v.menus["Deli para llevar"],
      ),
    );
    await scoped((tx) => deactivateDepartment(tx, v.cfg, v.deli));
    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.mostrador, v.periods.mediodiaDeli, null));
    expect(
      await db.select().from(zonePeriodMenus).where(eq(zonePeriodMenus.zoneId, v.mostrador)),
    ).toEqual([]);
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

  it("copies a date's timetables under new ids, on the same named periods, without copying a zone's menus", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    await scoped(async (tx) => {
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
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
        defaultMenuId: menus.Café,
        periodId: periods.mananas,
      });
    expect(await choice(v, v.sala, madrid("2028-12-24", "13:30"))).toEqual({
      defaultMenuId: menus.Bebidas,
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
      await db.select().from(zonePeriodMenus).where(eq(zonePeriodMenus.periodId, periods.mananas)),
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
          [twoWeeksEarlier, forward.date],
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(invalid("date", { date: forward.date, departmentId: v.restaurant }));
    const stored = await db
      .select({ date: specialDates.date })
      .from(specialDates)
      .where(eq(specialDates.locationId, v.locationId));
    expect(stored.map((row) => row.date)).toEqual([weekEarlier]);
  });

  it("refuses a copy whose slots would overlap the day after its target", async () => {
    const v = await timed();
    // A Saturday, so its tail runs to 10:00 on a Sunday, clear of Mediodía.
    const source = await makeDate(v, "2026-12-12");
    await dateMenus(v, source.id, [slot(v.periods.madrugada, "23:00", "10:00")]);
    // Copied to a Saturday it is clear again; to a Sunday its tail meets Monday's Mañanas.
    await expect(
      scoped((tx) =>
        duplicateHolidayNamedSpecialDates(
          tx,
          v.cfg,
          source.id,
          ["2026-12-19", "2026-12-20"],
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(invalid("date", { date: "2026-12-20", departmentId: v.restaurant }));
  });

  it("lets a deleted date take its timetables with it, unless the week it resumes would overlap a neighbour's", async () => {
    const v = await timed();
    const { periods } = v;
    await recordedLine(v);
    const recorded = await lineContexts();
    expect(recorded.rows).toHaveLength(1);
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.mananas, "09:00", "11:00")]);
    const boxingDay = await makeDate(v, "2026-12-26");
    await dateMenus(v, boxingDay.id, [slot(periods.mananas, "01:00", "03:00")]);
    // Without Christmas's own timetable, Friday's Madrugada would run into 01:00 on the 26th.
    await expect(
      scoped((tx) =>
        deleteSpecialDate(tx, v.cfg, christmas.id, AT, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
      ),
    ).rejects.toMatchObject(invalid("date", { date: "2026-12-26", departmentId: v.restaurant }));
    await expect(
      scoped((tx) => clearSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, AT)),
    ).rejects.toMatchObject(invalid("date", { date: "2026-12-26", departmentId: v.restaurant }));

    await scoped((tx) => clearSpecialDateMenus(tx, v.cfg, boxingDay.id, v.restaurant, AT));
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

  it("re-checks a moved date's slots on its new date, and the week it leaves behind", async () => {
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
    await expect(move(sunday.id, "2026-12-23", "Fiesta")).rejects.toMatchObject(
      invalid("date", { date: "2026-12-23", departmentId: v.restaurant }),
    );
    // Moving Nochebuena to the 26th leaves the 24th to the week, whose Thursday has no tail, but
    // puts its 01:00 slot after Christmas Friday's Madrugada.
    await expect(move(christmasEve.id, "2026-12-26", "Nochebuena")).rejects.toMatchObject(
      invalid("date", { date: "2026-12-26", departmentId: v.restaurant }),
    );
    const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
    const skippedEnd = await makeDate(v, "2027-03-14", { name: "Marzo" });
    await dateMenus(v, skippedEnd.id, [
      slot(periods.mananas, "00:30", minutesAfter(forward.before, 16)),
    ]);
    await expect(move(skippedEnd.id, forward.date, "Marzo")).rejects.toMatchObject(
      invalid("date", { date: forward.date, departmentId: v.restaurant }),
    );

    await move(sunday.id, "2026-12-20", "Fiesta");
    expect((await resolve(v, v.sala, madrid("2026-12-20", "23:30"))).periodId).toBe(
      periods.madrugada,
    );
    expect((await resolve(v, v.sala, madrid("2026-12-13", "23:30"))).periodId).toBeNull();
  });

  it("refuses moving a date away when the week it leaves behind would overlap a neighbour's", async () => {
    const v = await timed();
    const { periods } = v;
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, []);
    const boxingDay = await makeDate(v, "2026-12-26", { name: "San Esteban" });
    await dateMenus(v, boxingDay.id, [slot(periods.mananas, "01:00", "03:00")]);
    await expect(
      scoped((tx) =>
        saveSpecialDate(
          tx,
          v.cfg,
          christmas.id,
          dateInput("2026-12-31"),
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      ),
    ).rejects.toMatchObject(invalid("date", { date: "2026-12-26", departmentId: v.restaurant }));
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
  it("marks the timetable's default, giving way to the first served menu when it is unpublished", async () => {
    const v = await timed();
    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, v.periods.mananas, v.menus.Café));
    const at = madrid(MONDAY, "10:00");
    const offers = await scoped((tx) => listZoneOffers(tx, v.cfg, v.barra, { at }));
    expect(Object.keys(offers).sort()).toEqual(["defaultMenuId", "menus", "offers"]);
    expect(offers.defaultMenuId).toBe(v.menus.Café);
    expect(offers.menus.filter((menu) => menu.isDefault).map((menu) => menu.id)).toEqual([
      v.menus.Café,
    ]);
    const without = await scoped((tx) =>
      listZoneOffers(tx, v.cfg, v.barra, { at, withDefault: false }),
    );
    expect(without.defaultMenuId).toBeNull();
    expect(without.menus.some((menu) => menu.isDefault)).toBe(false);
    expect(without.menus.map((menu) => menu.id)).toEqual(offers.menus.map((menu) => menu.id));

    const unpublished = await timed({ unpublished: ["Café"] });
    await scoped((tx) =>
      setZonePeriodMenu(
        tx,
        unpublished.cfg,
        unpublished.barra,
        unpublished.periods.mananas,
        unpublished.menus.Café,
      ),
    );
    const fallback = await scoped((tx) =>
      listZoneOffers(tx, unpublished.cfg, unpublished.barra, { at }),
    );
    expect(fallback.defaultMenuId).toBe(unpublished.menus.Desayunos);
  });

  it("resolves the default among the menus a caller already found served", async () => {
    const v = await timed();
    await scoped((tx) => setZonePeriodMenu(tx, v.cfg, v.barra, v.periods.mananas, v.menus.Café));
    const at = madrid(MONDAY, "10:00");
    const served = (ids: string[]) =>
      scoped((tx) => resolveDefaultMenu(tx, v.cfg, v.barra, at, ids));
    expect(await served([v.menus.Desayunos, v.menus.Café])).toBe(v.menus.Café);
    expect(await served([v.menus.Bebidas, v.menus.Desayunos])).toBe(v.menus.Bebidas);
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
  const TIMETABLE_TABLES =
    /"(menu_periods|menu_slots|menu_day_timetables|zone_period_menus|zone_all_day_menus)"/;

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

  it("resolve a zone's menu in the same number however many slots and zone menus there are", async () => {
    const v = await timed();
    const { menus, periods } = v;
    const at = madrid(MONDAY, "10:00");
    await scoped(async (tx) => {
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        weekOf((weekday) => (weekday === 1 ? [slot(periods.mananas, "09:00", "12:00")] : [])),
        AT,
      );
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
    });
    const few = await statementsOf((tx) => resolveZoneMenus(tx, v.cfg, v.barra, at));
    await scoped(async (tx) => {
      await replaceMenuWeek(tx, v.cfg, v.restaurant, twentySlots(periods), AT);
      for (const periodId of [periods.mediodia, periods.noches, periods.madrugada, periods.brunch])
        await setZonePeriodMenu(tx, v.cfg, v.barra, periodId, menus.Cócteles);
    });
    const many = await statementsOf((tx) => resolveZoneMenus(tx, v.cfg, v.barra, at));
    expect(many).toHaveLength(few.length);
    expect((await resolve(v, v.barra, at)).defaultMenuId).toBe(menus.Cócteles);
  });

  it("price a basket's offers without reading the timetable at all", async () => {
    const plain = await venue({ timetable: false });
    const busy = await timed();
    await scoped(async (tx) => {
      await replaceMenuWeek(tx, busy.cfg, busy.restaurant, twentySlots(busy.periods), AT);
      for (const periodId of Object.values(busy.periods).slice(0, 5))
        await setZonePeriodMenu(tx, busy.cfg, busy.barra, periodId, busy.menus.Café);
    });
    const read = (v: Venue) =>
      statementsOf((tx) =>
        listZoneOffers(tx, v.cfg, v.barra, { menuItemIds: [randomUUID()], withDefault: false }),
      );
    const none = await read(plain);
    const lots = await read(busy);
    expect(lots).toHaveLength(none.length);
    expect(lots.filter((text) => TIMETABLE_TABLES.test(text))).toEqual([]);
    // Without the option the timetable is read, which is what the check above would see.
    const withDefault = await statementsOf((tx) => listZoneOffers(tx, busy.cfg, busy.barra));
    expect(withDefault.some((text) => TIMETABLE_TABLES.test(text))).toBe(true);
  });
});

describe("the editor's model", () => {
  it("lists a venue with no periods, and every department's empty week", async () => {
    const v = await venue({ timetable: false });
    const model = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));
    for (const department of model.departments) {
      expect(department.periods).toEqual([]);
      expect(department.week).toEqual(weekOf(() => []));
    }
  });

  it("lists every department, its periods with their days, its week and its zones' menus", async () => {
    const v = await timed();
    const { menus, periods } = v;
    await scoped(async (tx) => {
      await setZoneAllDayMenu(tx, v.cfg, v.terraza, menus.Café);
      await setZonePeriodMenu(tx, v.cfg, v.barra, periods.mananas, menus.Café);
      await deactivateDepartment(tx, v.cfg, v.deli);
    });
    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, [slot(periods.brunch, "11:00", "15:00")]);
    const yesterday = await makeDate(v, "2026-10-06", { name: "Ayer" });
    const earlier = await makeDate(v, "2026-10-05", { name: "Anteayer" });
    const model = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));

    expect({
      timeZone: model.timeZone,
      clockReadable: model.clockReadable,
      civilDate: model.civilDate,
    }).toEqual({ timeZone: ZONE, clockReadable: true, civilDate: "2026-10-07" });
    expect(model.departments.map((department) => department.id)).toEqual(
      (await scoped((tx) => listDepartments(tx, v.cfg))).map((department) => department.id),
    );
    const restaurant = model.departments.find((department) => department.id === v.restaurant)!;
    const weekdays = (...days: number[]) => days.map((weekday) => ({ kind: "week", weekday }));
    expect(restaurant).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      active: true,
      menuIds: MENU_NAMES.filter((name) => name !== "Deli para llevar").map((name) => menus[name]),
      allDayMenuId: menus.Bebidas,
      periods: [
        {
          id: periods.brunch,
          name: "Brunch navideño",
          menuId: menus["Brunch de Navidad"],
          uses: [{ kind: "special_date", specialDateId: christmas.id, date: CHRISTMAS }],
        },
        { id: periods.madrugada, name: "Madrugada", menuId: menus.Copas, uses: weekdays(5) },
        {
          id: periods.mananas,
          name: "Mañanas",
          menuId: menus.Desayunos,
          uses: weekdays(1, 2, 3, 4, 5),
        },
        {
          id: periods.mediodia,
          name: "Mediodía",
          menuId: menus.Almuerzo,
          uses: weekdays(0, 1, 2, 3, 4, 5, 6),
        },
        { id: periods.noches, name: "Noches", menuId: menus.Cena, uses: weekdays(1, 2, 3, 4, 5) },
      ],
      week: restaurantWeek(periods),
      zones: [
        {
          id: v.barra,
          name: "Barra",
          active: true,
          allDayMenuId: null,
          periodMenus: [{ periodId: periods.mananas, menuId: menus.Café }],
        },
        { id: v.sala, name: "Sala", active: true, allDayMenuId: null, periodMenus: [] },
        { id: v.terraza, name: "Terraza", active: true, allDayMenuId: menus.Café, periodMenus: [] },
      ],
    });
    const deli = model.departments.find((department) => department.id === v.deli)!;
    expect(deli).toMatchObject({
      active: false,
      zones: [{ id: v.mostrador, active: false }],
      periods: [{ id: periods.mediodiaDeli }],
    });
    expect(model.specialDates).toEqual([
      { id: yesterday.id, date: "2026-10-06", name: "Ayer", timetables: [] },
      {
        id: christmas.id,
        date: CHRISTMAS,
        name: "Navidad",
        timetables: [
          { departmentId: v.restaurant, slots: [slot(periods.brunch, "11:00", "15:00")] },
        ],
      },
    ]);

    await scoped(async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = 'Mars/Base' where id = ${v.locationId}`,
      );
    });
    const unreadable = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));
    expect({ clockReadable: unreadable.clockReadable, civilDate: unreadable.civilDate }).toEqual({
      clockReadable: false,
      civilDate: null,
    });
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

  it("still refuses a copy beside a day that keeps its week, creating no target", async () => {
    const { v, duplicate } = await arranged();
    await expect(duplicate(["2026-12-10", "2026-12-11"])).rejects.toMatchObject({
      code: "menu_timetable.invalid",
      params: { field: "date", date: "2026-12-11", departmentId: v.restaurant, reason: "overlap" },
    });
    const stored = await db
      .select({ date: specialDates.date })
      .from(specialDates)
      .where(eq(specialDates.locationId, v.locationId));
    expect(stored.map((row) => row.date)).toEqual(["2026-12-02"]);
  });
});

describe("why a calendar change is refused", () => {
  const forward = clockChangeAfter(ZONE, "2027-01-01T00:00:00Z", "forward");
  const skipped = minutesAfter(forward.before, 16);
  const refused = (v: Venue, date: string, reason: string) => ({
    code: "menu_timetable.invalid",
    params: { field: "date", date, departmentId: v.restaurant, reason },
  });

  it("names a skipped minute apart from an overlap, for a copy, a move and a delete", async () => {
    const v = await timed();
    const { periods } = v;
    const march = await makeDate(v, "2027-03-14", { name: "Marzo" });
    await dateMenus(v, march.id, [slot(periods.mananas, "00:30", skipped)]);
    const copy = (sourceId: string, date: string) =>
      scoped((tx) =>
        duplicateHolidayNamedSpecialDates(
          tx,
          v.cfg,
          sourceId,
          [date],
          AT,
          VENUE_SERVICE_CALENDAR_PARTICIPANTS,
        ),
      );
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
    await expect(copy(march.id, forward.date)).rejects.toMatchObject(
      refused(v, forward.date, "clock_skips"),
    );
    await expect(move(march.id, forward.date, "Marzo")).rejects.toMatchObject(
      refused(v, forward.date, "clock_skips"),
    );

    // A Saturday: its tail reaches 10:00 on Sunday; on a Sunday it meets Monday's Mañanas.
    const late = await makeDate(v, "2026-12-12", { name: "Tarde" });
    await dateMenus(v, late.id, [slot(periods.madrugada, "23:00", "10:00")]);
    await expect(copy(late.id, "2026-12-20")).rejects.toMatchObject(
      refused(v, "2026-12-20", "overlap"),
    );
    await expect(move(late.id, "2026-12-20", "Tarde")).rejects.toMatchObject(
      refused(v, "2026-12-20", "overlap"),
    );

    const christmas = await makeDate(v, CHRISTMAS);
    await dateMenus(v, christmas.id, []);
    const boxingDay = await makeDate(v, "2026-12-26", { name: "San Esteban" });
    await dateMenus(v, boxingDay.id, [slot(periods.mananas, "01:00", "03:00")]);
    await expect(
      scoped((tx) =>
        deleteSpecialDate(tx, v.cfg, christmas.id, AT, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
      ),
    ).rejects.toMatchObject(refused(v, "2026-12-26", "overlap"));
    await expect(
      scoped((tx) => clearSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, AT)),
    ).rejects.toMatchObject(refused(v, "2026-12-26", "overlap"));
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

  it("is read once per change, however many departments a date holds", async () => {
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
    expect(await clockReads((tx) => participant.beforeDelete(tx, v.cfg, christmas.id, AT))).toBe(1);
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
      await clockReads((tx) => clearSpecialDateMenus(tx, v.cfg, christmas.id, v.restaurant, AT)),
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
    const model = await scoped((tx) => readMenuTimetableModel(tx, v.cfg, AT));
    expect(model.specialDates).toEqual([
      { id: ours.id, date: CHRISTMAS, name: "Navidad", timetables: [] },
    ]);
  });
});
