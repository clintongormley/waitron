import {
  STATION_COLOURS,
  TICKET_GROUPINGS,
  BUMP_MODES,
  CHANGES_AFTER_SENDING,
} from "@waitron/shared";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { CHECK_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations } from "./tenants.js";

// What this suite proves is the column mapping, the threshold CHECK and the partial unique index.
const LOCATION_A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("default station without a location", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("a second default station is refused, and two non-defaults are not", async () => {
    const insert = (id: string, isDefault: number) =>
      suite.db.run(sql`insert into kitchen_stations (id, name, is_default, created_at)
        values (${id}, ${id}, ${isDefault}, '2026-11-11')`);
    await insert("default", 1);
    await insert("first-non-default", 0);
    await insert("second-non-default", 0);
    const error = await captureError(() => insert("second-default", 1));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: kitchen_stations.is_default");
    expect(suite.db.all(sql`select id from kitchen_stations order by id`)).toEqual([
      { id: "default" },
      { id: "first-non-default" },
      { id: "second-non-default" },
    ]);
  });
});

describe("kitchen_stations schema (columns, threshold CHECK, partial unique)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await seedVenue(suite.db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await suite.db.insert(locations).values([
      {
        id: LOCATION_A2,
      },
      { id: LOCATION_B },
    ]);
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Drizzle rather than raw SQL: `id` and `created_at` are `$defaultFn` columns a raw insert does
  // not fill.
  async function seedStation(name: string, isDefault = false): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(kitchenStations)
        .values({ name, isDefault })
        .returning({ id: kitchenStations.id });
      return row!.id;
    });
  }

  it("A725 station schema has no manual order column", async () => {
    const columns = suite.db.all<{ name: string }>(sql`pragma table_info(kitchen_stations)`);
    expect(columns.map(({ name }) => name)).not.toContain("display_order");
  });

  it("the venue keeps no late flags apart from its stations", async () => {
    const tables = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name in ('kitchen_timing_defaults', 'kitchen_station_timing')`,
    );
    expect(tables).toEqual([]);
  });

  it("deleted station names are reusable under new ids", async () => {
    const name = "Reusable station";
    const oldId = await seedStation(name);
    await inTx((tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, oldId)),
    );
    const replacementId = await seedStation(name);
    expect(replacementId).not.toBe(oldId);
    const rows = await inTx((tx) =>
      tx
        .select({ id: kitchenStations.id, active: kitchenStations.active })
        .from(kitchenStations)
        .where(eq(kitchenStations.name, name)),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: oldId, active: false },
        { id: replacementId, active: true },
      ]),
    );
    expect(rows).toHaveLength(2);

    const collision = await captureError(() => seedStation(name));
    expect(isRefusal(collision, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(collision)).toBe("UNIQUE constraint failed: kitchen_stations.name");
    await inTx((tx) =>
      tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, replacementId)),
    );
    const thirdId = await seedStation(name);
    expect([oldId, replacementId]).not.toContain(thirdId);

    const [index] = suite.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'index' and name = 'kitchen_stations_name_key'`,
    );
    expect(index?.sql).toMatch(/WHERE "kitchen_stations"\."active" = 1$/);
  });

  it("exposes every column through the Drizzle export, with the is_default and active defaults", async () => {
    const id = await seedStation("Kitchen");
    const [row] = await inTx((tx) =>
      tx.select().from(kitchenStations).where(eq(kitchenStations.id, id)),
    );
    expect(row).not.toHaveProperty("displayOrder");
    expect(row!.name).toBe("Kitchen");
    expect(row!.isDefault).toBe(false);
    expect(row!.active).toBe(true);
    expect(row!.showsRestOfOrder).toBe(false);
  });

  it("A773 phases: a new station does not wait for the pass", async () => {
    const id = await seedStation("Pass waiting default");
    const [row] = await inTx((tx) =>
      tx.select().from(kitchenStations).where(eq(kitchenStations.id, id)),
    );
    expect(row!.waitsForPass).toBe(false);
  });

  it("a station row given no printing choices groups identical dishes, prints no held work in advance, leaves MOVED slips null, is done one item at a time and allows changes while held or waiting", async () => {
    const id = await seedStation("Printing defaults");
    const [row] = await inTx((tx) =>
      tx
        .select({
          ticketGrouping: kitchenStations.ticketGrouping,
          printHeldWork: kitchenStations.printHeldWork,
          printMovedSlips: kitchenStations.printMovedSlips,
          bumpMode: kitchenStations.bumpMode,
          changesAfterSending: kitchenStations.changesAfterSending,
        })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id)),
    );
    expect(row).toEqual({
      ticketGrouping: "combined",
      printHeldWork: false,
      printMovedSlips: null,
      bumpMode: "line",
      changesAfterSending: "held-or-waiting",
    });
  });

  it("carries ordered timing thresholds with sane defaults (KDS order-timing alerts)", async () => {
    const id = await seedStation("Timing station");
    const [row] = await inTx((tx) =>
      tx
        .select({
          w: kitchenStations.warmAfterMinutes,
          o: kitchenStations.overdueAfterMinutes,
          f: kitchenStations.forgottenAfterMinutes,
        })
        .from(kitchenStations)
        .where(eq(kitchenStations.id, id)),
    );
    expect(row).toMatchObject({ w: 5, o: 10, f: 15 });
    const e = await captureError(() =>
      inTx((tx) =>
        tx.update(kitchenStations).set({ warmAfterMinutes: 20 }).where(eq(kitchenStations.id, id)),
      ),
    );
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
    // A named CHECK's refusal carries its name.
    expect(engineErrorMessage(e)).toMatch(/kitchen_stations_thresholds_ordered/);
  });

  it("a station row given no ready warning holds 3, and the database holds it in no order with the late flags", async () => {
    const id = await seedStation("Ready warning station");
    const readyWarning = async () =>
      (
        await inTx((tx) =>
          tx
            .select({
              readyWarningAfterMinutes: kitchenStations.readyWarningAfterMinutes,
              forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
            })
            .from(kitchenStations)
            .where(eq(kitchenStations.id, id)),
        )
      )[0];
    expect(await readyWarning()).toEqual({
      readyWarningAfterMinutes: 3,
      forgottenAfterMinutes: 15,
    });
    for (const minutes of [20]) {
      await inTx((tx) =>
        tx
          .update(kitchenStations)
          .set({ readyWarningAfterMinutes: minutes })
          .where(eq(kitchenStations.id, id)),
      );
      expect(await readyWarning()).toEqual({
        readyWarningAfterMinutes: minutes,
        forgottenAfterMinutes: 15,
      });
    }
  });

  it("the partial unique index is what blocks the second default (proof by deletion of the index)", async () => {
    // The index is recreated in a `finally` so every other case still meets it.
    const probeLocation = "aaaaaaaa-0000-4000-8000-000000000003";
    await suite.db.insert(locations).values({
      id: probeLocation,
    });
    await seedVenueSettings(suite.db, { operationDescription: "Hostelería" });
    await seedBusinessDay(suite.db, {});
    await seedStation("Probe default", true);
    const [index] = suite.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'index' and name = 'kitchen_stations_default_key'`,
    );
    expect(index?.sql).toContain("is_default");
    try {
      suite.db.run(sql`drop index kitchen_stations_default_key`);
      await seedStation("Probe default two", true);
      const [counted] = await inTx((tx) =>
        tx
          .select({ n: sql<number>`cast(count(*) as int)` })
          .from(kitchenStations)
          .where(and(eq(kitchenStations.isDefault, true))),
      );
      expect(counted!.n).toBe(2);
    } finally {
      // The probe rows go first: recreating the index over their two defaults would fail.
      await suite.db.delete(kitchenStations).where(eq(kitchenStations.isDefault, true));
      suite.db.run(sql.raw(index!.sql));
    }
  });
});

describe("today's station closure and station value constraints", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const stationId = "station";
  async function station() {
    await suite.db.insert(kitchenStations).values({ id: stationId, name: "Kitchen" });
  }
  it.each([
    ["warm_after_minutes", 0, "kitchen_stations_warm_after_ck"],
    ["ready_warning_after_minutes", 0, "kitchen_stations_ready_warning_after_ck"],
    ["colour", "mauve", "kitchen_stations_colour_ck"],
    ["ticket_grouping", "stacked", "kitchen_stations_ticket_grouping_ck"],
    ["bump_mode", "order", "kitchen_stations_bump_mode_ck"],
    ["changes_after_sending", "always", "kitchen_stations_changes_after_sending_ck"],
  ])("refuses invalid %s", async (column, value, constraint) => {
    await station();
    const error = await captureError(() =>
      suite.db.execute(
        sql`update kitchen_stations set ${sql.identifier(column)} = ${value} where id = ${stationId}`,
      ),
    );
    expect(engineErrorMessage(error)).toContain(constraint);
  });
  it.each([
    ["warm_after_minutes", [1]],
    ["ready_warning_after_minutes", [1]],
    ["colour", STATION_COLOURS],
    ["ticket_grouping", TICKET_GROUPINGS],
    ["bump_mode", BUMP_MODES],
    ["changes_after_sending", CHANGES_AFTER_SENDING],
  ])("stores legitimate %s", async (column, values) => {
    await station();
    for (const value of values) {
      await suite.db.execute(
        sql`update kitchen_stations set ${sql.identifier(column)} = ${value} where id = ${stationId}`,
      );
      expect(
        suite.db.get(
          sql`select ${sql.identifier(column)} as value from kitchen_stations where id = ${stationId}`,
        ),
      ).toEqual({ value });
    }
  });
  it.each([
    [null, "other", "kitchen_stations_closed_sends_to_ck"],
    ["2026-11-12", stationId, "kitchen_stations_closed_sends_to_not_self_ck"],
    ["2026-11-12", "absent", "FOREIGN KEY constraint failed"],
  ])("refuses invalid closure %s / %s", async (day, destination, constraint) => {
    await station();
    await suite.db.insert(kitchenStations).values({ id: "other", name: "Other" });
    const error = await captureError(() =>
      suite.db.execute(sql`update kitchen_stations
      set closed_on_day = ${day}, closed_sends_to_station_id = ${destination} where id = ${stationId}`),
    );
    expect(engineErrorMessage(error)).toContain(constraint);
  });
  it("stores a closure with no destination and an open station", async () => {
    await station();
    for (const day of ["2026-11-12", null]) {
      await suite.db.execute(
        sql`update kitchen_stations set closed_on_day = ${day} where id = ${stationId}`,
      );
      expect(
        suite.db.get(
          sql`select closed_on_day, closed_sends_to_station_id from kitchen_stations where id = ${stationId}`,
        ),
      ).toEqual({ closed_on_day: day, closed_sends_to_station_id: null });
    }
  });
});
