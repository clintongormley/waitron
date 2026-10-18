import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorPlanSets,
  floorZones,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ZoneFloorLayout } from "@waitron/module";
import { locationId, type LocationId } from "@waitron/shared";
import { linkFloorPlanSet } from "./floor-plan-set-store.js";
import { localTimeOccurrences } from "./hours-occurrences.js";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { menuPeriods } from "./schema/menus.js";
import { periodExtensions } from "./schema/period-extensions.js";
import { VENUE_SERVICE } from "./service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const FRIDAY = "2026-10-09";
const SUNDAY = "2026-10-11";
const at = (time: string, date = FRIDAY) =>
  new Date(localTimeOccurrences(date, time, "Europe/Madrid")[0]!);
const key = (departmentId: string, day: string, periodId: string, startsAt: string) =>
  JSON.stringify([departmentId, day, periodId, startsAt]);

async function newZone(tx: Transaction, cfg: { locationId: LocationId }, name: string) {
  const [zone] = await tx
    .insert(floorZones)
    .values({ ...cfg, name })
    .returning();
  return zone!.id;
}

async function newSet(
  tx: Transaction,
  cfg: { locationId: LocationId },
  departmentId: string,
  name: string,
) {
  const [row] = await tx
    .insert(floorPlanSets)
    .values({ locationId: cfg.locationId })
    .returning({ id: floorPlanSets.id });
  await linkFloorPlanSet(tx, cfg, { setId: row!.id, departmentId, name });
  return row!.id;
}

async function fixture() {
  return run(async (tx) => {
    const [venue] = await tx
      .insert(locations)
      .values({
        name: "Venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00:00",
      })
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const bar = (await createDepartment(tx, cfg, { name: "Bar", orderStart: "table" })).id;
    const dining = await newZone(tx, cfg, "Dining");
    const terrace = await newZone(tx, cfg, "Terrace");
    const garden = await newZone(tx, cfg, "Garden");
    const counter = await newZone(tx, cfg, "Counter");
    const loose = await newZone(tx, cfg, "Store room");
    for (const zoneId of [dining, terrace, garden])
      await configureZone(tx, cfg, { zoneId, departmentId: restaurant });
    await configureZone(tx, cfg, { zoneId: counter, departmentId: bar });
    const menu = await createCatalogue(tx, { name: "Menu" });
    const period = async (name: string) =>
      (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId: menu.id, staffMenuIds: [] }, 0))
        .id;
    const lunch = await period("Lunch");
    const dinner = await period("Dinner");
    await replaceMenuWeek(
      tx,
      cfg,
      restaurant,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots:
          weekday === 0
            ? []
            : [
                { periodId: lunch, startsAt: "12:00", endsAt: "15:00" },
                { periodId: dinner, startsAt: "20:00", endsAt: "23:00" },
              ],
      })),
      at("10:00"),
      0,
    );
    const standard = await newSet(tx, cfg, restaurant, "Standard");
    const dinnerSet = await newSet(tx, cfg, restaurant, "Dinner");
    await tx
      .update(menuPeriods)
      .set({ floorPlanSetId: dinnerSet })
      .where(eq(menuPeriods.id, dinner));
    return {
      cfg,
      restaurant,
      bar,
      zones: { dining, terrace, garden, counter, loose },
      lunch,
      dinner,
      standard,
      dinnerSet,
    };
  });
}

const dueOnly = (layouts: ReadonlyMap<string, ZoneFloorLayout>) =>
  new Map([...layouts].map(([zoneId, layout]) => [zoneId, layout.due]));

const due = async (
  f: Awaited<ReturnType<typeof fixture>>,
  zoneIds: readonly string[],
  moment: Date,
  recordedOccurrence: string | null = null,
) =>
  dueOnly(
    await run((tx) =>
      VENUE_SERVICE.dueFloorLayouts(
        tx,
        f.cfg,
        zoneIds.map((zoneId) => ({ zoneId, recordedOccurrence })),
        moment,
      ),
    ),
  );

