import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  tenants,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { readOpeningHoursYear } from "./opening-hours-calendar.js";
import { createDepartment, type VenueScope } from "./operations.js";
import { readSeasons } from "./seasons.js";
import { saveSpecialDay } from "./special-days.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const AT = new Date("2026-10-09T10:00:00Z");

/** A Sevilla venue with a department per entry of `closedOn`, each serving lunch every day but
 *  the weekdays its entry lists. */
async function venue(closedOn: readonly (readonly number[])[] = [[1]]) {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Casa SL" })
    .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      province: "Sevilla",
      city: "Sevilla",
    })
    .returning({ id: locations.id });
  const cfg: VenueScope = { locationId: locationId(location!.id) };
  return run(async (tx) => {
    const menuId = (await createCatalogue(tx, { name: `Carta ${randomUUID()}` })).id;
    const { document } = await buildMenuDocument(tx, menuId);
    await publishMenu(tx, menuId, menuDocumentHash(document), "person-1");
    for (const [index, closed] of closedOn.entries()) {
      const department = (
        await createDepartment(tx, cfg, { name: `Sala ${index}`, orderStart: "table" })
      ).id;
      const lunch = (
        await saveMenuPeriod(tx, cfg, department, { name: "Lunch", menuId, staffMenuIds: [] }, 0)
      ).id;
      await replaceMenuWeek(
        tx,
        cfg,
        department,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: closed.includes(weekday)
            ? []
            : [{ periodId: lunch, startsAt: "12:00", endsAt: "16:00" }],
        })),
        AT,
        0,
      );
    }
    const seasons = Object.fromEntries(
      (await readSeasons(tx, cfg)).map((season) => [season.name, season.id]),
    );
    return { cfg, seasons };
  });
}
type Venue = Awaited<ReturnType<typeof venue>>;

const read = (v: Venue, year: number) => run((tx) => readOpeningHoursYear(tx, v.cfg, year, AT));
const special = (v: Venue, input: unknown) =>
  run((tx) => saveSpecialDay(tx, v.cfg, null, input, AT, 0));
const dayOf = (year: Awaited<ReturnType<typeof read>>, date: string) =>
  year.days.find((day) => day.date === date);

describe("the Opening hours year read", () => {
  it("gives 2030's days by value: a Winter day, a closed Monday and a special day's Closed tick", async () => {
    const v = await venue();
    const cierre = await special(v, {
      name: "Cierre",
      repeatsYearly: false,
      dates: [{ date: "2030-07-10", closedAllDay: true }],
    });
    const year = await read(v, 2030);
    expect(year.year).toBe(2030);
    expect(year.timeZone).toBe("Europe/Madrid");
    expect(year.today).toBe("2026-10-09");
    expect(year.clockRevision).toBe(0);
    expect(year.days).toHaveLength(365);
    expect(year.days[0]!.date).toBe("2030-01-01");
    expect(year.days.at(-1)!.date).toBe("2030-12-31");
    expect(dayOf(year, "2030-01-15")).toEqual({
      date: "2030-01-15",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [],
      tone: "standard",
      closed: false,
    });
    expect(dayOf(year, "2030-01-14")).toEqual({
      date: "2030-01-14",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [],
      tone: "closed",
      closed: true,
    });
    expect(dayOf(year, "2030-07-10")).toEqual({
      date: "2030-07-10",
      seasonId: v.seasons.Summer,
      specialDay: { id: cierre.id, name: "Cierre" },
      holidays: [],
      tone: "special_day",
      closed: true,
    });
    expect(year.seasons).toEqual([
      { id: v.seasons.Spring, name: "Spring", startsOn: "03-01", lastDay: "05-31" },
      { id: v.seasons.Summer, name: "Summer", startsOn: "06-01", lastDay: "08-31" },
      { id: v.seasons.Autumn, name: "Autumn", startsOn: "09-01", lastDay: "11-30" },
      { id: v.seasons.Winter, name: "Winter", startsOn: "12-01", lastDay: "02-28" },
    ]);
  });

  it("gives a public holiday from the pack's 2026 list in a 2026 read, with its coverage", async () => {
    const v = await venue();
    const year = await read(v, 2026);
    expect(year.publicHolidaysAvailable).toBe(true);
    expect(
      year.holidayCoverage.map(({ year, nationalRegional }) => ({ year, nationalRegional })),
    ).toEqual([{ year: 2026, nationalRegional: "complete" }]);
    expect(dayOf(year, "2026-01-06")).toEqual({
      date: "2026-01-06",
      seasonId: v.seasons.Winter,
      specialDay: null,
      holidays: [
        {
          id: "shipped:BOE-A-2025-21667:0601",
          date: "2026-01-06",
          name: "Epifanía del Señor",
          scope: "national",
          sourceId: "BOE-A-2025-21667",
        },
      ],
      tone: "public_holiday",
      closed: false,
    });
    expect(year.area.readiness).toBe("ready");
  });

  it("says 2027's public holidays are not available yet, and names the repeating date with no holiday of its name", async () => {
    const v = await venue();
    const semanaSanta = await special(v, {
      name: "Semana Santa",
      repeatsYearly: true,
      dates: [{ date: "2026-04-03", closedAllDay: true }],
    });
    const now = await read(v, 2026);
    expect(now.missingHolidays).toEqual([]);
    const next = await read(v, 2027);
    expect(next.publicHolidaysAvailable).toBe(false);
    expect(next.holidayCoverage.map(({ nationalRegional }) => nationalRegional)).toEqual([
      "missing_year",
    ]);
    expect(next.missingHolidays).toEqual([
      { specialDayId: semanaSanta.id, name: "Semana Santa", holidayName: "Viernes Santo" },
    ]);
  });

  it("closes a date only when every active department is closed all day", async () => {
    const v = await venue([
      [1, 2],
      [1, 3],
    ]);
    const year = await read(v, 2030);
    expect(
      ["2030-01-14", "2030-01-15", "2030-01-16", "2030-01-17"].map((date) => ({
        date,
        closed: dayOf(year, date)!.closed,
      })),
    ).toEqual([
      { date: "2030-01-14", closed: true },
      { date: "2030-01-15", closed: false },
      { date: "2030-01-16", closed: false },
      { date: "2030-01-17", closed: false },
    ]);
  });

  it("ends each season on its true last day in the shown year, 29 February in a leap year", async () => {
    const v = await venue();
    const lastDays = async (year: number) =>
      (await read(v, year)).seasons.map(({ name, lastDay }) => ({ name, lastDay }));
    expect(await lastDays(2028)).toEqual([
      { name: "Spring", lastDay: "05-31" },
      { name: "Summer", lastDay: "08-31" },
      { name: "Autumn", lastDay: "11-30" },
      { name: "Winter", lastDay: "02-29" },
    ]);
    expect((await lastDays(2027)).at(-1)).toEqual({ name: "Winter", lastDay: "02-28" });
    expect(dayOf(await read(v, 2028), "2028-02-29")!.seasonId).toBe(v.seasons.Winter);
  });

  it("sends the same statements for one department as for three, not one per day", async () => {
    const statementsFor = async (v: Venue) =>
      run(async (tx) => {
        const session = (tx as unknown as { session: { prepareQuery: (...a: never[]) => unknown } })
          .session;
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          await readOpeningHoursYear(tx, v.cfg, 2030, AT);
          return prepared.mock.calls.length;
        } finally {
          prepared.mockRestore();
        }
      });
    const one = await statementsFor(await venue([[1]]));
    expect(await statementsFor(await venue([[1], [1], [1]]))).toBe(one);
    expect(one).toBeLessThan(40);
  });
});
