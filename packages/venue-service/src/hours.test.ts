import type { DateHoursCell, HourPeriod, HoursSubject } from "./testing/legacy-station-types.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { createHolidayCalendar, type CountryPack } from "@waitron/country";
import {
  CORE_MIGRATIONS,
  catalogues,
  floorZones,
  kitchenStations,
  locations,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import {
  deleteSpecialDate,
  duplicateSpecialDate,
  readCalendarDays,
  readSpecialDate,
  renameSpecialDate,
  saveSpecialDate,
  type HolidayReader,
  type SpecialDateParticipant,
} from "./hours.js";
import {
  createHolidayStore,
  duplicateHolidayNamedSpecialDates as installedDuplicateHolidayNamedSpecialDates,
  readHolidayFacts as installedReadHolidayFacts,
} from "./holidays.js";
import { stationStates } from "./routing-store.js";
import * as packageIndex from "./index.js";
import { readCalendarDays as packageReadCalendarDays } from "./index.js";
import {
  type CalendarDay,
  type HolidayFact,
  type LocalDate,
  type SpecialDateInput as NamedDayInput,
} from "./hours-types.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { MENU_TIMETABLE_CALENDAR_PARTICIPANT } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { specialDates } from "./schema/hours.js";
import { departments, zoneServicePolicies } from "./schema/service.js";
import { menuDayTimetables, menuSlots } from "./schema/menus.js";
import { zoneClosedTimes } from "./schema/zone-closed-times.js";
import { replaceMenuWeek, saveMenuPeriod, saveSpecialDateMenus } from "./menu-timetable.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";

type SpecialDateInput = NamedDayInput & { cells: DateHoursCell[] };

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** Tuesday 6 October 2026, 12:00 in Madrid. */
const AT = new Date("2026-10-06T10:00:00Z");

interface Fixture {
  cfg: VenueScope;
  restaurant: HoursSubject;
  deli: HoursSubject;
  bar: HoursSubject;
  kitchen: HoursSubject;
  otherDepartment: HoursSubject;
  departmentIds: { restaurant: string; deli: string };
  otherStation: HoursSubject;
}

async function fixture(): Promise<Fixture> {
  return withTransaction(db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: `Venue ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning();
    const [other] = await tx
      .insert(locations)
      .values({
        name: `Other ${randomUUID()}`,
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const cfg = { locationId: locationId(location!.id) };
    const department = (location: string, name: string, isDefault = false) => ({
      locationId: location,
      name,
      tradingName: name,
      isDefault,
    });
    const [restaurant, deli] = await tx
      .insert(departments)
      .values([
        department(location!.id, "Restaurant", true),
        department(location!.id, "Deli"),
        department(other!.id, "Other restaurant", true),
      ])
      .returning();
    const [bar, kitchen, otherStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Bar" },
        { locationId: location!.id, name: "Kitchen", isDefault: true },
        { locationId: other!.id, name: "Other bar" },
      ])
      .returning();
    const [restaurantStation, deliStation, foreignStation] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: location!.id, name: "Pass" },
        { locationId: location!.id, name: "Grill" },
        { locationId: other!.id, name: "Other pass" },
      ])
      .returning();
    const [calendarMenu] = await tx
      .insert(catalogues)
      .values({ name: `Calendar ${randomUUID()}` })
      .returning();
    const calendarPeriod = await saveMenuPeriod(tx, cfg, restaurant!.id, {
      name: "Open",
      menuId: calendarMenu!.id,
      staffMenuIds: [],
    });
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant!.id,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [{ periodId: calendarPeriod.id, startsAt: "06:00", endsAt: "06:00" }],
      })),
      new Date(),
    );
    return {
      cfg,
      departmentIds: { restaurant: restaurant!.id, deli: deli!.id },
      restaurant: { kind: "station", id: restaurantStation!.id },
      deli: { kind: "station", id: deliStation!.id },
      bar: { kind: "station", id: bar!.id },
      kitchen: { kind: "station", id: kitchen!.id },
      otherDepartment: { kind: "station", id: foreignStation!.id },
      otherStation: { kind: "station", id: otherStation!.id },
    };
  });
}

const period = (opensAt: string, closesAt: string, id: string = randomUUID()): HourPeriod => ({
  id,
  opensAt,
  closesAt,
});

const specialInput = (overrides: Partial<SpecialDateInput> = {}): SpecialDateInput => ({
  date: "2026-10-09",
  name: "Harvest festival",

  closeWholeVenue: false,
  cells: [],
  ...overrides,
});

const saveDate = (f: Fixture, id: string | null, input: unknown) =>
  withTransaction(db, (tx) => saveSpecialDate(tx, f.cfg, id, input as SpecialDateInput, AT));

const seedNamedDate = (f: Fixture, input: SpecialDateInput) => saveDate(f, null, input);

describe("special dates", () => {
  it("saves and reads calendar fields while ignoring former station input", async () => {
    const f = await fixture();
    const evening = period("19:00", "01:00");
    const saved = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "all_day", periods: [] } },
          { subject: f.kitchen, cell: { mode: "inherit", periods: [] } },
        ],
      }),
    );
    expect(saved).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: expect.any(String),
      date: "2026-10-09",
      name: "Harvest festival",
      closeWholeVenue: false,
    });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).toEqual({
      ...saved,
    });
  });

  it("edits calendar fields in place, keeping the named day id", async () => {
    const f = await fixture();
    const first = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }] }),
    );
    const edited = await saveDate(
      f,
      first.id,
      specialInput({
        date: "2026-10-12",
        name: "Founders' day",

        closeWholeVenue: true,
        cells: [{ subject: f.deli, cell: { mode: "inherit", periods: [] } }],
      }),
    );
    expect(edited).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: first.id,
      date: "2026-10-12",
      name: "Founders' day",

      closeWholeVenue: true,
    });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, first.id))).toEqual({
      ...edited,
    });
  });

  it("edits a named day while ignoring former station input", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    const first = await seedNamedDate(
      f,
      specialInput({ cells: [{ subject: f.bar, cell: { mode: "periods", periods: [lunch] } }] }),
    );
    const evening = period("19:00", "23:00");
    const edited = await saveDate(
      f,
      first.id,
      specialInput({
        name: "Renamed",
        cells: [
          {
            subject: f.bar,
            cell: { mode: "periods", periods: [evening, { ...lunch, closesAt: "16:00" }] },
          },
        ],
      }),
    );
    expect(edited).toEqual({ ...first, name: "Renamed" });
  });

  it("refuses a date another special date already holds, and an id it does not know", async () => {
    const f = await fixture();
    await saveDate(f, null, specialInput());
    const second = await saveDate(f, null, specialInput({ date: "2026-10-10" }));

    await expect(saveDate(f, null, specialInput())).rejects.toMatchObject({
      code: "special_date.date_taken",
      params: { date: "2026-10-09" },
    });
    await expect(saveDate(f, second.id, specialInput())).rejects.toMatchObject({
      code: "special_date.date_taken",
      params: { date: "2026-10-09" },
    });
    const unknown = randomUUID();
    await expect(saveDate(f, unknown, specialInput({ date: "2026-11-01" }))).rejects.toMatchObject({
      code: "special_date.not_found",
      params: { specialDateId: unknown },
    });

    const other = await fixture();
    await expect(saveDate(other, second.id, specialInput())).rejects.toMatchObject({
      code: "special_date.not_found",
    });
    await expect(
      withTransaction(db, (tx) => readSpecialDate(tx, other.cfg, second.id)),
    ).rejects.toMatchObject({ code: "special_date.not_found" });
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, second.id))).date).toBe(
      "2026-10-10",
    );
  });

  const refusals: [string, (f: Fixture) => unknown, string][] = [
    ["a request that is not an object", () => null, "input"],
    ["an impossible date", () => specialInput({ date: "2026-02-30" }), "date"],
    ["a date in another shape", () => specialInput({ date: "2026-2-3" }), "date"],
    ["a blank name", () => specialInput({ name: "  " }), "name"],
    [
      "a kind outside the named-day kinds",
      () => ({ ...specialInput(), kind: "other" as never }),
      "kind",
    ],
    [
      "a closure flag that is not true or false",
      () => specialInput({ closeWholeVenue: "yes" as never }),
      "closeWholeVenue",
    ],
  ];

  const formerStationInputs: [string, (f: Fixture) => unknown, string][] = [
    [
      "a cell entry that is not an object",
      () => specialInput({ cells: [null as never] }),
      "cells.0",
    ],
    ["cells that are not a list", () => specialInput({ cells: null as never }), "cells"],
    [
      "one subject given twice",
      (f) =>
        specialInput({
          cells: [
            { subject: f.deli, cell: { mode: "closed", periods: [] } },
            { subject: f.deli, cell: { mode: "all_day", periods: [] } },
          ],
        }),
      "cells.1.subject",
    ],
    [
      "another venue's subject",
      (f) =>
        specialInput({
          cells: [{ subject: f.otherStation, cell: { mode: "closed", periods: [] } }],
        }),
      "cells.0.subject",
    ],
    [
      "a weekly-only mode",
      (f) =>
        specialInput({
          cells: [{ subject: f.deli, cell: { mode: "not_set", periods: [] } as never }],
        }),
      "cells.0.cell.mode",
    ],
    [
      "overlapping periods",
      (f) =>
        specialInput({
          cells: [
            {
              subject: f.deli,
              cell: {
                mode: "periods",
                periods: [period("10:00", "13:00"), period("12:30", "14:00")],
              },
            },
          ],
        }),
      "cells.0.cell.periods.1",
    ],
  ];
  it.each(formerStationInputs)("ignores former station input: %s", async (_, make) => {
    const f = await fixture();
    const saved = await saveDate(f, null, make(f));
    expect(saved).toEqual({
      id: expect.any(String),
      date: "2026-10-09",
      name: "Harvest festival",
      kind: "working_day",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    });
  });

  it.each(refusals)("refuses %s, naming the field and writing nothing", async (_, make, field) => {
    const f = await fixture();
    await expect(saveDate(f, null, make(f))).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field },
    });
    expect(
      await withTransaction(db, (tx) =>
        tx.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
      ),
    ).toEqual([]);
  });

  it("ignores a former default-station cell when saving a named day", async () => {
    const f = await fixture();
    const saved = await saveDate(
      f,
      null,
      specialInput({ cells: [{ subject: f.kitchen, cell: { mode: "closed", periods: [] } }] }),
    );
    expect(saved.date).toBe("2026-10-09");
  });

  it("edits a named day without changing the default station state", async () => {
    const f = await fixture();
    const evening = period("18:00", "22:00");
    const date = await seedNamedDate(
      f,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);

    await saveDate(
      f,
      date.id,
      specialInput({
        name: "Renamed",
        cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }],
      }),
    );
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, date.id))).name).toBe(
      "Renamed",
    );

    const edited = await saveDate(
      f,
      date.id,
      specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
    );
    expect(edited.id).toBe(date.id);
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      subject: f.bar,
      openingDate: "2026-10-09",
      specialDateId: date.id,
      state: { open: true, isDefault: true },
    });

    await withTransaction(db, (tx) =>
      tx.update(kitchenStations).set({ isDefault: false }).where(eq(kitchenStations.id, f.bar.id)),
    );
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
  });
});

describe("neighbouring named days", () => {
  const lateFriday = (f: Fixture) =>
    specialInput({
      cells: [
        { subject: f.restaurant, cell: { mode: "periods", periods: [period("22:00", "03:00")] } },
      ],
    });

  it("saves a named day with ignored overnight station input", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, lateFriday(f));
    expect(saved).toMatchObject({ date: "2026-10-09", name: "Harvest festival" });
    const edited = await saveDate(
      f,
      saved.id,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [period("22:00", "01:00")] } },
        ],
      }),
    );
    expect(edited.id).toBe(saved.id);
  });

  it("saves and reads a named day with ignored station input", async () => {
    const f = await fixture();
    const saved = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [period("01:00", "05:00")] } },
        ],
      }),
    );
    expect(saved).toMatchObject({ date: "2026-10-09", name: "Harvest festival" });
  });

  it("moves a named day beside another named day", async () => {
    const f = await fixture();
    const saturday = await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-10",
        cells: [{ subject: f.restaurant, cell: { mode: "closed", periods: [] } }],
      }),
    );
    await seedNamedDate(f, lateFriday(f));
    const moved = await saveDate(f, saturday.id, specialInput({ date: "2026-10-20" }));
    expect(moved).toMatchObject({ id: saturday.id, date: "2026-10-20" });
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saturday.id))).date).toBe(
      "2026-10-20",
    );
  });

  it("saves a past named day without inspecting former station periods", async () => {
    const f = await fixture();
    const saved = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-09-18",
        cells: [
          {
            subject: f.restaurant,
            cell: {
              mode: "periods",
              periods: [period("10:00", "13:00"), period("12:00", "14:00")],
            },
          },
        ],
      }),
    );
    expect(saved.date).toBe("2026-09-18");
  });

  it("reopens a named day beside another named day", async () => {
    const f = await fixture();
    const closedFriday = await seedNamedDate(f, specialInput({ closeWholeVenue: true }));
    await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-10",
        cells: [
          { subject: f.deli, cell: { mode: "periods", periods: [period("02:00", "06:00")] } },
        ],
      }),
    );
    const reopened = await saveDate(f, closedFriday.id, specialInput());
    expect(reopened).toMatchObject({ id: closedFriday.id, closeWholeVenue: false });
    expect(
      (await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, closedFriday.id)))
        .closeWholeVenue,
    ).toBe(false);
  });

  it("closes a named day while ignoring former station input", async () => {
    const f = await fixture();
    const input = { ...lateFriday(f), closeWholeVenue: true };
    const saved = await seedNamedDate(f, input);
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: saved.id,
      date: "2026-10-09",
      name: "Harvest festival",

      closeWholeVenue: true,
    });
  });
});

describe("special dates on a clock-change day", () => {
  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2027-07-01T00:00:00Z", "backward");
  const skipped = minutesAfter(forward.before, 1);
  const dateWith = (date: string, f: Fixture, opensAt: string, closesAt: string) =>
    specialInput({
      date,
      cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(opensAt, closesAt)] } }],
    });

  it("saves named dates despite station endpoints at minutes the clock skips", async () => {
    const f = await fixture();
    const opened = await saveDate(f, null, dateWith(forward.date, f, skipped, "12:00"));
    expect(opened).toMatchObject({ date: forward.date, name: "Harvest festival" });
    const edited = await saveDate(f, opened.id, dateWith(forward.date, f, "00:30", skipped));
    expect(edited).toMatchObject({ id: opened.id, date: forward.date });
    const dayBefore = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const overnight = await saveDate(f, null, dateWith(dayBefore, f, "22:00", skipped));
    expect(overnight).toMatchObject({ date: dayBefore, name: "Harvest festival" });
    const rows = await db
      .select()
      .from(specialDates)
      .where(eq(specialDates.locationId, f.cfg.locationId));
    expect(rows.map((row) => row.id).sort()).toEqual([opened.id, overnight.id].sort());
  });

  it("saves the same times on an ordinary day, and a minute the clock repeats", async () => {
    const f = await fixture();
    await saveDate(f, null, dateWith("2027-02-10", f, skipped, "12:00"));
    await saveDate(f, null, dateWith(backward.date, f, minutesAfter(backward.after, 1), "12:00"));
    expect((await storedDates(f)).map((day) => day.date)).toEqual(["2027-02-10", backward.date]);
  });

  it("checks no endpoint while the venue's clock cannot be read", async () => {
    const f = await fixture();
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, f.cfg.locationId)),
    );
    const saved = await saveDate(f, null, dateWith(forward.date, f, skipped, "12:00"));
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).date).toBe(
      forward.date,
    );
  });
});

const dateSnapshot = (f: Fixture, subject: HoursSubject, date: LocalDate) =>
  withTransaction(db, async (tx) => {
    const day = (await readCalendarDays(tx, f.cfg, date, date))[0]!;
    const states = await stationStates(tx, f.cfg, new Date(`${date}T10:00:00Z`));
    return {
      subject,
      openingDate: day.date,
      specialDateId: day.specialDate?.id ?? null,
      closeWholeVenue: day.specialDate?.closeWholeVenue ?? false,
      state: states.get(subject.id)!,
    };
  });

const storedDates = (f: Fixture) =>
  withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ id: specialDates.id })
      .from(specialDates)
      .where(eq(specialDates.locationId, f.cfg.locationId))
      .orderBy(asc(specialDates.date));
    const dates = [];
    for (const row of rows) dates.push(await readSpecialDate(tx, f.cfg, row.id));
    return dates;
  });

const tone = (f: Fixture, date: LocalDate) =>
  withTransaction(db, async (tx) => (await readCalendarDays(tx, f.cfg, date, date))[0]!.tone);

const duplicate = (
  f: Fixture,
  id: string,
  dates: unknown,
  participants?: readonly SpecialDateParticipant[],
) =>
  withTransaction(db, (tx) =>
    duplicateSpecialDate(tx, f.cfg, id, dates as LocalDate[], AT, participants),
  );

const remove = (f: Fixture, id: string, participants?: readonly SpecialDateParticipant[]) =>
  withTransaction(db, (tx) => deleteSpecialDate(tx, f.cfg, id, AT, participants));

const makeDefault = (f: Fixture, station: HoursSubject) =>
  withTransaction(db, async (tx) => {
    await tx
      .update(kitchenStations)
      .set({ isDefault: false })
      .where(eq(kitchenStations.id, f.kitchen.id));
    await tx
      .update(kitchenStations)
      .set({ isDefault: true })
      .where(eq(kitchenStations.id, station.id));
  });

const setDepartmentActive = (department: { id: string }, active: boolean) =>
  withTransaction(db, (tx) =>
    tx.update(departments).set({ active }).where(eq(departments.id, department.id)),
  );

async function addSubjects(f: Fixture) {
  return withTransaction(db, async (tx) => {
    const [terrace] = await tx
      .insert(departments)
      .values({
        locationId: f.cfg.locationId,
        name: `Terrace ${randomUUID()}`,
        tradingName: "Terrace",
      })
      .returning();
    const [terraceStation, grill] = await tx
      .insert(kitchenStations)
      .values([
        { locationId: f.cfg.locationId, name: "Terrace pass" },
        { locationId: f.cfg.locationId, name: `Grill ${randomUUID()}` },
      ])
      .returning();
    return {
      terraceDepartment: { kind: "department" as const, id: terrace!.id },
      terrace: { kind: "station", id: terraceStation!.id } as HoursSubject,
      grill: { kind: "station", id: grill!.id } as HoursSubject,
    };
  });
}

describe("a station that stops being the default", () => {
  const check = (f: Fixture, station: HoursSubject, at = AT) =>
    withTransaction(db, async (tx) => {
      const state = (await stationStates(tx, f.cfg, at)).get(station.id)!;
      return { open: state.open, sendsTo: state.sendsTo, why: state.why };
    });
  const demote = (f: Fixture) =>
    withTransaction(db, async (tx) => {
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.bar.id));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.kitchen.id));
      const stations = await tx
        .select({ id: kitchenStations.id, isDefault: kitchenStations.isDefault })
        .from(kitchenStations)
        .where(inArray(kitchenStations.id, [f.bar.id, f.kitchen.id]))
        .orderBy(asc(kitchenStations.id));
      expect(stations).toEqual(
        [
          { id: f.bar.id, isDefault: false },
          { id: f.kitchen.id, isDefault: true },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
    });
  const barDate = (f: Fixture, date: string, opensAt: string, closesAt: string) =>
    specialInput({
      date,
      name: date,
      cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(opensAt, closesAt)] } }],
    });

  it("keeps station states open when a named day moves during a default change", async () => {
    const f = await fixture();
    await seedNamedDate(f, barDate(f, "2026-10-09", "22:00", "03:00"));
    const later = await seedNamedDate(f, barDate(f, "2026-10-12", "01:00", "05:00"));
    await makeDefault(f, f.bar);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "default" });
    await saveDate(f, later.id, specialInput({ date: "2026-10-10", name: later.name }));
    await demote(f);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
  });

  it("keeps a demoted station open when a named day moves and is deleted", async () => {
    const f = await fixture();
    const date = await seedNamedDate(f, barDate(f, "2026-10-14", "01:00", "05:00"));
    await makeDefault(f, f.bar);
    await saveDate(f, date.id, specialInput({ date: "2026-10-10", name: date.name }));
    await demote(f);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
    await remove(f, date.id);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
  });

  it("keeps a demoted station open beside neighbouring named days", async () => {
    const f = await fixture();
    const date = await seedNamedDate(f, barDate(f, "2026-10-14", "22:00", "03:00"));
    await makeDefault(f, f.bar);
    await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-11",
        name: "Sunday",
        cells: [{ subject: f.restaurant, cell: { mode: "closed", periods: [] } }],
      }),
    );
    await saveDate(f, date.id, specialInput({ date: "2026-10-10", name: date.name }));
    await demote(f);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
    await remove(f, date.id);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
  });

  it("keeps a station open before and after neighbouring named days", async () => {
    const f = await fixture();
    await seedNamedDate(f, barDate(f, "2026-10-01", "22:00", "03:00"));
    await seedNamedDate(f, barDate(f, "2026-10-02", "01:00", "05:00"));
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
    expect(await check(f, f.bar, new Date("2026-09-30T10:00:00Z"))).toEqual({
      open: true,
      sendsTo: null,
      why: "open",
    });
  });

  it("keeps a demoted station open after copying a named day", async () => {
    const f = await fixture();
    const forward = clockChangeAfter("Europe/Madrid", "2027-01-01T00:00:00Z", "forward");
    const skipped = minutesAfter(forward.before, 1);
    const weekEarlier = new Date(Date.parse(`${forward.date}T00:00:00Z`) - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const source = await seedNamedDate(f, barDate(f, weekEarlier, skipped, "12:00"));
    await makeDefault(f, f.bar);
    await duplicate(f, source.id, [forward.date]);
    await demote(f);
    expect(await check(f, f.bar)).toEqual({ open: true, sendsTo: null, why: "open" });
    expect(
      await check(f, f.bar, new Date(Date.parse(`${forward.date}T12:00:00Z`) + 2 * 86_400_000)),
    ).toEqual({ open: true, sendsTo: null, why: "open" });
  });
});

describe("calendar facts beside station states", () => {
  it("reads named-day identity and station states on named and ordinary dates", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    // Monday 12 October.
    const monday = await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-12",
        cells: [
          { subject: f.restaurant, cell: { mode: "inherit", periods: [] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "periods", periods: [lunch] } },
        ],
      }),
    );

    expect(await dateSnapshot(f, f.restaurant, "2026-10-12")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.deli, "2026-10-12")).toMatchObject({
      subject: f.deli,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-12")).toMatchObject({
      subject: f.bar,
      openingDate: "2026-10-12",
      specialDateId: monday.id,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });

    expect(await dateSnapshot(f, f.deli, "2026-10-19")).toMatchObject({
      subject: f.deli,
      openingDate: "2026-10-19",
      specialDateId: null,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.kitchen, "2026-10-19")).toMatchObject({
      subject: f.kitchen,
      openingDate: "2026-10-19",
      specialDateId: null,
      state: { open: true, isDefault: true },
    });
  });

  it("keeps named-day identity and station states when its name and date change", async () => {
    const f = await fixture();
    const closedDeli: DateHoursCell = { subject: f.deli, cell: { mode: "closed", periods: [] } };
    const first = await seedNamedDate(f, specialInput({ cells: [closedDeli] }));
    const moved = await saveDate(
      f,
      first.id,
      specialInput({ date: "2026-10-13", name: "Moved", cells: [closedDeli] }),
    );
    expect(moved.id).toBe(first.id);
    expect(await dateSnapshot(f, f.deli, "2026-10-13")).toMatchObject({
      specialDateId: first.id,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.deli, "2026-10-09")).toMatchObject({
      specialDateId: null,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
  });

  it("refuses a calendar date that does not exist", async () => {
    const f = await fixture();
    await expect(
      withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, "2026-02-30", "2026-02-30")),
    ).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "from" },
    });
    await expect(tone(f, "2026-02-30")).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field: "from" },
    });
  });
});

describe("closing the whole venue on a date", () => {
  it("a whole-venue closure leaves prep stations open, new ones included", async () => {
    const f = await fixture();
    const evening = period("18:00", "22:00");
    const cells = [
      { subject: f.deli, cell: { mode: "periods", periods: [evening] } },
      { subject: f.bar, cell: { mode: "all_day", periods: [] } },
    ] as SpecialDateInput["cells"];
    const friday = await seedNamedDate(f, specialInput({ closeWholeVenue: true, cells }));
    const added = await addSubjects(f);

    for (const subject of [f.restaurant, f.deli, f.bar, added.terrace, added.grill])
      expect(await dateSnapshot(f, subject, "2026-10-09")).toMatchObject({
        subject,
        openingDate: "2026-10-09",
        specialDateId: friday.id,
        closeWholeVenue: true,
        state: { open: true, isDefault: false },
      });
    expect(await dateSnapshot(f, f.kitchen, "2026-10-09")).toMatchObject({
      subject: f.kitchen,
      openingDate: "2026-10-09",
      specialDateId: friday.id,
      state: { open: true, isDefault: true },
    });

    const kept = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, friday.id));
    expect(kept).toEqual(friday);
    await saveDate(f, friday.id, specialInput({ closeWholeVenue: false, cells }));
    expect(await dateSnapshot(f, f.deli, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
    expect(await dateSnapshot(f, added.terrace, "2026-10-09")).toMatchObject({
      closeWholeVenue: false,
      state: { isDefault: false },
    });
  });
});

describe("the calendar's Closed colour", () => {
  it("is Closed when no active department has a service range, whatever the stations do", async () => {
    const f = await fixture();
    const deliPeriod = await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const restaurantPeriod = await saveMenuPeriod(tx, f.cfg, f.departmentIds.restaurant, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      const deliPeriod = await saveMenuPeriod(tx, f.cfg, f.departmentIds.deli, {
        name: "Deli",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.departmentIds.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 1
              ? [{ periodId: restaurantPeriod.id, startsAt: "09:00", endsAt: "17:00" }]
              : [],
        })),
        AT,
      );
      return deliPeriod;
    });
    expect(await tone(f, "2026-10-19")).toBe("standard");
    expect(await tone(f, "2026-10-20")).toBe("closed");
    for (const [date, open] of [
      ["2026-10-21", false],
      ["2026-10-22", true],
      ["2026-10-23", true],
    ] as const) {
      const special = await saveDate(
        f,
        null,
        specialInput({
          date,
          cells: [{ subject: f.bar, cell: { mode: "all_day", periods: [] } }],
        }),
      );
      await db.update(specialDates).set({ ownHours: true }).where(eq(specialDates.id, special.id));
      if (open)
        await withTransaction(db, (tx) =>
          saveSpecialDateMenus(
            tx,
            f.cfg,
            special.id,
            f.departmentIds.deli,
            [{ periodId: deliPeriod.id, startsAt: "10:00", endsAt: "14:00" }],
            AT,
          ),
        );
      expect(await tone(f, date)).toBe(open ? "blue" : "closed");
    }
    const { terraceDepartment: terrace } = await addSubjects(f);
    expect(await tone(f, "2026-10-21")).toBe("closed");
    await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const period = await saveMenuPeriod(tx, f.cfg, terrace.id, {
        name: "Terrace",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        f.cfg,
        terrace.id,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 3 ? [{ periodId: period.id, startsAt: "09:00", endsAt: "17:00" }] : [],
        })),
        AT,
      );
    });
    expect(await tone(f, "2026-10-21")).toBe("blue");
    await setDepartmentActive(terrace, false);
    expect(await tone(f, "2026-10-21")).toBe("closed");
    await saveDate(f, null, specialInput({ date: "2026-10-26", closeWholeVenue: true }));
    expect(await tone(f, "2026-10-26")).toBe("closed");
  });
});

describe("holiday facts beside the calendar", () => {
  // Invented facts: no fixture here claims a real public holiday.
  const fact = (id: string, date: LocalDate, name: string): HolidayFact => ({
    id,
    date,
    name,
    scope: "local",
    sourceId: "test-source",
  });
  const FACTS = [
    fact("h1", "2026-10-14", "Invented feast"),
    fact("h2", "2026-10-14", "Second invented feast"),
    fact("h3", "2026-10-16", "Another invented day"),
    fact("h4", "2026-11-30", "Outside the range"),
  ];
  /** A reader standing in for a later holiday provider; it records every call it gets. */
  function fakeReader() {
    const calls: { tx: Transaction; cfg: VenueScope; from: LocalDate; to: LocalDate }[] = [];
    const reader: HolidayReader = async (tx, cfg, from, to) => {
      calls.push({ tx, cfg, from, to });
      return FACTS;
    };
    return { reader, calls };
  }
  const calendar = (f: Fixture, reader?: HolidayReader) =>
    withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, "2026-10-13", "2026-10-16", reader));
  const holidaysOn = (days: CalendarDay[], date: LocalDate) =>
    days.find((day) => day.date === date)!.holidays.map((holiday) => holiday.id);

  it("merges each date's facts by date, asking the reader once with the caller's transaction", async () => {
    const f = await fixture();
    const { reader, calls } = fakeReader();
    let outer: Transaction | undefined;
    const days = await withTransaction(db, (tx) => {
      outer = tx;
      return readCalendarDays(tx, f.cfg, "2026-10-13", "2026-10-16", reader);
    });
    expect(calls).toEqual([{ tx: outer, cfg: f.cfg, from: "2026-10-13", to: "2026-10-16" }]);
    expect(calls[0]!.tx).toBe(outer);
    expect(days.map((day) => [day.date, day.holidays.map((holiday) => holiday.name)])).toEqual([
      ["2026-10-13", []],
      ["2026-10-14", ["Invented feast", "Second invented feast"]],
      ["2026-10-15", []],
      ["2026-10-16", ["Another invented day"]],
    ]);
    expect(days[1]!.holidays[0]).toEqual(FACTS[0]);
    // With no reader, no date has a fact.
    expect((await calendar(f)).every((day) => day.holidays.length === 0)).toBe(true);
  });

  it("reads holiday facts on an ordinary date", async () => {
    const f = await fixture();
    const { reader } = fakeReader();
    const wednesday = (await calendar(f, reader))[1]!;
    expect(wednesday).toEqual({
      date: "2026-10-14",
      specialDate: null,
      holidays: [FACTS[0], FACTS[1]],
      tone: "standard",
    });
    await dateSnapshot(f, f.restaurant, "2026-10-14");
  });

  it("keeps a date's facts as they are while a special date there is added, renamed and deleted", async () => {
    const f = await fixture();
    const { reader } = fakeReader();
    const before = holidaysOn(await calendar(f, reader), "2026-10-14");
    expect(before).toEqual(["h1", "h2"]);

    const added = await saveDate(
      f,
      null,
      specialInput({ date: "2026-10-14", name: "Our own party" }),
    );
    let days = await calendar(f, reader);
    expect(days[1]!.specialDate).toEqual({
      kind: "working_day",
      repeats: false,
      ownHours: false,
      id: added.id,
      date: "2026-10-14",
      name: "Our own party",

      closeWholeVenue: false,
    });
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await saveDate(f, added.id, specialInput({ date: "2026-10-14", name: "Renamed party" }));
    days = await calendar(f, reader);
    expect(days[1]!.specialDate?.name).toBe("Renamed party");
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);

    await withTransaction(db, (tx) => deleteSpecialDate(tx, f.cfg, added.id, AT));
    days = await calendar(f, reader);
    expect(days[1]!.specialDate).toBeNull();
    expect(holidaysOn(days, "2026-10-14")).toEqual(before);
  });

  it("lets another module read facts and a special date's id from the package, without the page", async () => {
    const f = await fixture();
    const added = await saveDate(f, null, specialInput({ date: "2026-10-16" }));
    const { reader } = fakeReader();
    const days = await withTransaction(db, (tx) =>
      packageReadCalendarDays(tx, f.cfg, "2026-10-16", "2026-10-16", reader),
    );
    expect(days).toEqual([
      {
        date: "2026-10-16",
        specialDate: {
          kind: "working_day",
          repeats: false,
          ownHours: false,
          id: added.id,
          date: "2026-10-16",
          name: "Harvest festival",

          closeWholeVenue: false,
        },
        holidays: [FACTS[2]],
        tone: "blue",
      },
    ]);
  });

  it("ignores the old reserved colour values and stores only the kind", async () => {
    const f = await fixture();
    for (const [index, colour] of ["standard", "closed"].entries()) {
      const date = index === 0 ? "2026-10-09" : "2026-10-10";
      const saved = await saveDate(f, null, {
        ...specialInput({ date }),
        colour,
      } as SpecialDateInput);
      expect(saved).toMatchObject({ date, kind: "working_day" });
      const [row] = await db.select().from(specialDates).where(eq(specialDates.id, saved.id));
      expect(row).toMatchObject({ date, kind: "working_day" });
      expect(saved).not.toHaveProperty("colour");
      expect(row).not.toHaveProperty("colour");
    }
    expect(
      await withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, "2026-10-09", "2026-10-10")),
    ).toMatchObject([
      { date: "2026-10-09", tone: "blue" },
      { date: "2026-10-10", tone: "blue" },
    ]);
  });

  it("gives the page model the same facts", async () => {
    const f = await fixture();
    const { reader, calls } = fakeReader();
    const model = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, "2026-10-13", "2026-10-16", reader),
    );
    expect(calls.map(({ from, to }) => [from, to])).toEqual([["2026-10-13", "2026-10-16"]]);
    expect(model.map((day) => day.holidays.map((holiday) => holiday.id))).toEqual([
      [],
      ["h1", "h2"],
      [],
      ["h3"],
    ]);
  });
});

describe("duplicating a special date", () => {
  it("copies the named-day fields under new ids without station cells, inactive stations included", async () => {
    const f = await fixture();
    const lunch = period("12:00", "15:00");
    const dinner = period("19:00", "23:00");
    const source = await seedNamedDate(
      f,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "periods", periods: [lunch, dinner] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "all_day", periods: [] } },
        ],
      }),
    );
    await withTransaction(db, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.deli.id)),
    );
    const sourceBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));

    const copies = await duplicate(f, source.id, ["2026-10-23", "2026-10-30"]);
    expect(copies).toEqual([
      { ...source, id: expect.any(String), date: "2026-10-23" },
      { ...source, id: expect.any(String), date: "2026-10-30" },
    ]);
    const ids = new Set([source.id, ...copies.map((copy) => copy.id)]);
    expect(ids.size).toBe(3);

    for (const copy of copies) {
      expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id))).toEqual({
        ...copy,
      });
    }
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual(
      sourceBefore,
    );
  });

  it("copies a whole-venue closure without the retired station cells", async () => {
    const f = await fixture();
    const cells = [
      { subject: f.bar, cell: { mode: "all_day", periods: [] } },
    ] as SpecialDateInput["cells"];
    const source = await seedNamedDate(f, specialInput({ closeWholeVenue: true, cells }));
    const [copy] = await duplicate(f, source.id, ["2026-10-16"]);
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy!.id))).toEqual({
      ...source,
      id: copy!.id,
      date: "2026-10-16",
    });
    expect(await dateSnapshot(f, f.bar, "2026-10-16")).toMatchObject({
      closeWholeVenue: true,
      state: { open: true, isDefault: false },
    });
  });

  it("copies a Monday named day to Sunday without changing station states", async () => {
    const f = await fixture();
    const monday = await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-12",
        cells: [
          { subject: f.restaurant, cell: { mode: "inherit", periods: [] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    const [copy] = await duplicate(f, monday.id, ["2026-10-18"]);
    expect(await dateSnapshot(f, f.restaurant, "2026-10-18")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-18",
      specialDateId: copy!.id,
      closeWholeVenue: false,
      state: { isDefault: false },
    });
  });

  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const skipped = minutesAfter(forward.before, 1);

  const refusals: [
    string,
    (f: Fixture) => Promise<{ sourceId: string; dates: unknown }>,
    { code: string; params: Record<string, unknown> },
  ][] = [
    [
      "a target repeated within the batch",
      async (f) => ({
        sourceId: (await seedNamedDate(f, specialInput())).id,
        dates: ["2026-10-20", "2026-10-21", "2026-10-20"],
      }),
      { code: "hours.invalid", params: { field: "dates.2" } },
    ],
    [
      "a target another special date holds",
      async (f) => {
        await seedNamedDate(f, specialInput({ date: "2026-10-21" }));
        return {
          sourceId: (await seedNamedDate(f, specialInput())).id,
          dates: ["2026-10-20", "2026-10-21"],
        };
      },
      { code: "special_date.date_taken", params: { date: "2026-10-21" } },
    ],
    [
      "a date that does not exist",
      async (f) => ({
        sourceId: (await seedNamedDate(f, specialInput())).id,
        dates: ["2026-10-20", "2026-02-30"],
      }),
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
    [
      "the source's own date",
      async (f) => ({
        sourceId: (await seedNamedDate(f, specialInput())).id,
        dates: ["2026-10-20", "2026-10-09"],
      }),
      { code: "special_date.date_taken", params: { date: "2026-10-09" } },
    ],
    [
      "no targets at all",
      async (f) => ({
        sourceId: (await seedNamedDate(f, specialInput())).id,
        dates: [],
      }),
      { code: "hours.invalid", params: { field: "dates" } },
    ],
    [
      "targets that are not a list",
      async (f) => ({
        sourceId: (await seedNamedDate(f, specialInput())).id,
        dates: "2026-10-20",
      }),
      { code: "hours.invalid", params: { field: "dates" } },
    ],
  ];

  const retiredSchedules: [
    string,
    (f: Fixture) => Promise<{ sourceId: string; dates: string[] }>,
  ][] = [
    [
      "a copied period that opens at a minute the clock skips on a target",
      async (f) => ({
        sourceId: (
          await seedNamedDate(
            f,
            specialInput({
              date: "2027-02-10",
              cells: [
                { subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } },
              ],
            }),
          )
        ).id,
        dates: ["2027-02-17", forward.date],
      }),
    ],
    [
      "a target whose copied tail runs into the next day's standard opening",
      async (f) => {
        const source = await seedNamedDate(
          f,
          specialInput({
            date: "2026-10-07",
            cells: [
              {
                subject: f.restaurant,
                cell: { mode: "periods", periods: [period("22:00", "03:00")] },
              },
            ],
          }),
        );
        return { sourceId: source.id, dates: ["2026-10-14", "2026-10-16"] };
      },
    ],
    [
      "two adjacent targets whose copies overlap each other",
      async (f) => ({
        sourceId: (
          await seedNamedDate(
            f,
            specialInput({
              date: "2026-10-07",
              cells: [
                {
                  subject: f.bar,
                  cell: {
                    mode: "periods",
                    periods: [period("01:00", "05:00"), period("22:00", "03:00")],
                  },
                },
              ],
            }),
          )
        ).id,
        dates: ["2026-10-20", "2026-10-21"],
      }),
    ],
  ];
  it.each(retiredSchedules)("copies a named day despite %s", async (_, make) => {
    const f = await fixture();
    const { sourceId, dates } = await make(f);
    const sourceBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, sourceId));
    const copies = await duplicate(f, sourceId, dates);
    expect(copies.map((copy) => copy.date)).toEqual(dates);
    for (const copy of copies) {
      expect(copy).toEqual({ ...sourceBefore, id: copy.id, date: copy.date });
    }
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, sourceId))).toEqual(
      sourceBefore,
    );
  });

  it.each(refusals)("refuses %s and creates no target at all", async (_, make, expected) => {
    const f = await fixture();
    const { sourceId, dates } = await make(f);
    const before = await storedDates(f);
    const named = (value: unknown) =>
      value === "bar" ? f.bar.id : value === "restaurant" ? f.restaurant.id : value;
    await expect(duplicate(f, sourceId, dates)).rejects.toMatchObject({
      code: expected.code,
      params: Object.fromEntries(
        Object.entries(expected.params).map(([key, value]) => [key, named(value)]),
      ),
    });
    expect(await storedDates(f)).toEqual(before);
  });

  it("keeps the default station open after copying a named day", async () => {
    const f = await fixture();
    const evening = period("18:00", "22:00");
    const source = await seedNamedDate(
      f,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [evening] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);
    const copies = await duplicate(f, source.id, ["2026-10-20", "2026-10-21"]);
    expect(copies.map((copy) => copy.date)).toEqual(["2026-10-20", "2026-10-21"]);
    for (const copy of copies) {
      const read = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id));
      expect(read).toEqual({ ...copy });
      expect(await dateSnapshot(f, f.bar, copy.date)).toMatchObject({
        subject: f.bar,
        openingDate: copy.date,
        specialDateId: copy.id,
        state: { open: true, isDefault: true },
      });
    }
  });

  it("copies the named day onto a clock-change day without dormant default-station cells", async () => {
    const f = await fixture();
    const source = await seedNamedDate(
      f,
      specialInput({
        date: "2027-02-10",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } }],
      }),
    );
    await makeDefault(f, f.bar);
    const [copy] = await duplicate(f, source.id, [forward.date]);
    expect(copy!.date).toBe(forward.date);
  });

  it("copies a named day without station cells while the venue's clock cannot be read", async () => {
    const f = await fixture();
    const source = await seedNamedDate(
      f,
      specialInput({
        date: "2027-02-10",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period(skipped, "12:00")] } }],
      }),
    );
    await withTransaction(db, (tx) =>
      tx.update(locations).set({ timeZone: "Mars/Base" }).where(eq(locations.id, f.cfg.locationId)),
    );
    const [copy] = await duplicate(f, source.id, [forward.date]);
    expect(copy!.date).toBe(forward.date);
  });

  it("copies separated named days without retaining station hours", async () => {
    const f = await fixture();
    const source = await seedNamedDate(
      f,
      specialInput({
        date: "2026-10-07",
        cells: [
          {
            subject: f.bar,
            cell: {
              mode: "periods",
              periods: [period("01:00", "05:00"), period("22:00", "03:00")],
            },
          },
        ],
      }),
    );
    const copies = await duplicate(f, source.id, ["2026-10-20", "2026-10-22"]);
    expect(copies.map((copy) => copy.date)).toEqual(["2026-10-20", "2026-10-22"]);
  });
});

describe("deleting a special date", () => {
  it("deletes a named day, keeps station states and refuses a second delete", async () => {
    const f = await fixture();
    const date = await seedNamedDate(
      f,
      specialInput({
        cells: [
          { subject: f.restaurant, cell: { mode: "closed", periods: [] } },
          { subject: f.bar, cell: { mode: "periods", periods: [period("10:00", "14:00")] } },
        ],
      }),
    );

    await remove(f, date.id);

    expect(await storedDates(f)).toEqual([]);

    expect(await dateSnapshot(f, f.restaurant, "2026-10-09")).toMatchObject({
      subject: f.restaurant,
      openingDate: "2026-10-09",
      specialDateId: null,
      closeWholeVenue: false,
      state: { isDefault: false },
    });
    await expect(remove(f, date.id)).rejects.toMatchObject({
      code: "special_date.not_found",
      params: { specialDateId: date.id },
    });
  });

  const withBar = (f: Fixture, date: LocalDate, cell: DateHoursCell["cell"]) =>
    specialInput({ date, cells: [{ subject: f.bar, cell }] });
  const closedCell: DateHoursCell["cell"] = { mode: "closed", periods: [] };

  it("deletes a named day despite a retired station-hours clash with the date before it", async () => {
    const f = await fixture();
    const saturday = await seedNamedDate(f, withBar(f, "2026-10-17", closedCell));
    await seedNamedDate(
      f,
      withBar(f, "2026-10-16", { mode: "periods", periods: [period("22:00", "03:00")] }),
    );
    const before = await storedDates(f);
    let checked = false;
    const participant: SpecialDateParticipant = {
      async copy() {},
      async beforeDelete(tx, cfg, id) {
        expect(cfg).toEqual(f.cfg);
        expect(id).toBe(saturday.id);
        expect(await tx.select().from(specialDates).where(eq(specialDates.id, id))).toHaveLength(1);
        checked = true;
      },
    };
    await remove(f, saturday.id, [participant]);
    expect(checked).toBe(true);
    expect(await storedDates(f)).toEqual(before.filter((row) => row.id !== saturday.id));
  });

  it("deletes a named day despite a retired station-hours clash with the date after it", async () => {
    const f = await fixture();
    const friday = await seedNamedDate(f, withBar(f, "2026-10-16", closedCell));
    await seedNamedDate(
      f,
      withBar(f, "2026-10-17", { mode: "periods", periods: [period("01:00", "05:00")] }),
    );
    const before = await storedDates(f);
    await remove(f, friday.id);
    expect(await storedDates(f)).toEqual(before.filter((row) => row.id !== friday.id));
  });

  it("deletes a past date beside such a neighbour, since past hours block nothing", async () => {
    const f = await fixture();
    // Friday 25 and Saturday 26 September are in the past at AT.
    const saturday = await seedNamedDate(f, withBar(f, "2026-09-26", closedCell));
    await seedNamedDate(
      f,
      withBar(f, "2026-09-25", { mode: "periods", periods: [period("22:00", "03:00")] }),
    );
    await remove(f, saturday.id);
    expect((await storedDates(f)).map((date) => date.date)).toEqual(["2026-09-25"]);
  });

  it("refuses another venue reading, changing, copying or deleting the date", async () => {
    const f = await fixture();
    const other = await fixture();
    const date = await seedNamedDate(
      f,
      specialInput({ cells: [{ subject: f.deli, cell: { mode: "closed", periods: [] } }] }),
    );
    const before = await storedDates(f);
    const notFound = { code: "special_date.not_found", params: { specialDateId: date.id } };

    await expect(
      withTransaction(db, (tx) => readSpecialDate(tx, other.cfg, date.id)),
    ).rejects.toMatchObject(notFound);
    await expect(
      saveDate(other, date.id, specialInput({ date: "2026-10-20" })),
    ).rejects.toMatchObject(notFound);
    await expect(duplicate(other, date.id, ["2026-10-20"])).rejects.toMatchObject(notFound);
    await expect(remove(other, date.id)).rejects.toMatchObject(notFound);

    expect(await storedDates(f)).toEqual(before);
    expect(await storedDates(other)).toEqual([]);
  });
});

describe("calendar participants", () => {
  it("is the menu timetable's alone", () => {
    expect(VENUE_SERVICE_CALENDAR_PARTICIPANTS).toEqual([MENU_TIMETABLE_CALENDAR_PARTICIPANT]);
  });

  // A stand-in for a module's own date-linked rows, such as a menu timetable's overrides.
  beforeAll(async () => {
    await withTransaction(db, (tx) =>
      tx.run(
        sql`create table if not exists participant_copies (participant text not null, source_id text not null, target_id text not null)`,
      ),
    );
  });

  const participantRows = (targetIds: string[]) =>
    withTransaction(db, (tx) =>
      tx.all<{ participant: string; source_id: string; target_id: string }>(
        sql`select participant, source_id, target_id from participant_copies where target_id in (${sql.join(
          targetIds.map((id) => sql`${id}`),
          sql`, `,
        )}) order by participant, target_id`,
      ),
    );

  interface Call {
    tx: Transaction;
    kind: "copy" | "beforeDelete";
    sourceId?: string;
    targetId?: string;
    id?: string;
    targetExists?: boolean;
  }

  function recorder(name: string, failOn: { copy?: number; beforeDelete?: boolean } = {}) {
    const calls: Call[] = [];
    const participant: SpecialDateParticipant = {
      async copy(tx, cfg, sourceId, targetId) {
        const [target] = await tx
          .select()
          .from(specialDates)
          .where(and(eq(specialDates.id, targetId), eq(specialDates.locationId, cfg.locationId)));
        calls.push({
          tx,
          kind: "copy",
          sourceId,
          targetId,
          targetExists: target !== undefined,
        });
        await tx.run(
          sql`insert into participant_copies (participant, source_id, target_id) values (${name}, ${sourceId}, ${targetId})`,
        );
        if (calls.filter((call) => call.kind === "copy").length === failOn.copy)
          throw new Error(`${name} refused target ${failOn.copy}`);
      },
      async beforeDelete(tx, _cfg, id) {
        calls.push({ tx, kind: "beforeDelete", id });
        if (failOn.beforeDelete) throw new Error(`${name} refused the delete`);
      },
    };
    return { participant, calls };
  }

  it("hands every existing target to every participant inside the same transaction", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "closed", periods: [] } },
          { subject: f.deli, cell: { mode: "all_day", periods: [] } },
        ],
      }),
    );
    const menus = recorder("menus");
    const wages = recorder("wages");
    let outer: Transaction | undefined;
    const copies = await withTransaction(db, (tx) => {
      outer = tx;
      return duplicateSpecialDate(
        tx,
        f.cfg,
        source.id,
        ["2026-10-20", "2026-10-21", "2026-10-22"],
        AT,
        [menus.participant, wages.participant],
      );
    });
    const targetIds = copies.map((copy) => copy.id);
    for (const { calls } of [menus, wages]) {
      expect(
        calls.map(({ kind, sourceId, targetId, targetExists }) => ({
          kind,
          sourceId,
          targetId,
          targetExists,
        })),
      ).toEqual(
        targetIds.map((targetId) => ({
          kind: "copy",
          sourceId: source.id,
          targetId,
          targetExists: true,
        })),
      );
      for (const call of calls) expect(call.tx).toBe(outer);
    }
    expect(await participantRows(targetIds)).toEqual(
      ["menus", "wages"].flatMap((participant) =>
        [...targetIds].sort().map((target_id) => ({
          participant,
          source_id: source.id,
          target_id,
        })),
      ),
    );
  });

  it("creates no target or participant row when a participant fails on the second target", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } }],
      }),
    );
    const before = await storedDates(f);
    const menus = recorder("menus", { copy: 2 });

    await expect(
      duplicate(f, source.id, ["2026-10-20", "2026-10-21", "2026-10-22"], [menus.participant]),
    ).rejects.toThrow("menus refused target 2");

    const targetIds = menus.calls.map((call) => call.targetId!);
    expect(targetIds).toHaveLength(2);
    expect(await storedDates(f)).toEqual(before);
    expect(await participantRows(targetIds)).toEqual([]);
  });

  it("asks every participant before deleting, inside the deleting transaction", async () => {
    const f = await fixture();
    const date = await saveDate(f, null, specialInput());
    const menus = recorder("menus");
    const wages = recorder("wages");
    let outer: Transaction | undefined;
    await withTransaction(db, (tx) => {
      outer = tx;
      return deleteSpecialDate(tx, f.cfg, date.id, AT, [menus.participant, wages.participant]);
    });
    for (const { calls } of [menus, wages]) {
      expect(calls.map(({ kind, id }) => ({ kind, id }))).toEqual([
        { kind: "beforeDelete", id: date.id },
      ]);
      expect(calls[0]!.tx).toBe(outer);
    }
    expect(await storedDates(f)).toEqual([]);
  });

  it("keeps the named day when a participant refuses the delete", async () => {
    const f = await fixture();
    const date = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    const before = await storedDates(f);
    const menus = recorder("menus", { beforeDelete: true });

    await expect(remove(f, date.id, [menus.participant])).rejects.toThrow(
      "menus refused the delete",
    );

    expect(await storedDates(f)).toEqual(before);
  });
});

describe("renaming a special date", () => {
  it("changes only the named day name", async () => {
    const f = await fixture();
    const source = await saveDate(
      f,
      null,
      specialInput({
        closeWholeVenue: true,
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } }],
      }),
    );
    await makeDefault(f, f.bar);
    const before = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));
    const renamed = await withTransaction(db, (tx) =>
      renameSpecialDate(tx, f.cfg, source.id, "  Feast day "),
    );
    expect(renamed).toEqual({ ...source, name: "Feast day" });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual({
      ...before,
      name: "Feast day",
    });
  });

  it("refuses a blank name and another venue's date, writing nothing", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, specialInput());
    const before = await storedDates(f);
    for (const name of ["   ", "", 7])
      await expect(
        withTransaction(db, (tx) => renameSpecialDate(tx, f.cfg, source.id, name as string)),
      ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "name" } });
    const other = await fixture();
    await expect(
      withTransaction(db, (tx) => renameSpecialDate(tx, other.cfg, source.id, "Feast day")),
    ).rejects.toMatchObject({ code: "special_date.not_found" });
    expect(await storedDates(f)).toEqual(before);
  });
});

describe("Hours with the holiday store", () => {
  const SHA = "a".repeat(64);
  const long = (letter: string) => letter.repeat(200);
  /** An invented country, so nothing here depends on a real country's holidays. */
  function pack(repeatFacts = false, reads?: string[]): CountryPack {
    const calendar = createHolidayCalendar({
      localEntryLimit: 2,
      sources: [
        { id: "ZZ-ANNEX", title: "Invented annex", url: "https://example.test/annex", sha256: SHA },
      ],
      provinceRegions: { "10": "R1" },
      areas: [],
      years: [
        {
          year: 2026,
          dataVersion: "ZZ-2026.1",
          sourceIds: ["ZZ-ANNEX"],
          rows: [
            ...(
              [
                ["feast", "2026-12-25", "National label", "national"],
                ["north", "2026-12-25", "Regional label", "regional"],
                ["long-n", "2026-08-03", long("a"), "national"],
                ["long-r", "2026-08-03", long("b"), "regional"],
              ] as const
            ).map(([key, date, name, scope]) => ({
              key,
              date,
              name,
              scope,
              regions: ["R1"],
              sourceId: "ZZ-ANNEX",
            })),
          ],
        },
      ],
    });
    return {
      countryCode: "ZZ",
      defaultLocale: "en-GB",
      defaultTimeZone: "Europe/Madrid",
      invoiceLocales: ["en-GB"],
      moduleIds: [],
      availableForVenueSetup: false,
      fiscalJurisdictions: [],
      administrativeAreas: [{ code: "10", name: "Northshire", postalPrefixes: [] }],
      holidayCalendar: {
        ...calendar,
        read: (input) => {
          reads?.push(`${input.from}..${input.to}`);
          const read = calendar.read(input);
          return repeatFacts ? { ...read, facts: [...read.facts, ...read.facts] } : read;
        },
      },
    };
  }
  const store = createHolidayStore((country) => (country === "ZZ" ? pack() : undefined));

  // The file shares one taxpayer row; put back whatever it held before each case moved it.
  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  async function placed(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ZZ", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ZZ" } });
      await tx
        .update(locations)
        .set({ province: "Northshire", city: "Villa Real" })
        .where(eq(locations.id, f.cfg.locationId));
    });
    return f;
  }

  const named = (
    f: Fixture,
    id: string,
    dates: unknown,
    participants?: readonly SpecialDateParticipant[],
  ) =>
    withTransaction(db, (tx) =>
      store.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        id,
        dates as LocalDate[],
        AT,
        participants,
      ),
    );

  it("reads a holiday with no special date as its facts beside the standard hours", async () => {
    const f = await placed();
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, "2026-12-24", "2026-12-26", store.readHolidayFacts),
    );
    expect(days[1]).toEqual({
      date: "2026-12-25",
      specialDate: null,
      holidays: [
        {
          id: "shipped:feast",
          date: "2026-12-25",
          name: "National label",
          scope: "national",
          sourceId: "ZZ-ANNEX",
        },
        {
          id: "shipped:north",
          date: "2026-12-25",
          name: "Regional label",
          scope: "regional",
          sourceId: "ZZ-ANNEX",
        },
      ],
      tone: "standard",
    });
    expect([days[0]!.holidays, days[2]!.holidays]).toEqual([[], []]);
    expect(await dateSnapshot(f, f.restaurant, "2026-12-25")).toMatchObject({
      closeWholeVenue: false,
      specialDateId: null,
      state: { isDefault: false },
    });
  });

  it("gives the calendar a fact the provider repeats only once", async () => {
    const f = await placed();
    const repeating = createHolidayStore((country) => (country === "ZZ" ? pack(true) : undefined));
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, "2026-12-25", "2026-12-25", repeating.readHolidayFacts),
    );
    expect(days[0]!.holidays.map(({ id }) => id)).toEqual(["shipped:feast", "shipped:north"]);
  });

  it("keeps a holiday's facts while a special date there is saved, renamed, moved and deleted", async () => {
    const f = await placed();
    const calendar = () =>
      withTransaction(db, (tx) =>
        readCalendarDays(tx, f.cfg, "2026-12-24", "2026-12-25", store.readHolidayFacts),
      );
    const before = await calendar();
    const added = await saveDate(f, null, specialInput({ date: "2026-12-25", name: "Ours" }));
    expect((await calendar())[1]).toEqual({
      ...before[1],
      specialDate: { ...added },
      tone: "blue",
    });
    await saveDate(f, added.id, specialInput({ date: "2026-12-25", name: "Renamed" }));
    expect((await calendar())[1]!.holidays).toEqual(before[1]!.holidays);
    await saveDate(f, added.id, specialInput({ date: "2026-12-24", name: "Renamed" }));
    const moved = await calendar();
    expect(moved.map(({ specialDate }) => specialDate?.id ?? null)).toEqual([added.id, null]);
    expect(moved.map(({ holidays }) => holidays)).toEqual(before.map(({ holidays }) => holidays));
    await remove(f, added.id);
    expect(await calendar()).toEqual(before);
  });

  // A stand-in for a module's own date-linked rows.
  beforeAll(async () => {
    await withTransaction(db, (tx) =>
      tx.run(
        sql`create table if not exists holiday_participant_copies (source_id text not null, target_id text not null)`,
      ),
    );
  });
  const copiedRows = (targetIds: string[]) =>
    withTransaction(db, (tx) =>
      tx.all<{ source_id: string; target_id: string }>(
        sql`select source_id, target_id from holiday_participant_copies where target_id in (${sql.join(
          targetIds.map((id) => sql`${id}`),
          sql`, `,
        )}) order by target_id`,
      ),
    );
  function participant(failOnCopy?: number) {
    const calls: { tx: Transaction; targetId: string }[] = [];
    const value: SpecialDateParticipant = {
      async copy(tx, _cfg, sourceId, targetId) {
        calls.push({ tx, targetId });
        await tx.run(
          sql`insert into holiday_participant_copies (source_id, target_id) values (${sourceId}, ${targetId})`,
        );
        if (calls.length === failOnCopy) throw new Error(`refused target ${failOnCopy}`);
      },
      async beforeDelete() {},
    };
    return { value, calls };
  }

  it("names copies from holiday facts or the source, retaining calendar fields without station cells", async () => {
    const f = await placed();
    const source = await saveDate(
      f,
      null,
      specialInput({
        date: "2026-12-18",
        name: "Summer opening",

        closeWholeVenue: true,
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [period("12:00", "15:00")] } },
          { subject: f.deli, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    await makeDefault(f, f.bar);
    const sourceBefore = await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id));
    const menus = participant();
    let outer: Transaction | undefined;
    const copies = await withTransaction(db, (tx) => {
      outer = tx;
      return store.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        source.id,
        ["2026-12-25", "2026-12-29"],
        AT,
        [menus.value],
      );
    });
    expect(copies).toEqual([
      {
        kind: "working_day",
        repeats: false,
        ownHours: false,
        id: expect.any(String),
        date: "2026-12-25",
        name: "National label · Regional label",

        closeWholeVenue: true,
      },
      {
        kind: "working_day",
        repeats: false,
        ownHours: false,
        id: expect.any(String),
        date: "2026-12-29",
        name: "Summer opening",

        closeWholeVenue: true,
      },
    ]);
    expect(new Set([source.id, ...copies.map(({ id }) => id)]).size).toBe(3);
    for (const copy of copies) {
      expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy.id))).toEqual({
        ...copy,
      });
    }
    expect(menus.calls.map(({ targetId }) => targetId)).toEqual(copies.map(({ id }) => id));
    for (const call of menus.calls) expect(call.tx).toBe(outer);
    expect(await copiedRows(copies.map(({ id }) => id))).toEqual(
      copies
        .map(({ id }) => ({ source_id: source.id, target_id: id }))
        .sort((a, b) => (a.target_id < b.target_id ? -1 : 1)),
    );
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, source.id))).toEqual(
      sourceBefore,
    );
  });

  it("names targets more than a year apart, keeping the source name where the year is not shipped", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput({ name: "Summer opening" }));
    const copies = await named(f, source.id, ["2028-01-05", "2026-12-25"]);
    expect(copies.map(({ date, name }) => [date, name])).toEqual([
      ["2028-01-05", "Summer opening"],
      ["2026-12-25", "National label · Regional label"],
    ]);
    const read = await withTransaction(db, (tx) =>
      store.readHolidays(tx, f.cfg, "2028-01-05", "2028-01-05"),
    );
    expect(read.facts).toEqual([]);
    expect(read.coverage).toMatchObject([{ year: 2028, nationalRegional: "missing_year" }]);
  });

  it("reads holidays once per calendar year the targets touch, not once per target", async () => {
    const f = await placed();
    const reads: string[] = [];
    const counting = createHolidayStore((country) =>
      country === "ZZ" ? pack(false, reads) : undefined,
    );
    const source = await saveDate(f, null, specialInput({ name: "Summer opening" }));
    await withTransaction(db, (tx) =>
      counting.duplicateHolidayNamedSpecialDates(
        tx,
        f.cfg,
        source.id,
        ["2026-12-25", "2028-01-05", "2026-11-02", "2026-12-29"],
        AT,
      ),
    );
    expect(reads.sort()).toEqual(["2026-11-02..2026-12-29", "2028-01-05..2028-01-05"]);
  });

  it("keeps a joined name of two 200-character public labels whole", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const [copy] = await named(f, source.id, ["2026-08-03"]);
    const joined = `${long("a")} · ${long("b")}`;
    expect(copy!.name).toBe(joined);
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, copy!.id))).name).toBe(
      joined,
    );
  });

  const refusals: [string, (f: Fixture, sourceId: string) => Promise<unknown[]>, object][] = [
    [
      "a target another special date holds",
      async (f) => {
        await saveDate(f, null, specialInput({ date: "2026-12-29" }));
        return ["2026-12-25", "2026-12-29"];
      },
      { code: "special_date.date_taken", params: { date: "2026-12-29" } },
    ],
    [
      "a repeated target",
      async () => ["2026-12-25", "2026-12-25"],
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
    [
      "the source's own date",
      async () => ["2026-12-25", "2026-10-09"],
      { code: "special_date.date_taken", params: { date: "2026-10-09" } },
    ],
    [
      "a date that does not exist",
      async () => ["2026-12-25", "2026-02-30"],
      { code: "hours.invalid", params: { field: "dates.1" } },
    ],
  ];

  it.each(refusals)("refuses %s and creates no target at all", async (_, make, expected) => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const dates = await make(f, source.id);
    const before = await storedDates(f);
    await expect(named(f, source.id, dates)).rejects.toMatchObject(expected);
    expect(await storedDates(f)).toEqual(before);
  });

  it("creates no target, rename or participant row when a participant fails on the second target", async () => {
    const f = await placed();
    const source = await saveDate(f, null, specialInput());
    const before = await storedDates(f);
    const menus = participant(2);
    await expect(named(f, source.id, ["2026-12-25", "2026-12-29"], [menus.value])).rejects.toThrow(
      "refused target 2",
    );
    expect(menus.calls).toHaveLength(2);
    expect(await storedDates(f)).toEqual(before);
    expect(await copiedRows(menus.calls.map(({ targetId }) => targetId))).toEqual([]);
  });

  it("is exported from the package index, bound to the installed country packs", () => {
    expect(installedDuplicateHolidayNamedSpecialDates).toBeTypeOf("function");
    expect(packageIndex.duplicateHolidayNamedSpecialDates).toBe(
      installedDuplicateHolidayNamedSpecialDates,
    );
    expect(renameSpecialDate).toBeTypeOf("function");
    expect(packageIndex.renameSpecialDate).toBe(renameSpecialDate);
  });
});

describe("Hours on a real Spanish public holiday", () => {
  // Monday 12 October 2026 is Spain's national day; Monday 5 October is an ordinary Monday.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";

  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await withTransaction(db, (tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await withTransaction(db, async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  async function seville(): Promise<Fixture> {
    const f = await fixture();
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
        .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
      await tx
        .update(locations)
        .set({ province: "Sevilla", city: "Sevilla" })
        .where(eq(locations.id, f.cfg.locationId));
    });
    return f;
  }

  it("shows holiday facts without changing station states", async () => {
    const f = await seville();
    const days = await withTransaction(db, (tx) =>
      readCalendarDays(tx, f.cfg, HOLIDAY, HOLIDAY, installedReadHolidayFacts),
    );
    expect(days).toEqual([
      {
        date: HOLIDAY,
        specialDate: null,
        holidays: [expect.objectContaining({ date: HOLIDAY, scope: "national" })],
        tone: "standard",
      },
    ]);
    for (const subject of [f.restaurant, f.bar, f.kitchen]) {
      const holiday = await dateSnapshot(f, subject, HOLIDAY);
      expect({ ...holiday, openingDate: ORDINARY }).toEqual(
        await dateSnapshot(f, subject, ORDINARY),
      );
    }
    expect(await storedDates(f)).toEqual([]);
  });

  it("reads a named day and station state alongside holiday facts", async () => {
    const f = await seville();
    const saved = await seedNamedDate(
      f,
      specialInput({
        date: HOLIDAY,
        cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }],
      }),
    );
    expect(await dateSnapshot(f, f.bar, HOLIDAY)).toMatchObject({
      specialDateId: saved.id,
      closeWholeVenue: false,
      state: { open: true, isDefault: false },
    });
  });
});

describe("named-day station occurrences", () => {
  async function namedDay(f: Fixture, overrides: Partial<typeof specialDates.$inferInsert> = {}) {
    return withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(specialDates)
        .values({
          locationId: f.cfg.locationId,
          date: "2026-12-25",
          name: "Navidad",

          repeatOn: "12-25",
          closeWholeVenue: true,
          ...overrides,
        })
        .returning();
      return row!;
    });
  }

  const calendar = (f: Fixture, from: LocalDate, to = from) =>
    withTransaction(db, (tx) => readCalendarDays(tx, f.cfg, from, to));

  it("closes the Calendar on each yearly occurrence without closing prep stations, adjacent dates or earlier years", async () => {
    const f = await fixture();
    await namedDay(f);
    const days = await calendar(f, "2027-12-20", "2027-12-31");
    expect(days.filter((day) => day.tone === "closed").map((day) => day.date)).toEqual([
      "2027-12-25",
    ]);
    expect(days.find((day) => day.date === "2027-12-25")?.specialDate).toMatchObject({
      date: "2027-12-25",
      closeWholeVenue: true,
      repeats: true,
    });
    expect(
      (await calendar(f, "2025-12-20", "2025-12-31")).every((day) => day.tone === "standard"),
    ).toBe(true);
    for (const at of ["2027-12-25T12:00:00Z", "2025-12-25T12:00:00Z"]) {
      const states = await withTransaction(db, (tx) => stationStates(tx, f.cfg, new Date(at)));
      for (const id of [f.bar.id, f.restaurant.id, f.kitchen.id])
        expect(states.get(id)?.open).toBe(true);
    }
  });

  it("applies a repeating leap-day Calendar closure only in leap years and only at its venue", async () => {
    const f = await fixture();
    await namedDay(f, { date: "2024-02-29", repeatOn: "02-29" });
    const [otherStation] = await withTransaction(db, (tx) =>
      tx
        .select({ locationId: kitchenStations.locationId })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, f.otherStation.id)),
    );
    await namedDay(f, { locationId: otherStation!.locationId, date: "2027-12-25" });
    expect((await calendar(f, "2027-02-28", "2027-03-01")).map((day) => day.tone)).toEqual([
      "standard",
      "standard",
    ]);
    expect((await calendar(f, "2028-02-28", "2028-03-01")).map((day) => day.tone)).toEqual([
      "standard",
      "closed",
      "standard",
    ]);
    expect((await calendar(f, "2027-12-25")).map((day) => day.tone)).toEqual(["standard"]);
  });

  it("reports a recurring Calendar closure even when its first date is before the requested range", async () => {
    const f = await fixture();
    await namedDay(f);
    expect((await calendar(f, "2027-12-25"))[0]).toMatchObject({
      date: "2027-12-25",
      tone: "closed",
      specialDate: { closeWholeVenue: true, repeats: true },
    });
  });

  it("does not report a repeating Calendar closure when no occurrence remains in the date range", async () => {
    const f = await fixture();
    await namedDay(f, { date: "2024-02-29", repeatOn: "02-29" });
    expect((await calendar(f, "9999-01-01"))[0]).toMatchObject({
      date: "9999-01-01",
      tone: "standard",
      specialDate: null,
    });
  });

  it("does not report an expired one-off closure on a later Calendar date", async () => {
    const f = await fixture();
    await namedDay(f, { repeatOn: null });
    expect((await calendar(f, "2027-01-01"))[0]).toMatchObject({
      date: "2027-01-01",
      tone: "standard",
      specialDate: null,
    });
    expect((await calendar(f, "2026-12-25"))[0]).toMatchObject({
      date: "2026-12-25",
      tone: "closed",
      specialDate: { closeWholeVenue: true, repeats: false },
    });
  });

  it("saves a named date before a repeating closure despite neighbouring station hours", async () => {
    const f = await fixture();
    await namedDay(f, { date: "2028-12-25" });
    const saved = await saveDate(
      f,
      null,
      specialInput({
        date: "2027-12-24",
        cells: [{ subject: f.bar, cell: { mode: "periods", periods: [period("22:00", "02:00")] } }],
      }),
    );
    expect(saved).toMatchObject({ date: "2027-12-24", closeWholeVenue: false });
    expect((await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).date).toBe(
      "2027-12-24",
    );
  });
});

describe("named-day writes", () => {
  it.each([
    ["kind", null],
    ["kind", ["holiday"]],
    ["kind", "other"],
    ["repeats", null],
    ["repeats", 1],
    ["repeats", "false"],
    ["ownHours", null],
    ["ownHours", 0],
    ["ownHours", "true"],
    ["closeWholeVenue", null],
    ["closeWholeVenue", 1],
  ])("refuses invalid %s (%j) before storing anything", async (field, value) => {
    const f = await fixture();
    await expect(saveDate(f, null, { ...specialInput(), [field]: value })).rejects.toMatchObject({
      code: "hours.invalid",
      params: { field },
    });
    expect(
      await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
    ).toEqual([]);
  });

  it("stores a kind, yearly repeat key and own-hours choice", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, saved.id));
    expect(row).toMatchObject({
      date: "2026-12-25",
      kind: "holiday",
      repeatOn: "12-25",
      ownHours: true,
    });
  });

  it("defaults absent fields on create and retains stored values on update", async () => {
    const f = await fixture();
    const ordinary = await saveDate(f, null, specialInput());
    const [created] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(created).toMatchObject({ kind: "working_day", repeatOn: null, ownHours: false });
    await saveDate(f, ordinary.id, {
      ...specialInput(),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    await saveDate(f, ordinary.id, specialInput({ date: "2026-10-10", name: "Renamed" }));
    const [updated] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(updated).toMatchObject({
      name: "Renamed",
      kind: "holiday",
      repeatOn: "10-10",
      ownHours: true,
    });
    await saveDate(f, ordinary.id, {
      ...specialInput({ date: "2026-10-10" }),
      kind: "working_day",
      repeats: false,
      ownHours: false,
    });
    const [reset] = await db.select().from(specialDates).where(eq(specialDates.id, ordinary.id));
    expect(reset).toMatchObject({ kind: "working_day", repeatOn: null, ownHours: false });
  });

  it("refuses own hours alongside whole-venue closure", async () => {
    const f = await fixture();
    await expect(
      saveDate(f, null, { ...specialInput({ closeWholeVenue: true }), ownHours: true }),
    ).rejects.toMatchObject({ code: "hours.invalid", params: { field: "ownHours" } });
  });

  it("saves a repeating named day without newly supplied station cells", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, {
      ...specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
      repeats: true,
    });
    expect(saved.repeats).toBe(true);
  });

  it("makes a named day repeat without consulting dormant default-station cells", async () => {
    const f = await fixture();
    const source = await seedNamedDate(
      f,
      specialInput({ cells: [{ subject: f.bar, cell: { mode: "closed", periods: [] } }] }),
    );
    await withTransaction(db, async (tx) => {
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen.id));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.bar.id));
    });
    const edited = await saveDate(f, source.id, { ...specialInput(), repeats: true });
    expect(edited).toEqual({ ...source, repeats: true });
  });

  it.each([
    ["2026-12-25", true, "2027-12-25", false, "2027-12-25"],
    ["2027-12-25", false, "2026-12-25", true, "2027-12-25"],
    ["2026-12-25", true, "2028-12-25", true, "2028-12-25"],
    ["2028-02-29", true, "2032-02-29", false, "2032-02-29"],
  ])(
    "refuses intersecting occurrences %s/%s and %s/%s",
    async (firstDate, firstRepeats, date, repeats, clash) => {
      const f = await fixture();
      await saveDate(f, null, { ...specialInput({ date: firstDate }), repeats: firstRepeats });
      await expect(saveDate(f, null, { ...specialInput({ date }), repeats })).rejects.toMatchObject(
        { code: "special_date.date_taken", params: { date: clash } },
      );
      expect(
        await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)),
      ).toHaveLength(1);
    },
  );

  it("allows a one-off before a repeat starts and a matching date in another venue", async () => {
    const f = await fixture();
    const other = await fixture();
    await saveDate(f, null, { ...specialInput({ date: "2028-12-25" }), repeats: true });
    const earlier = await saveDate(f, null, specialInput({ date: "2027-12-25" }));
    const elsewhere = await saveDate(other, null, {
      ...specialInput({ date: "2028-12-25" }),
      repeats: true,
    });
    expect(earlier.date).toBe("2027-12-25");
    expect(elsewhere.date).toBe("2028-12-25");
  });

  it("ignores the edited row itself but refuses moving its repeat onto another day", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      repeats: true,
    });
    const edited = await saveDate(
      f,
      source.id,
      specialInput({ date: "2026-12-25", name: "New name" }),
    );
    expect(edited.id).toBe(source.id);
    await saveDate(f, null, specialInput({ date: "2027-12-26" }));
    await expect(
      saveDate(f, source.id, specialInput({ date: "2026-12-26" })),
    ).rejects.toMatchObject({ code: "special_date.date_taken", params: { date: "2027-12-26" } });
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, source.id));
    expect(row).toMatchObject({ date: "2026-12-25", repeatOn: "12-25", name: "New name" });
  });

  it("copies a repeat as a one-off, retaining kind and own hours", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "holiday",
      repeats: true,
      ownHours: true,
    });
    const [copy] = await withTransaction(db, (tx) =>
      duplicateSpecialDate(tx, f.cfg, source.id, ["2027-12-26"], AT),
    );
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, copy!.id));
    expect(row).toMatchObject({
      date: "2027-12-26",
      kind: "holiday",
      repeatOn: null,
      ownHours: true,
      closeWholeVenue: false,
    });
    const [original] = await db.select().from(specialDates).where(eq(specialDates.id, source.id));
    expect(original).toMatchObject({ repeatOn: "12-25" });
  });

  it("refuses copying onto a recurring day and rolls back the whole batch", async () => {
    const f = await fixture();
    const source = await saveDate(f, null, specialInput({ date: "2026-12-24" }));
    await saveDate(f, null, { ...specialInput({ date: "2026-12-25" }), repeats: true });
    await expect(
      withTransaction(db, (tx) =>
        duplicateSpecialDate(tx, f.cfg, source.id, ["2027-12-24", "2027-12-25"], AT),
      ),
    ).rejects.toMatchObject({ code: "special_date.date_taken", params: { date: "2027-12-25" } });
    expect(
      (await db.select().from(specialDates).where(eq(specialDates.locationId, f.cfg.locationId)))
        .map((row) => row.date)
        .sort(),
    ).toEqual(["2026-12-24", "2026-12-25"]);
  });
});

describe("named-day response and colour", () => {
  it("returns the named-day kind without a stored colour", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, {
      date: "2026-12-25",
      name: "Christmas",
      kind: "holiday",
      repeats: true,
      ownHours: true,
      closeWholeVenue: false,
      cells: [],
    });
    expect(saved).toEqual({
      id: expect.any(String),
      date: "2026-12-25",
      name: "Christmas",
      kind: "holiday",
      repeats: true,
      ownHours: true,
      closeWholeVenue: false,
    });
    expect(saved).not.toHaveProperty("colour");
    const edited = await saveDate(f, saved.id, {
      ...specialInput({ date: "2026-12-25" }),
      kind: "working_day",
    });
    expect(edited).toMatchObject({
      kind: "working_day",
      repeats: true,
      ownHours: true,
    });
    expect(await withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, saved.id))).toEqual({
      ...edited,
    });
    expect(
      await withTransaction(db, (tx) => renameSpecialDate(tx, f.cfg, saved.id, "Dinner")),
    ).toEqual({ ...edited, name: "Dinner" });
  });
});

describe("named-day own-hours switching", () => {
  async function setup() {
    const f = await fixture();
    const other = await fixture();
    const seeded = await withTransaction(db, async (tx) => {
      const [menu] = await tx.insert(catalogues).values({ name: randomUUID() }).returning();
      const lunch = await saveMenuPeriod(tx, f.cfg, f.departmentIds.restaurant, {
        name: "Lunch",
        menuId: menu!.id,
        staffMenuIds: [],
      });
      for (const [cfg, departmentId, periodId] of [
        [f.cfg, f.departmentIds.restaurant, lunch.id],
        [
          other.cfg,
          other.departmentIds.restaurant,
          (
            await saveMenuPeriod(tx, other.cfg, other.departmentIds.restaurant, {
              name: "Other lunch",
              menuId: menu!.id,
              staffMenuIds: [],
            })
          ).id,
        ],
      ] as const) {
        await replaceMenuWeek(
          tx,
          cfg,
          departmentId,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots: weekday === 5 ? [{ periodId, startsAt: "12:00", endsAt: "15:00" }] : [],
          })),
          AT,
        );
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: cfg.locationId, name: "Terrace" })
          .returning();
        await tx
          .insert(zoneServicePolicies)
          .values({ locationId: cfg.locationId, zoneId: zone!.id, departmentId });
        await tx.insert(zoneClosedTimes).values([
          { zoneId: zone!.id, weekday: 5, startsAt: "13:00:00", endsAt: "14:00:00" },
          { zoneId: zone!.id, weekday: 1, startsAt: "10:00:00", endsAt: "11:00:00" },
        ]);
      }
      return { lunch };
    });
    return { f, other, ...seeded };
  }

  async function snapshot(id: string) {
    return withTransaction(db, async (tx) => {
      const days = await tx
        .select()
        .from(menuDayTimetables)
        .where(eq(menuDayTimetables.specialDateId, id));
      const slots =
        days.length === 0
          ? []
          : await tx
              .select()
              .from(menuSlots)
              .where(
                inArray(
                  menuSlots.timetableId,
                  days.map((d) => d.id),
                ),
              );
      const closures = await tx
        .select()
        .from(zoneClosedTimes)
        .where(eq(zoneClosedTimes.specialDateId, id));
      return { days, slots, closures };
    });
  }

  it("copies only the stored weekday and location when own hours are enabled", async () => {
    const { f, lunch } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    const rows = await snapshot(day.id);
    expect(rows.days.map((d) => [d.departmentId, d.weekday, d.specialDateId])).toEqual([
      [f.departmentIds.restaurant, null, day.id],
    ]);
    expect(rows.slots.map((s) => [s.departmentId, s.periodId, s.startsAt, s.endsAt])).toEqual([
      [f.departmentIds.restaurant, lunch.id, "12:00:00", "15:00:00"],
    ]);
    expect(rows.closures.map((c) => [c.weekday, c.specialDateId, c.startsAt, c.endsAt])).toEqual([
      [null, day.id, "13:00:00", "14:00:00"],
    ]);
    const [policy] = await db
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, rows.closures[0]!.zoneId));
    expect(policy!.locationId).toBe(f.cfg.locationId);
  });

  it("copies on an off-to-on update and leaves the standard week intact", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput());
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    const before = await db.select().from(menuSlots);
    await saveDate(f, day.id, specialInput({ ownHours: true }));
    expect((await snapshot(day.id)).slots).toHaveLength(1);
    expect(
      (await db.select().from(menuSlots)).filter((s) => before.some((b) => b.id === s.id)),
    ).toEqual(before);
  });

  it("removes all dated department and zone rows when own hours are disabled", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    await withTransaction(db, async (tx) => {
      await saveSpecialDateMenus(tx, f.cfg, day.id, f.departmentIds.deli, [], AT);
      const [zone] = await tx
        .select()
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.locationId, f.cfg.locationId));
      await tx.insert(zoneClosedTimes).values({
        zoneId: zone!.zoneId,
        specialDateId: day.id,
        startsAt: "15:00:00",
        endsAt: "16:00:00",
      });
    });
    const before = await snapshot(day.id);
    expect(before.days).toHaveLength(2);
    expect(before.slots).toHaveLength(1);
    expect(before.closures).toHaveLength(2);
    await saveDate(f, day.id, specialInput({ ownHours: false }));
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    expect(
      await db
        .select()
        .from(zoneClosedTimes)
        .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneClosedTimes.zoneId))
        .where(
          and(eq(zoneClosedTimes.weekday, 5), eq(zoneServicePolicies.locationId, f.cfg.locationId)),
        ),
    ).toHaveLength(1);
  });

  it("keeps dated edits and row identities when own hours remain on", async () => {
    const { f, lunch } = await setup();
    const day = await saveDate(f, null, specialInput({ ownHours: true }));
    await withTransaction(db, (tx) =>
      saveSpecialDateMenus(
        tx,
        f.cfg,
        day.id,
        f.departmentIds.restaurant,
        [{ periodId: lunch.id, startsAt: "16:00", endsAt: "18:00" }],
        AT,
      ),
    );
    const before = await snapshot(day.id);
    await saveDate(f, day.id, specialInput({ ownHours: true, name: "Renamed" }));
    expect(await snapshot(day.id)).toEqual(before);
  });

  it("rolls back copied rows and the flag when a participant refuses the save", async () => {
    const { f } = await setup();
    const day = await saveDate(f, null, specialInput());
    await expect(
      withTransaction(db, (tx) =>
        saveSpecialDate(tx, f.cfg, day.id, specialInput({ ownHours: true }), AT, [
          {
            async copy() {},
            async beforeDelete() {},
            async afterChange(tx) {
              const rows = await tx
                .select()
                .from(menuDayTimetables)
                .where(eq(menuDayTimetables.specialDateId, day.id));
              expect(rows).toHaveLength(1);
              throw new Error("participant refusal");
            },
          },
        ]),
      ),
    ).rejects.toThrow("participant refusal");
    expect(await snapshot(day.id)).toEqual({ days: [], slots: [], closures: [] });
    expect((await readSpecialDateAt(f, day.id)).ownHours).toBe(false);
  });

  async function readSpecialDateAt(f: Fixture, id: string) {
    return withTransaction(db, (tx) => readSpecialDate(tx, f.cfg, id));
  }
});

describe("named-day saves without station schedules", () => {
  it("creates and edits a named day from calendar fields alone", async () => {
    const f = await fixture();
    const input = {
      date: "2026-12-25",
      name: " Navidad ",
      kind: "holiday",
      repeats: true,
      ownHours: false,
      closeWholeVenue: true,
    };
    const saved = await saveDate(f, null, input);
    expect(saved).toEqual({ ...input, id: expect.any(String), name: "Navidad" });
    const edited = await saveDate(f, saved.id, { ...input, name: "Christmas", date: "2027-12-25" });
    expect(edited).toEqual({ ...saved, name: "Christmas", date: "2027-12-25" });
  });

  it("ignores former station-cell fields without storing a station schedule", async () => {
    const f = await fixture();
    const saved = await saveDate(
      f,
      null,
      specialInput({
        cells: [
          { subject: f.bar, cell: { mode: "periods", periods: [period("18:00", "22:00")] } },
          { subject: f.kitchen, cell: { mode: "closed", periods: [] } },
          { subject: f.otherStation, cell: { mode: "closed", periods: [] } },
        ],
      }),
    );
    expect(saved.name).toBe("Harvest festival");
  });

  it("stores the yearly repeat key when a named day becomes recurring", async () => {
    const f = await fixture();
    const saved = await saveDate(f, null, specialInput());
    const edited = await saveDate(f, saved.id, { ...specialInput(), repeats: true, cells: null });
    expect(edited).toEqual({ ...saved, repeats: true });
    expect(
      (await db.select().from(specialDates).where(eq(specialDates.id, saved.id)))[0]!.repeatOn,
    ).toBe("10-09");
  });
});