describe("which floor layout is due", () => {
  it("is the default set while Lunch runs", async () => {
    const f = await fixture();
    const layouts = await due(f, [f.zones.dining], at("14:00"));
    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.standard,
      setName: "Standard",
      occurrence: key(f.restaurant, FRIDAY, f.lunch, "12:00"),
      periodName: "Lunch",
    });
  });

  it("is Dinner's set once Lunch ends", async () => {
    const f = await fixture();
    const layouts = await due(f, [f.zones.dining], at("16:00"));
    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.dinnerSet,
      setName: "Dinner",
      occurrence: key(f.restaurant, FRIDAY, f.dinner, "20:00"),
      periodName: "Dinner",
    });
  });

  it("keeps the recorded run's floor while it still matches", async () => {
    const f = await fixture();
    const dinnerKey = key(f.restaurant, FRIDAY, f.dinner, "20:00");
    const layouts = await due(f, [f.zones.dining], at("14:00"), dinnerKey);
    expect(layouts.get(f.zones.dining)).toMatchObject({
      setId: f.dinnerSet,
      occurrence: dinnerKey,
    });
  });

  it("follows the recorded run a keep open pushed later", async () => {
    const f = await fixture();
    await run((tx) =>
      tx.insert(periodExtensions).values({
        departmentId: f.restaurant,
        businessDay: FRIDAY,
        periodId: f.lunch,
        startsAt: "15:00:00",
        endsAt: "21:00:00",
      }),
    );
    const layouts = await due(
      f,
      [f.zones.dining],
      at("21:30"),
      key(f.restaurant, FRIDAY, f.dinner, "20:00"),
    );
    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.dinnerSet,
      setName: "Dinner",
      occurrence: key(f.restaurant, FRIDAY, f.dinner, "21:00"),
      periodName: "Dinner",
    });
  });

  it("gives each department its own day and keep open", async () => {
    const f = await fixture();
    const bar = await run(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Bar menu" });
      const period = async (name: string) =>
        (await saveMenuPeriod(tx, f.cfg, f.bar, { name, menuId: menu.id, staffMenuIds: [] }, 0)).id;
      const morning = await period("Morning");
      const evening = await period("Evening");
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.bar,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            { periodId: morning, startsAt: "09:00", endsAt: "13:00" },
            { periodId: evening, startsAt: "17:00", endsAt: "23:00" },
          ],
        })),
        at("08:00"),
        0,
      );
      const standard = await newSet(tx, f.cfg, f.bar, "Standard");
      const late = await newSet(tx, f.cfg, f.bar, "Late");
      await tx.update(menuPeriods).set({ floorPlanSetId: late }).where(eq(menuPeriods.id, evening));
      await tx.insert(periodExtensions).values({
        departmentId: f.restaurant,
        businessDay: FRIDAY,
        periodId: f.lunch,
        startsAt: "15:00:00",
        endsAt: "21:00:00",
      });
      return { standard, late, evening };
    });

    const layouts = await due(f, [f.zones.dining, f.zones.counter], at("16:00"));

    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.standard,
      setName: "Standard",
      occurrence: key(f.restaurant, FRIDAY, f.lunch, "12:00"),
      periodName: "Lunch",
    });
    expect(layouts.get(f.zones.counter)).toEqual({
      setId: bar.late,
      setName: "Late",
      occurrence: key(f.bar, FRIDAY, bar.evening, "17:00"),
      periodName: "Evening",
    });
  });

  it("follows a changed default", async () => {
    const f = await fixture();
    await run(async (tx) => {
      await tx
        .update(departmentFloorPlanSets)
        .set({ isDefault: false })
        .where(eq(departmentFloorPlanSets.setId, f.standard));
      await tx
        .update(departmentFloorPlanSets)
        .set({ isDefault: true })
        .where(eq(departmentFloorPlanSets.setId, f.dinnerSet));
    });
    const layouts = await due(f, [f.zones.dining], at("14:00"));
    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.dinnerSet,
      setName: "Dinner",
      occurrence: key(f.restaurant, FRIDAY, f.lunch, "12:00"),
      periodName: "Lunch",
    });
  });

  it("is the default with no occurrence on a day with no period", async () => {
    const f = await fixture();
    const layouts = await due(f, [f.zones.dining], at("14:00", SUNDAY));
    expect(layouts.get(f.zones.dining)).toEqual({
      setId: f.standard,
      setName: "Standard",
      occurrence: null,
      periodName: null,
    });
  });

  it("is the default with no occurrence, and reads no day, when the clock names no day", async () => {
    const f = await fixture();
    await run(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const layouts = dueOnly(
          await VENUE_SERVICE.dueFloorLayouts(
            tx,
            f.cfg,
            [{ zoneId: f.zones.dining, recordedOccurrence: null }],
            new Date(Number.NaN),
          ),
        );
        expect(layouts.get(f.zones.dining)).toEqual({
          setId: f.standard,
          setName: "Standard",
          occurrence: null,
          periodName: null,
        });
        const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
        expect(sql.filter((q) => q.includes('from "menu_period_staff_menus"'))).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("is null for a zone in no department and for a department with no set", async () => {
    const f = await fixture();
    const layouts = await due(f, [f.zones.loose, f.zones.counter], at("14:00"));
    const none = { setId: null, setName: null, occurrence: null, periodName: null };
    expect(layouts.get(f.zones.loose)).toEqual(none);
    expect(layouts.get(f.zones.counter)).toEqual(none);
    expect(layouts.size).toBe(2);
  });

  it("reads every department's keep open in one statement", async () => {
    const f = await fixture();
    await run(async (tx) => {
      await newSet(tx, f.cfg, f.bar, "Standard");
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const zoneIds = [f.zones.dining, f.zones.terrace, f.zones.garden, f.zones.counter];
        const layouts = await VENUE_SERVICE.dueFloorLayouts(
          tx,
          f.cfg,
          zoneIds.map((zoneId) => ({ zoneId, recordedOccurrence: null })),
          at("14:00"),
        );
        expect(layouts.size).toBe(4);
        const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
        expect(sql.filter((q) => q.includes('from "period_extensions"'))).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("says whether each zone's department has a set and names the recorded set", async () => {
    const f = await fixture();
    const [barSet, gone] = await run(async (tx) => {
      const barSet = await newSet(tx, f.cfg, f.bar, "Bar standard");
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId: f.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      return [barSet, row!.id];
    });
    const layouts = await run((tx) =>
      VENUE_SERVICE.dueFloorLayouts(
        tx,
        f.cfg,
        [
          { zoneId: f.zones.dining, recordedOccurrence: null, recordedSetId: f.dinnerSet },
          { zoneId: f.zones.terrace, recordedOccurrence: null, recordedSetId: barSet },
          { zoneId: f.zones.garden, recordedOccurrence: null, recordedSetId: gone },
          { zoneId: f.zones.loose, recordedOccurrence: null, recordedSetId: f.standard },
          { zoneId: f.zones.counter, recordedOccurrence: null },
        ],
        at("14:00"),
      ),
    );
    const facts = (zoneId: string) => {
      const { planned, recordedSetName } = layouts.get(zoneId)!;
      return { planned, recordedSetName };
    };
    expect(facts(f.zones.dining)).toEqual({ planned: true, recordedSetName: "Dinner" });
    expect(facts(f.zones.terrace)).toEqual({ planned: true, recordedSetName: "Bar standard" });
    expect(facts(f.zones.garden)).toEqual({ planned: true, recordedSetName: null });
    expect(facts(f.zones.loose)).toEqual({ planned: false, recordedSetName: "Standard" });
    expect(facts(f.zones.counter)).toEqual({ planned: true, recordedSetName: null });
  });

  it("is not planned, and reads no set, for zones in no department with nothing recorded", async () => {
    const f = await fixture();
    await run(async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const layouts = await VENUE_SERVICE.dueFloorLayouts(
          tx,
          f.cfg,
          [{ zoneId: f.zones.loose, recordedOccurrence: null }],
          at("14:00"),
        );
        expect(layouts.get(f.zones.loose)).toEqual({
          due: { setId: null, setName: null, occurrence: null, periodName: null },
          planned: false,
          recordedSetName: null,
        });
        const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
        expect(sql.filter((q) => q.includes("department_floor_plan_sets"))).toEqual([]);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockClear();
        expect((await VENUE_SERVICE.dueFloorLayouts(tx, f.cfg, [], at("14:00"))).size).toBe(0);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("reads neither the clock nor the day's plan again when handed the day read at that instant", async () => {
    const f = await fixture();
    await run(async (tx) => {
      const prepared = await VENUE_SERVICE.readServiceDay(tx, f.cfg, at("16:00"));
      expect(prepared.businessDay).toBe(FRIDAY);
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const spy = vi.spyOn(session, "prepareQuery");
      try {
        const layouts = dueOnly(
          await VENUE_SERVICE.dueFloorLayouts(
            tx,
            f.cfg,
            [{ zoneId: f.zones.dining, recordedOccurrence: null }],
            at("16:00"),
            prepared,
          ),
        );
        expect(layouts.get(f.zones.dining)).toEqual({
          setId: f.dinnerSet,
          setName: "Dinner",
          occurrence: key(f.restaurant, FRIDAY, f.dinner, "20:00"),
          periodName: "Dinner",
        });
        const sql = spy.mock.calls.map(([q]) => (q as unknown as { sql: string }).sql);
        expect(sql.filter((q) => /from "(locations|seasons)"/.test(q))).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("works the moment out afresh when handed a day read at another instant", async () => {
    const f = await fixture();
    const layouts = await run(async (tx) =>
      dueOnly(
        await VENUE_SERVICE.dueFloorLayouts(
          tx,
          f.cfg,
          [{ zoneId: f.zones.dining, recordedOccurrence: null }],
          at("14:00"),
          await VENUE_SERVICE.readServiceDay(tx, f.cfg, at("16:00")),
        ),
      ),
    );
    expect(layouts.get(f.zones.dining)).toMatchObject({ setId: f.standard, periodName: "Lunch" });
  });
});
