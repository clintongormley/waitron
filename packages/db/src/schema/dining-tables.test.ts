import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedVenue, seedZone } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { isRefusal } from "../unique-violation.js";
import { NOT_NULL_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { shortNameColumns } from "../table-short-names.js";
import { diningTables } from "./dining-tables.js";
import { locations } from "./tenants.js";

const LOCATION_B = "aaaaaaaa-0000-4000-8000-000000000002";

describe("table labels without a location", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("two tables cannot share a label, including in different zones", async () => {
    await seedZone(suite.db, { id: "inside", name: "Inside" });
    await seedZone(suite.db, { id: "outside", name: "Outside" });
    const insert = (id: string, label: string, zone: string) =>
      suite.db.run(sql`insert into dining_tables (id, label, zone_id, created_at)
        values (${id}, ${label}, ${zone}, '2026-11-11')`);
    await insert("first", "Table 1", "inside");
    await insert("second", "Table 2", "outside");
    const error = await captureError(() => insert("duplicate", "Table 1", "outside"));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: dining_tables.label");
    expect(suite.db.all(sql`select id from dining_tables order by id`)).toEqual([
      { id: "first" },
      { id: "second" },
    ]);
  });
});

describe("dining_tables columns", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(locations).values({
      id: LOCATION_B,
    });
    await seedVenueSettings(db, {
      name: "Loc B",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    });
    await seedBusinessDay(db, {});
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Through the Drizzle builder rather than raw SQL: `dining_tables.id` takes its value from a
  // `$defaultFn` that Drizzle applies CLIENT-side, so a raw `insert` never reaches it and the row
  // is refused `NOT NULL constraint failed: dining_tables.id`.
  async function seedTable(label: string, shortName?: string): Promise<string> {
    return inTx(async (tx) => {
      const zone = await seedZone(tx, { name: label });
      const [row] = await tx
        .insert(diningTables)
        .values({
          label,
          zoneId: zone!.id,
          ...(shortName === undefined ? {} : shortNameColumns(shortName)),
        })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  it("accepts a dining table in its zone", async () => {
    const id = await seedTable("T-zoned");
    const [row] = await inTx((tx) => tx.select().from(diningTables).where(eq(diningTables.id, id)));
    expect(row).toMatchObject({
      id,
      label: "T-zoned",
      zoneId: expect.any(String),
      planTableId: null,
    });
  });

  it("refuses a dining table with no zone", async () => {
    const id = randomUUID();
    const error = await captureError(() =>
      inTx(async (tx) => {
        tx.run(
          sql`insert into dining_tables (id, label, created_at) values (${id}, ${"T-no-zone"}, ${"2026-10-11T10:00:00.000Z"})`,
        );
      }),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("NOT NULL constraint failed: dining_tables.zone_id");
  });

  it("has only the columns today's plan needs", () => {
    const columns = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('dining_tables')`,
    );
    expect(columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "id",
      "label",
      "needs_clearing_since",
      "on_floor",
      "plan_table_id",
      "short_name",
      "short_name_key",
      "taken_off",
      "today_fixed",
      "today_height",
      "today_name",
      "today_rotation",
      "today_seats",
      "today_shape",
      "today_width",
      "today_x",
      "today_y",
      "zone_id",
    ]);
  });

  it("refuses two tables of one venue whose short names differ only in case", async () => {
    await seedTable("Terrace 1", "T1");
    const error = await captureError(() => seedTable("Tower 1", "t1"));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "UNIQUE constraint failed: dining_tables.short_name_key",
    );
  });

  it("a key a writer did not fold is not refused", async () => {
    await seedTable("Terrace 1", "t1");
    const id = await inTx(async (tx) => {
      const zone = await seedZone(tx, { name: "Tower" });
      const [row] = await tx
        .insert(diningTables)
        .values({
          label: "Tower 1",
          zoneId: zone!.id,
          shortName: "T1",
          shortNameKey: "T1",
        })
        .returning({ id: diningTables.id });
      return row!.id;
    });
    const [row] = await inTx((tx) =>
      tx
        .select({ shortNameKey: diningTables.shortNameKey })
        .from(diningTables)
        .where(eq(diningTables.id, id)),
    );
    expect(row).toEqual({ shortNameKey: "T1" });
  });

  it("allows any number of tables without a short name", async () => {
    const other = await seedTable("Garden 1", "G1");
    const first = await seedTable("Unnamed 1");
    const second = await seedTable("Unnamed 2");
    const rows = await inTx((tx) =>
      tx
        .select({ id: diningTables.id, shortName: diningTables.shortName })
        .from(diningTables)
        .where(inArray(diningTables.id, [other, first, second])),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === other)?.shortName).toBe("G1");
    expect(rows.filter((row) => row.shortName === null)).toHaveLength(2);
  });

  it("keeps no venue-made status table and no trigger that cleared one", () => {
    const leftovers = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name in ('table_service_statuses', 'parties_clear_table_status')`,
    );
    expect(leftovers).toEqual([]);
  });

  it("gives a dining table no pointer to a bill", () => {
    const columns = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('dining_tables')`,
    );
    expect(columns.map((column) => column.name)).not.toContain("tab_id");
    // Control: the read sees the table's columns at all.
    expect(columns.map((column) => column.name)).toContain("needs_clearing_since");
  });
});

describe("today's map on dining_tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  async function table() {
    const zone = await seedZone(suite.db, { name: "Today" });
    await suite.db
      .insert(diningTables)
      .values({ id: "today-table", label: "Today 1", zoneId: zone.id });
  }
  it.each([
    [
      "off-floor placement",
      sql`update dining_tables set today_x=1, today_y=2, today_width=3, today_height=4, today_shape='rect', today_rotation=0 where id='today-table'`,
      "dining_tables_off_floor_ck",
    ],
    [
      "off-floor taken-off mark",
      sql`update dining_tables set taken_off=1 where id='today-table'`,
      "dining_tables_off_floor_ck",
    ],
    [
      "five placement values",
      sql`update dining_tables set on_floor=1, today_x=1, today_y=2, today_width=3, today_height=4, today_shape='rect' where id='today-table'`,
      "dining_tables_today_placement_ck",
    ],
    [
      "1000 seats",
      sql`update dining_tables set on_floor=1, today_seats=1000 where id='today-table'`,
      "dining_tables_today_seats_ck",
    ],
  ] as const)("refuses invalid today's values: %s", async (_name, query, constraint) => {
    await table();
    const error = await captureError(() => suite.db.execute(query));
    expect(engineErrorMessage(error)).toContain(constraint);
  });
  it("stores a spare on the floor without a place", async () => {
    await table();
    await suite.db.execute(sql`update dining_tables set on_floor=1 where id='today-table'`);
    expect(
      suite.db.get(
        sql`select on_floor, today_x, today_seats, taken_off from dining_tables where id='today-table'`,
      ),
    ).toEqual({ on_floor: 1, today_x: null, today_seats: null, taken_off: 0 });
  });
});
