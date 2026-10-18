import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { replaceMenuWeek, saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { assertSeasonClosuresInHours } from "./zone-closure-hours.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const closedMonday = (ranges: { startsAt: string; endsAt: string }[]) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: weekday === 1 ? ranges : [] }));

/** A venue whose Restaurant opens Monday 09:00–12:00 and Deli Monday 14:00–18:00 in one season,
 *  with Barra serving Restaurant. */
async function venue() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
    })
    .returning({ id: locations.id });
  const cfg = { locationId: brandLocationId(location!.id) };
  await db
    .insert(kitchenStations)
    .values({ locationId: cfg.locationId, name: "Cocina", isDefault: true });
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId: cfg.locationId, name: "Barra" })
    .returning({ id: floorZones.id });
  const barra = zone!.id;
  return withTransaction(db, async (tx) => {
    const seasonId = (await ensureDefaultSeasons(tx, cfg))[0]!.id;
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" })).id;
    await configureZone(tx, cfg, { zoneId: barra, departmentId: restaurant });
    const menuId = (await createCatalogue(tx, { name: "Carta" })).id;
    for (const [departmentId, startsAt, endsAt] of [
      [restaurant, "09:00", "12:00"],
      [deli, "14:00", "18:00"],
    ] as const) {
      const periodId = (
        await saveMenuPeriod(tx, cfg, departmentId, { name: "Día", menuId, staffMenuIds: [] }, 0)
      ).id;
      await replaceMenuWeek(
        tx,
        cfg,
        departmentId,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId, startsAt, endsAt }] : [],
        })),
        new Date(),
        0,
        { seasonId },
      );
    }
    return { cfg, seasonId, barra, deli };
  });
}

async function refusal(run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("assertSeasonClosuresInHours", () => {
  it("passes a closure inside its department's hours", async () => {
    const v = await venue();
    await withTransaction(db, (tx) =>
      assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
        {
          zoneId: v.barra,
          field: "",
          days: closedMonday([{ startsAt: "10:00", endsAt: "12:00" }]),
        },
      ]),
    );
  });

  it("refuses a closure running past the close, naming the range, the zone and the weekday", async () => {
    const v = await venue();
    expect(
      await refusal(() =>
        withTransaction(db, (tx) =>
          assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
            {
              zoneId: v.barra,
              field: "zones.3.",
              days: closedMonday([
                { startsAt: "09:00", endsAt: "10:00" },
                { startsAt: "11:00", endsAt: "12:30" },
              ]),
            },
          ]),
        ),
      ),
    ).toEqual({
      code: "zone_closed_time.invalid",
      params: {
        field: "zones.3.days.1.ranges.1",
        reason: "outside_hours",
        zoneId: v.barra,
        weekday: 1,
      },
    });
  });

  it("refuses a closure on a weekday the department has no hours on", async () => {
    const v = await venue();
    const days = [
      ...closedMonday([]).slice(0, 5),
      { weekday: 5, ranges: [{ startsAt: "10:00", endsAt: "11:00" }] },
      { weekday: 6, ranges: [] },
    ];
    expect(
      await refusal(() =>
        withTransaction(db, (tx) =>
          assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
            { zoneId: v.barra, field: "", days },
          ]),
        ),
      ),
    ).toEqual({
      code: "zone_closed_time.invalid",
      params: { field: "days.5.ranges.0", reason: "outside_hours", zoneId: v.barra, weekday: 5 },
    });
  });

  it("reads the hours of the department the zone serves now", async () => {
    const v = await venue();
    await withTransaction(db, (tx) =>
      configureZone(tx, v.cfg, { zoneId: v.barra, departmentId: v.deli }),
    );
    await withTransaction(db, (tx) =>
      assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
        {
          zoneId: v.barra,
          field: "",
          days: closedMonday([{ startsAt: "15:00", endsAt: "16:00" }]),
        },
      ]),
    );
    expect(
      await refusal(() =>
        withTransaction(db, (tx) =>
          assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
            {
              zoneId: v.barra,
              field: "",
              days: closedMonday([{ startsAt: "10:00", endsAt: "11:00" }]),
            },
          ]),
        ),
      ),
    ).toEqual({
      code: "zone_closed_time.invalid",
      params: { field: "days.1.ranges.0", reason: "outside_hours", zoneId: v.barra, weekday: 1 },
    });
  });

  it("names a refused range by its place in the request when the days come out of weekday order", async () => {
    const v = await venue();
    const days = closedMonday([{ startsAt: "11:00", endsAt: "13:00" }]).reverse();
    expect(
      await refusal(() =>
        withTransaction(db, (tx) =>
          assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
            { zoneId: v.barra, field: "", days },
          ]),
        ),
      ),
    ).toEqual({
      code: "zone_closed_time.invalid",
      params: { field: "days.5.ranges.0", reason: "outside_hours", zoneId: v.barra, weekday: 1 },
    });
  });

  it("refuses a zone that serves no department with service_zone.not_found", async () => {
    const v = await venue();
    const zoneId = randomUUID();
    expect(
      await refusal(() =>
        withTransaction(db, (tx) =>
          assertSeasonClosuresInHours(tx, v.cfg, v.seasonId, [
            { zoneId, field: "", days: closedMonday([]) },
          ]),
        ),
      ),
    ).toEqual({ code: "service_zone.not_found", params: { zoneId } });
  });
});
