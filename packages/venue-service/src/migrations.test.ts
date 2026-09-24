import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  captureError,
  CORE_MIGRATIONS,
  engineErrorMessage,
  floorZones,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  locations,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { departments } from "./schema/service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const TABLES = [
  "departments",
  "zone_service_policies",
  "zone_menus",
  "device_zone_defaults",
  "preparation_routes",
  "department_hours",
  "order_service_contexts",
  "working_line_contexts",
];

/** One row of `pragma table_info`. `pk` is 0 for a non-key column and the 1-based position in the
 * primary key otherwise. */
type ColumnRow = { name: string; pk: number };

async function columnsOf(table: string): Promise<ColumnRow[]> {
  const rows = await db.execute<ColumnRow>(sql`select name, pk from pragma_table_info(${table})`);
  return rows.rows;
}

/** The primary key's columns, in key order. */
async function primaryKeyOf(table: string): Promise<string[]> {
  return (await columnsOf(table))
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

/**
 * Each foreign key of `table`, as `(from columns) -> parent(to columns)` plus a delete rule when it
 * is not the default. The keys are unnamed in the generated SQL, so they are compared as a sorted
 * list of shapes; `./schema/service.test.ts` pins the names. A composite key spans several rows
 * sharing an `id`, ordered by `seq`.
 */
async function foreignKeysOf(table: string): Promise<string[]> {
  const rows = await db.execute<{
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>(sql`select id, seq, "table", "from", "to", on_delete from pragma_foreign_key_list(${table})`);
  const keys = new Map<number, { parent: string; from: string[]; to: string[]; del: string }>();
  for (const row of [...rows.rows].sort((left, right) => left.seq - right.seq)) {
    const entry = keys.get(row.id) ?? { parent: row.table, from: [], to: [], del: row.on_delete };
    entry.from.push(row.from);
    entry.to.push(row.to);
    keys.set(row.id, entry);
  }
  return [...keys.values()]
    .map(
      (key) =>
        `(${key.from.join(", ")}) -> ${key.parent}(${key.to.join(", ")})` +
        (key.del === "NO ACTION" ? "" : ` on delete ${key.del.toLowerCase()}`),
    )
    .sort();
}

/**
 * Every index the migration set created for `table`, by name: its columns in index order, and the
 * statement SQLite stored for it. SQLite stores no statement for an index it created itself to back
 * a key constraint, so a null `sql` marks one the migration did not write.
 */
async function indexesOf(
  table: string,
): Promise<Record<string, { columns: string[]; sql: string; unique: boolean }>> {
  const listed = await db.execute<{ name: string; unique: number }>(
    sql`select name, "unique" from pragma_index_list(${table})`,
  );
  const stored = await db.execute<{ name: string; sql: string | null }>(
    sql`select name, sql from sqlite_master where type = 'index' and tbl_name = ${table}`,
  );
  const text = new Map(stored.rows.map((row) => [row.name, row.sql]));
  const out: Record<string, { columns: string[]; sql: string; unique: boolean }> = {};
  for (const index of listed.rows) {
    const statement = text.get(index.name);
    if (statement === undefined || statement === null) continue;
    const columns = await db.execute<{ name: string }>(
      sql`select name from pragma_index_info(${index.name})`,
    );
    out[index.name] = {
      columns: columns.rows.map((column) => column.name),
      sql: statement,
      unique: index.unique === 1,
    };
  }
  return out;
}

describe("the venue-service migration set carries no tenant column", () => {
  it("has no tenant_id column on any table in the set", async () => {
    const carrying: string[] = [];
    for (const table of TABLES) {
      const columns = await columnsOf(table);
      // `pragma table_info` returns no rows for a table that does not exist.
      expect(columns.length, table).toBeGreaterThan(0);
      if (columns.some((column) => column.name === "tenant_id")) carrying.push(table);
    }
    expect(carrying).toEqual([]);
  });

  it("keys and links every table on its own columns and each parent's primary key", async () => {
    const shape: Record<string, { primaryKey: string[]; foreignKeys: string[] }> = {};
    for (const table of TABLES) {
      shape[table] = {
        primaryKey: await primaryKeyOf(table),
        foreignKeys: await foreignKeysOf(table),
      };
    }
    expect(shape).toEqual({
      departments: {
        primaryKey: ["id"],
        foreignKeys: ["(location_id) -> locations(id)"],
      },
      zone_service_policies: {
        primaryKey: ["zone_id"],
        foreignKeys: [
          "(default_menu_id) -> catalogues(id)",
          "(department_id) -> departments(id)",
          "(location_id) -> locations(id)",
          "(zone_id) -> floor_zones(id)",
          "(zone_id, default_menu_id) -> zone_menus(zone_id, menu_id)",
        ],
      },
      zone_menus: {
        primaryKey: ["zone_id", "menu_id"],
        foreignKeys: [
          "(menu_id) -> catalogues(id)",
          "(zone_id) -> zone_service_policies(zone_id) on delete cascade",
        ],
      },
      device_zone_defaults: {
        primaryKey: ["device_id"],
        foreignKeys: ["(device_id) -> devices(id)", "(zone_id) -> floor_zones(id)"],
      },
      preparation_routes: {
        primaryKey: ["id"],
        foreignKeys: [
          "(category_id) -> categories(id)",
          "(location_id) -> locations(id)",
          "(product_id) -> products(id)",
          "(station_id) -> kitchen_stations(id)",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      department_hours: {
        primaryKey: ["id"],
        foreignKeys: ["(department_id) -> departments(id) on delete cascade"],
      },
      order_service_contexts: {
        primaryKey: ["working_order_id"],
        foreignKeys: [
          "(department_id) -> departments(id)",
          "(working_order_id) -> working_orders(id) on delete cascade",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      working_line_contexts: {
        primaryKey: ["working_order_line_id"],
        foreignKeys: [
          "(menu_item_id) -> menu_items(id)",
          "(working_order_line_id) -> working_order_lines(id) on delete cascade",
        ],
      },
    });
  });

  it("rebuilds every index without the tenant", async () => {
    const defs: Record<string, { columns: string[]; sql: string; unique: boolean }> = {};
    for (const table of TABLES) Object.assign(defs, await indexesOf(table));
    expect(Object.keys(defs).filter((name) => name.includes("tenant"))).toEqual([]);
    expect(Object.values(defs).filter((def) => def.sql.includes("tenant"))).toEqual([]);
    const columns = (name: string) => defs[name]?.columns;
    // No PRAGMA reports a partial index's `WHERE`, so it is read off the stored statement.
    const predicate = (name: string) => / WHERE (.*)$/.exec(defs[name]?.sql ?? "")?.[1];
    expect(columns("preparation_routes_lookup_idx")).toEqual([
      "location_id",
      "zone_id",
      "product_id",
      "category_id",
    ]);
    expect(columns("zone_menus_order_idx")).toEqual(["zone_id", "display_order"]);
    expect(columns("department_hours_interval_key")).toEqual([
      "department_id",
      "weekday",
      "opens_at",
      "closes_at",
    ]);
    expect(columns("departments_location_name_key")).toEqual(["location_id", "name"]);
    expect(columns("preparation_routes_zone_product_key")).toEqual([
      "location_id",
      "zone_id",
      "product_id",
    ]);
    expect(predicate("preparation_routes_zone_product_key")).toBe(
      `"preparation_routes"."zone_id" is not null and "preparation_routes"."product_id" is not null`,
    );
    expect(columns("preparation_routes_zone_category_key")).toEqual([
      "location_id",
      "zone_id",
      "category_id",
    ]);
    expect(predicate("preparation_routes_zone_category_key")).toBe(
      `"preparation_routes"."zone_id" is not null and "preparation_routes"."category_id" is not null`,
    );
    expect(columns("preparation_routes_venue_product_key")).toEqual(["location_id", "product_id"]);
    expect(predicate("preparation_routes_venue_product_key")).toBe(
      `"preparation_routes"."zone_id" is null and "preparation_routes"."product_id" is not null`,
    );
    expect(columns("preparation_routes_venue_category_key")).toEqual([
      "location_id",
      "category_id",
    ]);
    expect(predicate("preparation_routes_venue_category_key")).toBe(
      `"preparation_routes"."zone_id" is null and "preparation_routes"."category_id" is not null`,
    );
    expect(columns("departments_one_default_per_location_key")).toEqual(["location_id"]);
    expect(predicate("departments_one_default_per_location_key")).toBe(
      `"departments"."is_default"`,
    );
    expect(columns("zone_service_policies_one_counter_default_key")).toEqual(["location_id"]);
    expect(predicate("zone_service_policies_one_counter_default_key")).toBe(
      `"zone_service_policies"."is_counter_default"`,
    );
    for (const name of [
      "department_hours_interval_key",
      "departments_location_name_key",
      "preparation_routes_zone_product_key",
      "preparation_routes_zone_category_key",
      "preparation_routes_venue_product_key",
      "preparation_routes_venue_category_key",
      "departments_one_default_per_location_key",
      "zone_service_policies_one_counter_default_key",
    ]) {
      expect(defs[name]?.unique, name).toBe(true);
    }
  });
});

describe("the venue-service foreign keys refuse a missing target", () => {
  async function venue() {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId, name: "Terrace" })
      .returning({ id: floorZones.id });
    const [department] = await db
      .insert(departments)
      .values({
        locationId,
        name: "Bar",
        tradingName: "Bar",
        defaultServiceMode: "prepay",
      })
      .returning({ id: departments.id });
    const menu = await db.transaction((tx) => createCatalogue(tx, { name: "Drinks" }));
    return {
      locationId: locationId as string,
      zoneId: zone!.id,
      departmentId: department!.id,
      menuId: menu.id,
    };
  }

  /**
   * Asserts that `statement` is refused by a foreign key — but not WHICH one: SQLite's message names
   * no key, so `constraint` is only the assertion's label. Each statement below reaches a shape only
   * its named key can refuse.
   */
  async function refusal(statement: ReturnType<typeof sql>, constraint: string) {
    const error = await captureError(() => db.transaction((tx) => tx.execute(statement)));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION), constraint).toBe(true);
    expect(engineErrorMessage(error), constraint).toContain("FOREIGN KEY constraint failed");
  }

  it("refuses a department, zone or menu that does not exist", async () => {
    const v = await venue();
    const missing = "00000000-0000-4000-8000-00000000dead";
    await refusal(
      // `id` and `created_at` are named, or the insert is refused as NOT NULL before the foreign
      // key is reached.
      sql`insert into departments (id, location_id, name, trading_name, default_service_mode, created_at)
        values (${randomUUID()}, ${missing}, 'X', 'X', 'prepay', ${new Date().toISOString()})`,
      "departments_location_fk",
    );
    await refusal(
      sql`insert into zone_service_policies (location_id, zone_id, department_id)
        values (${v.locationId}, ${missing}, ${v.departmentId})`,
      "zone_service_policies_zone_fk",
    );
    await refusal(
      sql`insert into zone_service_policies (location_id, zone_id, department_id)
        values (${v.locationId}, ${v.zoneId}, ${missing})`,
      "zone_service_policies_department_fk",
    );
    await refusal(
      sql`insert into zone_menus (zone_id, menu_id) values (${v.zoneId}, ${v.menuId})`,
      "zone_menus_zone_fk",
    );
    await refusal(
      sql`insert into department_hours (id, department_id, weekday, opens_at, closes_at)
        values (${randomUUID()}, ${missing}, 1, '09:00', '17:00')`,
      "department_hours_department_fk",
    );
    await refusal(
      sql`insert into order_service_contexts
          (working_order_id, location_id, zone_id, department_id, service_mode)
        values (${missing}, ${v.locationId}, ${v.zoneId}, ${v.departmentId}, 'prepay')`,
      "order_service_contexts_order_fk",
    );
  });

  /**
   * The key is not deferred, so it is checked at each statement. `pragma defer_foreign_keys` moves
   * the check to commit, which is how `apps/server/src/configuration-transfer.ts` empties and
   * refills this cycle: `zone_menus.zone_id` points at `zone_service_policies`, whose
   * `(zone_id, default_menu_id)` points back at `zone_menus`. The title's "at commit" half is not
   * asserted: the case under the pragma is accepted, not refused.
   */
  it("refuses a default menu the zone does not allow, at the statement or at commit", async () => {
    const v = await venue();
    await db.execute(sql`
      insert into zone_service_policies (location_id, zone_id, department_id)
      values (${v.locationId}, ${v.zoneId}, ${v.departmentId})`);
    await refusal(
      sql`update zone_service_policies set default_menu_id = ${v.menuId} where zone_id = ${v.zoneId}`,
      "zone_service_policies_default_allowed_fk",
    );

    // Reversed order, no pragma: refused.
    const eager = await captureError(() =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`update zone_service_policies set default_menu_id = ${v.menuId} where zone_id = ${v.zoneId}`,
        );
        await tx.execute(
          sql`insert into zone_menus (zone_id, menu_id) values (${v.zoneId}, ${v.menuId})`,
        );
      }),
    );
    expect(isRefusal(eager, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(engineErrorMessage(eager)).toContain("FOREIGN KEY constraint failed");
    expect(
      (
        await db.execute(
          sql`select default_menu_id from zone_service_policies where zone_id = ${v.zoneId}`,
        )
      ).rows,
    ).toEqual([{ default_menu_id: null }]);

    // The same reversed order under the pragma: accepted.
    await db.transaction(async (tx) => {
      await tx.execute(sql`pragma defer_foreign_keys = on`);
      await tx.execute(
        sql`update zone_service_policies set default_menu_id = ${v.menuId} where zone_id = ${v.zoneId}`,
      );
      await tx.execute(
        sql`insert into zone_menus (zone_id, menu_id) values (${v.zoneId}, ${v.menuId})`,
      );
    });
    const policy = await db.execute<{ default_menu_id: string }>(
      sql`select default_menu_id from zone_service_policies where zone_id = ${v.zoneId}`,
    );
    expect(policy.rows).toEqual([{ default_menu_id: v.menuId }]);
    // The pragma holds only until that transaction ends: it is off again here.
    expect((await db.execute(sql`pragma defer_foreign_keys`)).rows).toEqual([
      { defer_foreign_keys: 0 },
    ]);
  });
});
