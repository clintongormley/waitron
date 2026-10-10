import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  deviceProfiles,
  devices,
  engineErrorMessage,
  floorZones,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  kitchenStations,
  locations,
  UNIQUE_VIOLATION,
  withTransaction,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { departments } from "./schema/service.js";
import { specialDates } from "./schema/hours.js";

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
  "zone_closed_times",
  "zone_extensions",
  "menu_period_staff_menus",
  "device_profile_service_access",
  "device_profile_zones",
  "station_day_states",
  "period_extensions",
  "routing_cells",
  "routing_cell_periods",
  "order_service_contexts",
  "working_line_contexts",
  "service_settings",
  "kitchen_notices",
  "device_profile_kitchen_screens",
  "device_profile_kitchen_screen_stations",
  "device_profile_kitchen_screen_zones",
  "device_kitchen_screens",
  "device_kitchen_screen_stations",
  "device_kitchen_screen_zones",
  "device_kitchen_screen_removals",
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

describe("retired service-style storage", () => {
  it.each([
    {
      statement: sql`update departments set default_service_mode = 'prepay'`,
      column: "default_service_mode",
    },
    {
      statement: sql`update zone_service_policies set service_mode = 'prepay'`,
      column: "service_mode",
    },
  ])("refuses a write to the retired $column column", async ({ statement, column }) => {
    const refused = await captureError(() => withTransaction(db, (tx) => tx.execute(statement)));
    expect(engineErrorMessage(refused)).toContain(`no such column: ${column}`);
  });
});

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

  it("leaves no station-hours or fallback table behind", async () => {
    const left = await db.execute<{ name: string }>(sql`select name from sqlite_master
      where type = 'table' and name in ('hours_week_cells', 'hours_week_periods',
        'special_date_hours', 'special_date_hours_periods', 'station_fallbacks')`);
    expect(left.rows).toEqual([]);
  });

  it("leaves no interval-list hours table behind", async () => {
    const left = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where name in ('station_hours', 'department_hours',
        'station_hours_interval_key', 'department_hours_interval_key')`,
    );
    expect(left.rows).toEqual([]);
    expect((await columnsOf("special_dates")).length).toBeGreaterThan(0);
  });

  it("leaves no profile station or watcher list behind", async () => {
    const left = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where name in ('device_profile_stations',
        'device_profile_watchers')`,
    );
    expect(left.rows).toEqual([]);
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
          "(department_id) -> departments(id)",
          "(location_id) -> locations(id)",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      zone_closed_times: {
        primaryKey: ["id"],
        foreignKeys: [
          "(special_date_id) -> special_dates(id) on delete cascade",
          "(zone_id) -> zone_service_policies(zone_id)",
        ],
      },
      zone_extensions: {
        primaryKey: ["id"],
        foreignKeys: ["(zone_id) -> zone_service_policies(zone_id)"],
      },
      menu_period_staff_menus: {
        primaryKey: ["period_id", "menu_id"],
        foreignKeys: [
          "(menu_id) -> catalogues(id)",
          "(period_id, department_id) -> menu_periods(id, department_id) on delete cascade",
        ],
      },
      device_profile_service_access: {
        primaryKey: ["device_profile_id"],
        foreignKeys: [
          "(department_id) -> departments(id)",
          "(device_profile_id) -> device_profiles(id) on delete cascade",
          "(starting_zone_id) -> floor_zones(id)",
        ],
      },
      device_profile_zones: {
        primaryKey: ["device_profile_id", "zone_id"],
        foreignKeys: [
          "(device_profile_id) -> device_profile_service_access(device_profile_id) on delete cascade",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      station_day_states: {
        primaryKey: ["id"],
        foreignKeys: [
          "(sends_to_station_id) -> kitchen_stations(id)",
          "(station_id) -> kitchen_stations(id)",
        ],
      },
      period_extensions: {
        primaryKey: ["id"],
        foreignKeys: [
          "(department_id) -> departments(id)",
          "(period_id, department_id) -> menu_periods(id, department_id) on delete cascade",
        ],
      },
      routing_cells: {
        primaryKey: ["id"],
        foreignKeys: [
          "(category_id) -> categories(id) on delete cascade",
          "(location_id) -> locations(id)",
          "(product_id) -> products(id)",
          "(station_id) -> kitchen_stations(id)",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      routing_cell_periods: {
        primaryKey: ["id"],
        foreignKeys: [
          "(cell_id) -> routing_cells(id) on delete cascade",
          "(period_id, department_id) -> menu_periods(id, department_id) on delete cascade",
          "(station_id) -> kitchen_stations(id)",
        ],
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
          "(menu_version_id) -> menu_versions(id)",
          "(working_order_line_id) -> working_order_lines(id) on delete cascade",
        ],
      },
      service_settings: { primaryKey: ["id"], foreignKeys: [] },
      kitchen_notices: {
        primaryKey: ["id"],
        foreignKeys: [
          "(station_id) -> kitchen_stations(id)",
          "(working_order_id) -> working_orders(id) on delete cascade",
        ],
      },
      device_profile_kitchen_screens: {
        primaryKey: ["device_profile_id", "screen"],
        foreignKeys: ["(device_profile_id) -> device_profiles(id) on delete cascade"],
      },
      device_profile_kitchen_screen_stations: {
        primaryKey: ["device_profile_id", "screen", "station_id"],
        foreignKeys: [
          "(device_profile_id, screen) -> device_profile_kitchen_screens(device_profile_id, screen) on delete cascade",
          "(station_id) -> kitchen_stations(id)",
        ],
      },
      device_profile_kitchen_screen_zones: {
        primaryKey: ["device_profile_id", "screen", "zone_id"],
        foreignKeys: [
          "(device_profile_id, screen) -> device_profile_kitchen_screens(device_profile_id, screen) on delete cascade",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      device_kitchen_screens: {
        primaryKey: ["device_id", "screen"],
        foreignKeys: ["(device_id) -> devices(id)"],
      },
      device_kitchen_screen_stations: {
        primaryKey: ["device_id", "screen", "station_id"],
        foreignKeys: [
          "(device_id, screen) -> device_kitchen_screens(device_id, screen) on delete cascade",
          "(station_id) -> kitchen_stations(id)",
        ],
      },
      device_kitchen_screen_zones: {
        primaryKey: ["device_id", "screen", "zone_id"],
        foreignKeys: [
          "(device_id, screen) -> device_kitchen_screens(device_id, screen) on delete cascade",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      device_kitchen_screen_removals: {
        primaryKey: ["id"],
        foreignKeys: [
          "(device_id) -> devices(id)",
          "(station_id) -> kitchen_stations(id)",
          "(zone_id) -> floor_zones(id)",
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
    expect(columns("station_day_states_day_key")).toEqual(["station_id", "business_day"]);
    expect(defs["station_day_states_day_key"]?.unique).toBe(true);
    expect(columns("kitchen_notices_open_idx")).toEqual(["station_id", "created_at"]);
    expect(predicate("kitchen_notices_open_idx")).toBe(
      `"kitchen_notices"."acknowledged_at" is null`,
    );
    expect(columns("device_kitchen_screen_removals_device_idx")).toEqual(["device_id"]);
    expect(columns("departments_location_name_key")).toEqual(["location_id", "name"]);
    expect(columns("departments_one_default_per_location_key")).toEqual(["location_id"]);
    expect(predicate("departments_one_default_per_location_key")).toBe(
      `"departments"."is_default"`,
    );
    expect(columns("zone_service_policies_one_counter_default_key")).toEqual(["location_id"]);
    expect(predicate("zone_service_policies_one_counter_default_key")).toBe(
      `"zone_service_policies"."is_counter_default"`,
    );
    for (const name of [
      "departments_location_name_key",
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

  async function orderStartPolicies() {
    const v = await venue();
    await db.execute(sql`insert into zone_service_policies (location_id, zone_id, department_id)
      values (${v.locationId}, ${v.zoneId}, ${v.departmentId})`);
    return v;
  }

  it.each(["department", "zone"] as const)(
    "receipt storage refuses Never on %s inserts and updates",
    async (kind) => {
      const v = await orderStartPolicies();
      const insert =
        kind === "department"
          ? sql`insert into department_sale_policies (department_id, receipt_print_mode) values (${v.departmentId}, 'never')`
          : sql`insert into zone_sale_policies (zone_id, receipt_print_mode) values (${v.zoneId}, 'never')`;
      await expect(withTransaction(db, (tx) => tx.execute(insert))).rejects.toThrow(
        kind === "department"
          ? "department_sale_policies_receipt_mode_ck"
          : "zone_sale_policies_receipt_mode_ck",
      );
      await db.execute(
        kind === "department"
          ? sql`insert into department_sale_policies (department_id) values (${v.departmentId})`
          : sql`insert into zone_sale_policies (zone_id) values (${v.zoneId})`,
      );
      const read = () =>
        db.all(
          kind === "department"
            ? sql`select receipt_print_mode from department_sale_policies where department_id = ${v.departmentId}`
            : sql`select receipt_print_mode from zone_sale_policies where zone_id = ${v.zoneId}`,
        );
      expect(read()).toEqual([{ receipt_print_mode: kind === "department" ? "auto" : null }]);
      for (const mode of ["auto", "on_request", ...(kind === "zone" ? [null] : [])]) {
        await db.execute(
          kind === "department"
            ? sql`update department_sale_policies set receipt_print_mode = ${mode} where department_id = ${v.departmentId}`
            : sql`update zone_sale_policies set receipt_print_mode = ${mode} where zone_id = ${v.zoneId}`,
        );
        expect(read()).toEqual([{ receipt_print_mode: mode }]);
      }
      const before = read();
      const update =
        kind === "department"
          ? sql`update department_sale_policies set receipt_print_mode = 'never' where department_id = ${v.departmentId}`
          : sql`update zone_sale_policies set receipt_print_mode = 'never' where zone_id = ${v.zoneId}`;
      await expect(withTransaction(db, (tx) => tx.execute(update))).rejects.toThrow(
        kind === "department"
          ? "department_sale_policies_receipt_mode_ck"
          : "zone_sale_policies_receipt_mode_ck",
      );
      expect(read()).toEqual(before);
      if (kind === "department")
        await expect(
          withTransaction(db, (tx) =>
            tx.execute(
              sql`update department_sale_policies set receipt_print_mode = null where department_id = ${v.departmentId}`,
            ),
          ),
        ).rejects.toThrow(
          "NOT NULL constraint failed: department_sale_policies.receipt_print_mode",
        );
    },
  );

  it("order start defaults to counter for a department and null for a zone", async () => {
    const v = await orderStartPolicies();
    await db.execute(sql`insert into department_sale_policies (department_id)
      values (${v.departmentId})`);
    await db.execute(sql`insert into zone_sale_policies (zone_id) values (${v.zoneId})`);
    expect(
      (
        await db.execute(sql`select order_start from department_sale_policies
      where department_id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ order_start: "counter" }]);
    expect(
      (
        await db.execute(sql`select order_start from zone_sale_policies
      where zone_id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ order_start: null }]);
  });

  it("order start stores table and counter independently on each policy", async () => {
    const v = await orderStartPolicies();
    await db.execute(sql`insert into department_sale_policies (department_id, order_start)
      values (${v.departmentId}, 'table')`);
    await db.execute(sql`insert into zone_sale_policies (zone_id, order_start)
      values (${v.zoneId}, 'counter')`);
    expect(
      (
        await db.execute(sql`select p.order_start as department_start, q.order_start as zone_start
      from department_sale_policies p join zone_sale_policies q on q.zone_id = ${v.zoneId}
      where p.department_id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ department_start: "table", zone_start: "counter" }]);
    await db.execute(sql`update department_sale_policies set order_start = 'counter'
      where department_id = ${v.departmentId}`);
    await db.execute(sql`update zone_sale_policies set order_start = 'table'
      where zone_id = ${v.zoneId}`);
    expect(
      (
        await db.execute(sql`select p.order_start as department_start, q.order_start as zone_start
      from department_sale_policies p join zone_sale_policies q on q.zone_id = ${v.zoneId}
      where p.department_id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ department_start: "counter", zone_start: "table" }]);
    await db.execute(
      sql`update zone_sale_policies set order_start = null where zone_id = ${v.zoneId}`,
    );
    expect(
      (
        await db.execute(sql`select order_start from zone_sale_policies
      where zone_id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ order_start: null }]);
  });

  it.each(["department", "zone"] as const)(
    "order start rejects an unknown value on %s policy insert and update",
    async (policy) => {
      const v = await orderStartPolicies();
      const insert =
        policy === "department"
          ? sql`insert into department_sale_policies (department_id, order_start)
            values (${v.departmentId}, 'tab')`
          : sql`insert into zone_sale_policies (zone_id, order_start) values (${v.zoneId}, 'tab')`;
      const insertError = await captureError(() => withTransaction(db, (tx) => tx.execute(insert)));
      expect(isRefusal(insertError, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(insertError)).toContain(
        policy === "department"
          ? "department_sale_policies_order_start_ck"
          : "zone_sale_policies_order_start_ck",
      );
      await db.execute(
        policy === "department"
          ? sql`insert into department_sale_policies (department_id, order_start)
            values (${v.departmentId}, 'table')`
          : sql`insert into zone_sale_policies (zone_id, order_start) values (${v.zoneId}, 'counter')`,
      );
      const update =
        policy === "department"
          ? sql`update department_sale_policies set order_start = 'tab' where department_id = ${v.departmentId}`
          : sql`update zone_sale_policies set order_start = 'tab' where zone_id = ${v.zoneId}`;
      const updateError = await captureError(() => withTransaction(db, (tx) => tx.execute(update)));
      expect(isRefusal(updateError, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(updateError)).toContain(
        policy === "department"
          ? "department_sale_policies_order_start_ck"
          : "zone_sale_policies_order_start_ck",
      );
      expect(
        (
          await db.execute(
            policy === "department"
              ? sql`select order_start from department_sale_policies where department_id = ${v.departmentId}`
              : sql`select order_start from zone_sale_policies where zone_id = ${v.zoneId}`,
          )
        ).rows,
      ).toEqual([{ order_start: policy === "department" ? "table" : "counter" }]);
    },
  );

  it("order start refuses explicit department null instead of applying its default", async () => {
    const v = await orderStartPolicies();
    const error = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.execute(sql`insert into department_sale_policies (department_id, order_start)
        values (${v.departmentId}, null)`),
      ),
    );
    expect(engineErrorMessage(error)).toContain(
      "NOT NULL constraint failed: department_sale_policies.order_start",
    );
    expect(
      (
        await db.execute(sql`select department_id from department_sale_policies
      where department_id = ${v.departmentId}`)
      ).rows,
    ).toEqual([]);
  });

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

  async function zoneWithPolicy() {
    const v = await venue();
    await db.execute(sql`insert into zone_service_policies (location_id, zone_id, department_id)
      values (${v.locationId}, ${v.zoneId}, ${v.departmentId})`);
    return v;
  }

  it("keeps one zone extension per business day while other zones and days remain independent", async () => {
    const v = await zoneWithPolicy();
    const other = await zoneWithPolicy();
    const extension = (zoneId: string, businessDay: string) =>
      sql`insert into zone_extensions (id, zone_id, business_day, starts_at, ends_at)
        values (${randomUUID()}, ${zoneId}, ${businessDay}, '23:30:00', '01:30:00')`;
    await db.execute(extension(v.zoneId, "2026-10-09"));
    await db.execute(extension(v.zoneId, "2026-10-10"));
    await db.execute(extension(other.zoneId, "2026-10-09"));
    expect(
      (
        await db.execute(sql`select business_day, starts_at, ends_at from zone_extensions
      where zone_id = ${v.zoneId} order by business_day`)
      ).rows,
    ).toEqual([
      { business_day: "2026-10-09", starts_at: "23:30:00", ends_at: "01:30:00" },
      { business_day: "2026-10-10", starts_at: "23:30:00", ends_at: "01:30:00" },
    ]);
    expect(
      (
        await db.execute(sql`select business_day from zone_extensions
      where zone_id = ${other.zoneId}`)
      ).rows,
    ).toEqual([{ business_day: "2026-10-09" }]);
    const error = await captureError(() =>
      db.transaction((tx) => tx.execute(extension(v.zoneId, "2026-10-09"))),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(
      "zone_extensions.zone_id, zone_extensions.business_day",
    );
  });

  it.each([
    ["23:10:00", "01:30:00"],
    ["23:30:00", "01:10:00"],
  ])("refuses zone extension endpoints %s–%s between quarter-hours", async (start, end) => {
    const v = await zoneWithPolicy();
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(
          sql`insert into zone_extensions (id, zone_id, business_day, starts_at, ends_at)
        values (${randomUUID()}, ${v.zoneId}, '2026-10-09', ${start}, ${end})`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("zone_extensions_step_ck");
  });

  it("ties a zone extension to an existing zone service policy", async () => {
    const v = await venue();
    const extension = (zoneId: string) => sql`insert into zone_extensions
      (id, zone_id, business_day, starts_at, ends_at)
      values (${randomUUID()}, ${zoneId}, '2026-10-09', '23:30:00', '01:30:00')`;
    await refusal(extension(v.zoneId), "zone_extensions_zone_fk");
    await refusal(extension(randomUUID()), "zone_extensions_zone_fk");
    await db.execute(sql`insert into zone_service_policies (location_id, zone_id, department_id)
      values (${v.locationId}, ${v.zoneId}, ${v.departmentId})`);
    await db.execute(extension(v.zoneId));
    expect(
      (
        await db.execute(sql`select zone_id from zone_extensions
      where zone_id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ zone_id: v.zoneId }]);
  });

  it("keeps only one period extension per department and business day", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const extension = (businessDay: string, start = "14:00:00", end = "14:30:00") =>
      sql`insert into period_extensions (id, department_id, business_day, period_id, starts_at, ends_at)
        values (${randomUUID()}, ${v.departmentId}, ${businessDay}, ${periodId}, ${start}, ${end})`;
    await db.execute(extension("2026-10-08"));
    await db.execute(extension("2026-10-09", "03:00:00", "06:00:00"));
    expect(
      (
        await db.execute(sql`select business_day, starts_at, ends_at from period_extensions
      where department_id = ${v.departmentId} order by business_day`)
      ).rows,
    ).toEqual([
      { business_day: "2026-10-08", starts_at: "14:00:00", ends_at: "14:30:00" },
      { business_day: "2026-10-09", starts_at: "03:00:00", ends_at: "06:00:00" },
    ]);
    const error = await captureError(() =>
      db.transaction((tx) => tx.execute(extension("2026-10-08"))),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(
      "period_extensions.department_id, period_extensions.business_day",
    );
  });

  it.each([
    ["14:10:00", "14:30:00"],
    ["14:00:00", "14:10:00"],
  ])("refuses period extension endpoints %s–%s between quarter-hours", async (start, end) => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
        values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(
          sql`insert into period_extensions (id, department_id, business_day, period_id, starts_at, ends_at)
          values (${randomUUID()}, ${v.departmentId}, '2026-10-08', ${periodId}, ${start}, ${end})`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("period_extensions_step_ck");
  });

  it("ties an extension to its period's department and deletes it with its period", async () => {
    const v = await venue();
    const other = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const extension = (departmentId: string, targetPeriod: string) =>
      sql`insert into period_extensions (id, department_id, business_day, period_id, starts_at, ends_at)
        values (${randomUUID()}, ${departmentId}, '2026-10-08', ${targetPeriod}, '14:00:00', '14:30:00')`;
    await refusal(extension(other.departmentId, periodId), "period_extensions_period_fk");
    await refusal(extension(v.departmentId, randomUUID()), "period_extensions_period_fk");
    await refusal(extension(randomUUID(), periodId), "period_extensions_department_fk");
    await db.execute(extension(v.departmentId, periodId));
    expect(
      (
        await db.execute(
          sql`select period_id from period_extensions where department_id = ${v.departmentId}`,
        )
      ).rows,
    ).toEqual([{ period_id: periodId }]);
    await db.execute(sql`delete from menu_periods where id = ${periodId}`);
    expect(
      (
        await db.execute(
          sql`select period_id from period_extensions where department_id = ${v.departmentId}`,
        )
      ).rows,
    ).toEqual([]);
  });

  it("stores a station's chosen destination while accepting a day with no destination", async () => {
    const v = await venue();
    const [station, destination] = await db
      .insert(kitchenStations)
      .values([
        { locationId: brandLocationId(v.locationId), name: "Grill" },
        { locationId: brandLocationId(v.locationId), name: "Bar" },
      ])
      .returning({ id: kitchenStations.id });
    const state = (day: string, sendsTo: string | null) =>
      sql`insert into station_day_states (id, station_id, business_day, open, sends_to_station_id)
        values (${randomUUID()}, ${station!.id}, ${day}, 0, ${sendsTo})`;
    await db.execute(state("2026-10-08", destination!.id));
    await db.execute(state("2026-10-09", null));
    expect(
      (
        await db.execute(sql`select business_day, sends_to_station_id from station_day_states
      where station_id = ${station!.id} order by business_day`)
      ).rows,
    ).toEqual([
      { business_day: "2026-10-08", sends_to_station_id: destination!.id },
      { business_day: "2026-10-09", sends_to_station_id: null },
    ]);
    await refusal(state("2026-10-10", randomUUID()), "station_day_states_sends_to_fk");
    const self = await captureError(() =>
      db.transaction((tx) => tx.execute(state("2026-10-10", station!.id))),
    );
    expect(isRefusal(self, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(self)).toContain("station_day_states_sends_to_not_self_ck");
  });

  async function routedPeriod() {
    const v = await venue();
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: brandLocationId(v.locationId), name: "Grill" })
      .returning({ id: kitchenStations.id });
    const cellId = randomUUID();
    await db.execute(sql`insert into routing_cells (id, location_id, zone_id, station_id)
      values (${cellId}, ${v.locationId}, ${v.zoneId}, ${station!.id})`);
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const choice = (
      over: { cell?: string; period?: string; department?: string; station?: string | null } = {},
      noPreparation = 0,
    ) => sql`insert into routing_cell_periods
      (id, cell_id, period_id, department_id, station_id, no_preparation)
      values (${randomUUID()}, ${over.cell ?? cellId}, ${over.period ?? periodId},
        ${over.department ?? v.departmentId},
        ${over.station === undefined ? station!.id : over.station}, ${noPreparation})`;
    const choices = async (where: ReturnType<typeof sql>) =>
      (
        await db.execute<{ station_id: string | null; no_preparation: number }>(
          sql`select station_id, no_preparation from routing_cell_periods where ${where}`,
        )
      ).rows;
    return { ...v, stationId: station!.id, cellId, periodId, choice, choices };
  }

  it("keeps one choice per routing cell and period, with a station or No preparation", async () => {
    const r = await routedPeriod();
    const evening = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${evening}, ${r.departmentId}, 'Evening', ${r.menuId})`);
    await db.execute(r.choice());
    await db.execute(r.choice({ period: evening, station: null }, 1));
    expect(await r.choices(sql`cell_id = ${r.cellId} order by no_preparation`)).toEqual([
      { station_id: r.stationId, no_preparation: 0 },
      { station_id: null, no_preparation: 1 },
    ]);
    const second = await captureError(() =>
      db.transaction((tx) => tx.execute(r.choice({ station: null }, 1))),
    );
    expect(isRefusal(second, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toContain(
      "routing_cell_periods.cell_id, routing_cell_periods.period_id",
    );
  });

  it.each([
    ["both a station and No preparation", "station", 1],
    ["neither a station nor No preparation", null, 0],
  ] as const)("refuses a period choice with %s", async (_, target, noPreparation) => {
    const r = await routedPeriod();
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(r.choice({ station: target === null ? null : r.stationId }, noPreparation)),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("routing_cell_periods_target_ck");
  });

  it("ties a period choice to its cell, its period's own department and a station", async () => {
    const r = await routedPeriod();
    const other = await venue();
    await refusal(r.choice({ department: other.departmentId }), "routing_cell_periods_period_fk");
    await refusal(r.choice({ period: randomUUID() }), "routing_cell_periods_period_fk");
    await refusal(r.choice({ cell: randomUUID() }), "routing_cell_periods_cell_fk");
    await refusal(r.choice({ station: randomUUID() }), "routing_cell_periods_station_fk");
    expect(await r.choices(sql`cell_id = ${r.cellId}`)).toEqual([]);
  });

  it("deletes a cell's period choices with the cell, and a period's with the period", async () => {
    const r = await routedPeriod();
    const kept = await routedPeriod();
    await db.execute(r.choice());
    await db.execute(kept.choice());
    await db.execute(sql`delete from routing_cells where id = ${r.cellId}`);
    expect(await r.choices(sql`cell_id = ${r.cellId}`)).toEqual([]);
    expect(await kept.choices(sql`cell_id = ${kept.cellId}`)).toHaveLength(1);
    const again = await routedPeriod();
    await db.execute(again.choice());
    await db.execute(sql`delete from menu_periods where id = ${again.periodId}`);
    expect(await again.choices(sql`period_id = ${again.periodId}`)).toEqual([]);
    expect(await kept.choices(sql`cell_id = ${kept.cellId}`)).toHaveLength(1);
  });

  async function namedDayZone() {
    const v = await venue();
    await db.execute(sql`insert into zone_service_policies (zone_id, location_id, department_id)
      values (${v.zoneId}, ${v.locationId}, ${v.departmentId})`);
    const dateId = randomUUID();
    await db.execute(sql`insert into special_dates (id, location_id, date, name)
      values (${dateId}, ${v.locationId}, '2026-12-25', 'Christmas')`);
    return { ...v, dateId };
  }

  it("removes the retired local-holiday table and named-day colour column", async () => {
    expect(
      (await db.execute(sql`select name from sqlite_master where name = 'local_holidays'`)).rows,
    ).toEqual([]);
    expect((await columnsOf("special_dates")).map((column) => column.name)).not.toContain("colour");
  });

  it.each([
    ["repeat", "2026-12-25", "12-24", "holiday", "special_dates_repeat_ck"],
    ["kind", "2026-12-25", null, "party", "special_dates_kind_ck"],
  ])(
    "refuses an invalid named-day %s at the database",
    async (_, date, repeatOn, kind, constraint) => {
      const v = await venue();
      const error = await captureError(() =>
        db.transaction((tx) =>
          tx.execute(sql`insert into special_dates
      (id, location_id, date, name, repeat_on, kind)
      values (${randomUUID()}, ${v.locationId}, ${date}, 'Named day', ${repeatOn}, ${kind})`),
        ),
      );
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toContain(constraint);
    },
  );

  it("refuses two repeating named days on the same month and day in one venue", async () => {
    const v = await venue();
    await db.execute(sql`insert into special_dates (id, location_id, date, name, repeat_on)
      values (${randomUUID()}, ${v.locationId}, '2026-12-25', 'First', '12-25')`);
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(sql`insert into special_dates
      (id, location_id, date, name, repeat_on)
      values (${randomUUID()}, ${v.locationId}, '2027-12-25', 'Second', '12-25')`),
      ),
    );
    expect(engineErrorMessage(error)).toContain(
      "UNIQUE constraint failed: special_dates.location_id, special_dates.repeat_on",
    );
  });

  it("allows the same repeating day in different venues and distinct one-off days in one venue", async () => {
    const first = await venue();
    const second = await venue();
    for (const locationId of [first.locationId, second.locationId])
      await db.execute(sql`insert into special_dates (id, location_id, date, name, repeat_on)
        values (${randomUUID()}, ${locationId}, '2026-12-25', 'Repeating', '12-25')`);
    for (const date of ["2026-12-26", "2026-12-27"])
      await db.execute(sql`insert into special_dates (id, location_id, date, name)
        values (${randomUUID()}, ${first.locationId}, ${date}, 'One-off')`);
    expect(
      (
        await db.execute(
          sql`select date, repeat_on from special_dates where location_id = ${first.locationId} order by date`,
        )
      ).rows,
    ).toEqual([
      { date: "2026-12-25", repeat_on: "12-25" },
      { date: "2026-12-26", repeat_on: null },
      { date: "2026-12-27", repeat_on: null },
    ]);
    expect(
      (
        await db.execute(
          sql`select date, repeat_on from special_dates where location_id = ${second.locationId}`,
        )
      ).rows,
    ).toEqual([{ date: "2026-12-25", repeat_on: "12-25" }]);
  });

  it("defaults a named day to the normal week without a repeat", async () => {
    const v = await namedDayZone();
    const [row] = await db.select().from(specialDates).where(eq(specialDates.id, v.dateId));
    expect(row).toMatchObject({ kind: "working_day", ownHours: false, repeatOn: null });
  });

  it("stores weekly and named-day closures independently", async () => {
    const v = await namedDayZone();
    await db.execute(sql`insert into zone_closed_times
      (id, zone_id, weekday, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, 0, '23:00:00', '06:00:00')`);
    await db.execute(sql`insert into zone_closed_times
      (id, zone_id, special_date_id, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, ${v.dateId}, '12:15:00', '14:45:00')`);
    expect(
      (
        await db.execute(sql`select weekday, special_date_id, starts_at, ends_at
      from zone_closed_times where zone_id = ${v.zoneId} order by starts_at`)
      ).rows,
    ).toEqual([
      { weekday: null, special_date_id: v.dateId, starts_at: "12:15:00", ends_at: "14:45:00" },
      { weekday: 0, special_date_id: null, starts_at: "23:00:00", ends_at: "06:00:00" },
    ]);
    const indexes = await indexesOf("zone_closed_times");
    expect(indexes.zone_closed_times_week_idx).toMatchObject({
      columns: ["zone_id", "weekday"],
      unique: false,
    });
    expect(indexes.zone_closed_times_date_idx).toMatchObject({
      columns: ["special_date_id", "zone_id"],
      unique: false,
    });
  });

  it.each([
    { weekday: 1, dated: true, start: "12:00:00", end: "14:00:00", check: "one_day" },
    { weekday: null, dated: false, start: "12:00:00", end: "14:00:00", check: "one_day" },
    { weekday: -1, dated: false, start: "12:00:00", end: "14:00:00", check: "weekday" },
    { weekday: 7, dated: false, start: "12:00:00", end: "14:00:00", check: "weekday" },
    { weekday: 1, dated: false, start: "12:10:00", end: "14:00:00", check: "step" },
    { weekday: 1, dated: false, start: "12:00:00", end: "14:10:00", check: "step" },
  ])("refuses a closure with $weekday/$dated/$start/$end ($check)", async (c) => {
    const v = await namedDayZone();
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(sql`
      insert into zone_closed_times (id, zone_id, weekday, special_date_id, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, ${c.weekday}, ${c.dated ? v.dateId : null},
        ${c.start}, ${c.end})`),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(`zone_closed_times_${c.check}_ck`);
  });

  it("refuses an unconfigured zone and a missing named day", async () => {
    const v = await namedDayZone();
    const other = await venue();
    await refusal(
      sql`insert into zone_closed_times (id, zone_id, weekday, starts_at, ends_at)
      values (${randomUUID()}, ${other.zoneId}, 1, '12:00:00', '14:00:00')`,
      "zone_closed_times_zone_fk",
    );
    await refusal(
      sql`insert into zone_closed_times
      (id, zone_id, special_date_id, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, ${randomUUID()}, '12:00:00', '14:00:00')`,
      "zone_closed_times_date_fk",
    );
  });

  it("deletes a named day's closures while keeping the zone's normal week", async () => {
    const v = await namedDayZone();
    await db.execute(sql`insert into zone_closed_times
      (id, zone_id, weekday, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, 1, '23:00:00', '06:00:00')`);
    await db.execute(sql`insert into zone_closed_times
      (id, zone_id, special_date_id, starts_at, ends_at)
      values (${randomUUID()}, ${v.zoneId}, ${v.dateId}, '12:00:00', '14:00:00')`);
    await db.execute(sql`delete from special_dates where id = ${v.dateId}`);
    expect(
      (
        await db.execute(sql`select weekday, special_date_id from zone_closed_times
      where zone_id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ weekday: 1, special_date_id: null }]);
  });

  it("retires the department and zone menu lists", async () => {
    const rows = await db.execute(sql`select name from sqlite_master where type = 'table'
      and name in ('department_menus', 'department_all_day_menus', 'zone_all_day_menus', 'zone_period_menus')`);
    expect(rows.rows).toEqual([]);
  });

  it("links a period directly to an existing catalogue without a separate membership row", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    expect(
      (await db.execute(sql`select menu_id from menu_periods where id = ${periodId}`)).rows,
    ).toEqual([{ menu_id: v.menuId }]);
    await refusal(
      sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${randomUUID()}, ${v.departmentId}, 'Missing', ${randomUUID()})`,
      "menu_periods_menu_fk",
    );
  });

  it("stores a full business day and ordinary quarter-hour ranges", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Open', ${v.menuId})`);
    const timetableId = randomUUID();
    await db.execute(sql`insert into menu_day_timetables (id, department_id, weekday)
      values (${timetableId}, ${v.departmentId}, 1)`);
    const slot = (start: string, end: string) => sql`insert into menu_slots
      (id, timetable_id, department_id, period_id, starts_at, ends_at)
      values (${randomUUID()}, ${timetableId}, ${v.departmentId}, ${periodId}, ${start}, ${end})`;
    for (const [start, end] of [
      ["06:00:00", "06:00:00"],
      ["12:15:00", "14:45:00"],
    ])
      await db.execute(slot(start!, end!));
    expect(
      (
        await db.execute(
          sql`select starts_at, ends_at from menu_slots where timetable_id = ${timetableId} order by starts_at`,
        )
      ).rows,
    ).toEqual([
      { starts_at: "06:00:00", ends_at: "06:00:00" },
      { starts_at: "12:15:00", ends_at: "14:45:00" },
    ]);
  });

  it("refuses either endpoint between quarter-hours", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Open', ${v.menuId})`);
    const timetableId = randomUUID();
    await db.execute(sql`insert into menu_day_timetables (id, department_id, weekday)
      values (${timetableId}, ${v.departmentId}, 1)`);
    const slot = (start: string, end: string) => sql`insert into menu_slots
      (id, timetable_id, department_id, period_id, starts_at, ends_at)
      values (${randomUUID()}, ${timetableId}, ${v.departmentId}, ${periodId}, ${start}, ${end})`;
    await db.execute(slot("12:15:00", "14:45:00"));
    for (const [start, end] of [
      ["12:10:00", "14:00:00"],
      ["12:00:00", "14:10:00"],
    ]) {
      const error = await captureError(() =>
        db.transaction((tx) => tx.execute(slot(start!, end!))),
      );
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toContain("menu_slots_step_ck");
    }
  });

  it("defaults period colour and removes staff menus when the period is deleted", async () => {
    const v = await venue();
    const periodId = randomUUID();
    const staff = await db.transaction((tx) => createCatalogue(tx, { name: "Staff drinks" }));
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    await db.execute(sql`insert into menu_period_staff_menus (period_id, department_id, menu_id)
      values (${periodId}, ${v.departmentId}, ${staff.id})`);
    expect(
      (await db.execute(sql`select colour from menu_periods where id = ${periodId}`)).rows,
    ).toEqual([{ colour: "grey" }]);
    expect(
      (
        await db.execute(sql`select display_order from menu_period_staff_menus
        where period_id = ${periodId}`)
      ).rows,
    ).toEqual([{ display_order: 0 }]);
    await db.execute(sql`delete from menu_periods where id = ${periodId}`);
    expect(
      (
        await db.execute(sql`select menu_id from menu_period_staff_menus
        where period_id = ${periodId}`)
      ).rows,
    ).toEqual([]);
  });

  it("ties a staff menu to its period's department and an existing catalogue", async () => {
    const v = await venue();
    const other = await venue();
    const periodId = randomUUID();
    const missing = "00000000-0000-4000-8000-00000000dead";
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    await refusal(
      sql`insert into menu_period_staff_menus (period_id, department_id, menu_id)
        values (${periodId}, ${other.departmentId}, ${other.menuId})`,
      "menu_period_staff_menus_period_fk",
    );
    await refusal(
      sql`insert into menu_period_staff_menus (period_id, department_id, menu_id)
        values (${periodId}, ${v.departmentId}, ${missing})`,
      "menu_period_staff_menus_menu_fk",
    );
    await db.execute(sql`insert into menu_period_staff_menus (period_id, department_id, menu_id)
      values (${periodId}, ${v.departmentId}, ${other.menuId})`);
    expect(
      (
        await db.execute(sql`select menu_id from menu_period_staff_menus
        where period_id = ${periodId}`)
      ).rows,
    ).toEqual([{ menu_id: other.menuId }]);
  });

  it("refuses a department, zone or menu that does not exist", async () => {
    const v = await venue();
    const missing = "00000000-0000-4000-8000-00000000dead";
    await refusal(
      // `id` and `created_at` are named, or the insert is refused as NOT NULL before the foreign
      // key is reached.
      sql`insert into departments (id, location_id, name, trading_name, created_at)
        values (${randomUUID()}, ${missing}, 'X', 'X', ${new Date().toISOString()})`,
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
      sql`insert into menu_periods (id, department_id, name, menu_id)
        values (${randomUUID()}, ${missing}, 'Lunch', ${v.menuId})`,
      "menu_periods_department_fk",
    );
    await refusal(
      sql`insert into menu_periods (id, department_id, name, menu_id)
        values (${randomUUID()}, ${v.departmentId}, 'Lunch', ${missing})`,
      "menu_periods_menu_fk",
    );
    await refusal(
      sql`insert into order_service_contexts
          (working_order_id, location_id, zone_id, department_id, service_mode)
        values (${missing}, ${v.locationId}, ${v.zoneId}, ${v.departmentId}, 'prepay')`,
      "order_service_contexts_order_fk",
    );
  });
});

describe("the service settings and kitchen notices tables refuse what their rules forbid", () => {
  it("holds at most one settings row, and it is row 1", async () => {
    await db.execute(sql`insert into service_settings (id) values (1)`);
    const second = await captureError(() =>
      db.execute(sql`insert into service_settings (id) values (2)`),
    );
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toContain("service_settings_singleton_ck");
    // The flag defaults ON in the database itself, so a row written by raw SQL gets it too.
    expect((await db.execute(sql`select edit_sent_lines from service_settings`)).rows).toEqual([
      { edit_sent_lines: 1 },
    ]);
  });

  it("refuses a notice kind outside the vocabulary, a zero quantity, a missing station and a table on a notice that is not a move", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: location!.id, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, location_id, order_number, opened_at)
      values (${orderId}, 'dashboard', ${location!.id}, 1, ${new Date().toISOString()})`);
    const notice = (kind: string, quantity: number, stationId: string) =>
      sql`insert into kitchen_notices
            (id, station_id, working_order_id, order_label, kind, line_name, quantity, created_at)
          values (${randomUUID()}, ${stationId}, ${orderId}, '#1', ${kind}, 'Burger', ${quantity},
                  ${new Date().toISOString()})`;

    // The control: a well-formed notice is accepted, and `was_started` defaults off.
    await db.execute(notice("void", 1000, station!.id));
    expect((await db.execute(sql`select was_started from kitchen_notices`)).rows).toEqual([
      { was_started: 0 },
    ]);

    const kind = await captureError(() => db.execute(notice("lost", 1000, station!.id)));
    expect(isRefusal(kind, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(kind)).toContain("kitchen_notices_kind_ck");
    const zero = await captureError(() => db.execute(notice("void", 0, station!.id)));
    expect(isRefusal(zero, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(zero)).toContain("kitchen_notices_quantity_ck");
    const missing = await captureError(() =>
      db.transaction((tx) => tx.execute(notice("void", 1000, randomUUID()))),
    );
    expect(isRefusal(missing, FOREIGN_KEY_VIOLATION)).toBe(true);

    const movedTo = (kind: string) =>
      sql`insert into kitchen_notices
            (id, station_id, working_order_id, order_label, kind, line_name, quantity, moved_to,
             created_at)
          values (${randomUUID()}, ${station!.id}, ${orderId}, '#1', ${kind}, 'Burger', 1000,
                  'Mesa 7', ${new Date().toISOString()})`;
    // The control: a move names the table it went to.
    await db.execute(movedTo("moved"));
    const onVoid = await captureError(() => db.execute(movedTo("void")));
    expect(isRefusal(onVoid, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(onVoid)).toContain("kitchen_notices_moved_to_ck");
  });

  it("refuses a direction outside added and removed, and a direction on a notice that is not a change", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: location!.id, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, location_id, order_number, opened_at)
      values (${orderId}, 'dashboard', ${location!.id}, 1, ${new Date().toISOString()})`);
    const notice = (kind: string, direction: string | null) =>
      sql`insert into kitchen_notices
            (id, station_id, working_order_id, order_label, kind, line_name, quantity, direction,
             created_at)
          values (${randomUUID()}, ${station!.id}, ${orderId}, '#1', ${kind}, 'Burger', 1000,
                  ${direction}, ${new Date().toISOString()})`;

    // The controls: a change says which way it went or says nothing, and any notice may have none.
    for (const [kind, direction] of [
      ["changed", "added"],
      ["changed", "removed"],
      ["changed", null],
      ["void", null],
      ["recalled", null],
      ["moved", null],
    ] as const) {
      await db.execute(notice(kind, direction));
    }
    expect(
      (await db.execute(sql`select kind, direction from kitchen_notices order by rowid`)).rows,
    ).toHaveLength(6);

    const sideways = await captureError(() => db.execute(notice("changed", "sideways")));
    expect(isRefusal(sideways, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(sideways)).toContain("kitchen_notices_direction_ck");
    for (const kind of ["void", "recalled", "moved"]) {
      const onOther = await captureError(() => db.execute(notice(kind, "added")));
      expect(isRefusal(onOther, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(onOther)).toContain("kitchen_notices_direction_kind_ck");
    }
  });

  it("refuses a cancelled extra on a notice that is not a change", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: location!.id, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, location_id, order_number, opened_at)
      values (${orderId}, 'dashboard', ${location!.id}, 1, ${new Date().toISOString()})`);
    const notice = (kind: string, cancelledExtra: string | null) =>
      sql`insert into kitchen_notices
            (id, station_id, working_order_id, order_label, kind, line_name, quantity,
             cancelled_extra, created_at)
          values (${randomUUID()}, ${station!.id}, ${orderId}, '#1', ${kind}, 'Pizza', 1000,
                  ${cancelledExtra}, ${new Date().toISOString()})`;

    // The controls: a change may name the extra taken off, and any notice may name none.
    for (const [kind, cancelledExtra] of [
      ["changed", "Olives"],
      ["changed", null],
      ["void", null],
      ["recalled", null],
      ["moved", null],
    ] as const) {
      await db.execute(notice(kind, cancelledExtra));
    }
    expect(
      (await db.execute(sql`select kind, cancelled_extra from kitchen_notices order by rowid`))
        .rows,
    ).toHaveLength(5);

    for (const kind of ["void", "recalled", "moved"]) {
      const onOther = await captureError(() => db.execute(notice(kind, "Olives")));
      expect(isRefusal(onOther, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(onOther)).toContain("kitchen_notices_cancelled_extra_kind_ck");
    }
  });
});

describe("the kitchen screen tables refuse what their rules forbid", () => {
  async function venue() {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({ name: "Venue", invoiceLocales: ["en"], operationDescription: "Hospitality" })
      .returning({ id: locations.id });
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: location!.id, name: "Grill" })
      .returning({ id: kitchenStations.id });
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId: brandLocationId(location!.id), name: "Terrace" })
      .returning({ id: floorZones.id });
    const [profile] = await db
      .insert(deviceProfiles)
      .values({ name: "Front till", formFactor: "till" })
      .returning({ id: deviceProfiles.id });
    const [device] = await db
      .insert(devices)
      .values({
        locationId: location!.id,
        deviceProfileId: profile!.id,
        label: "Till 1",
        tokenHash: "hash",
      })
      .returning({ id: devices.id });
    return {
      stationId: station!.id,
      zoneId: zone!.id,
      profileId: profile!.id,
      deviceId: device!.id,
    };
  }

  async function checkRefusal(statement: ReturnType<typeof sql>, constraint: string) {
    const error = await captureError(() => db.execute(statement));
    expect(isRefusal(error, CHECK_VIOLATION), constraint).toBe(true);
    expect(engineErrorMessage(error), constraint).toContain(constraint);
  }

  async function count(table: string): Promise<number> {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*) as n from ${sql.identifier(table)}`,
    );
    return rows.rows[0]!.n;
  }

  it("deletes a profile's kitchen screen rows with the profile", async () => {
    const { stationId, zoneId, profileId } = await venue();
    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values
      (${profileId}, 'station', 0, 0), (${profileId}, 'pass', 0, 0)`);
    await db.execute(sql`insert into device_profile_kitchen_screen_stations
      (device_profile_id, screen, station_id) values (${profileId}, 'station', ${stationId})`);
    await db.execute(sql`insert into device_profile_kitchen_screen_zones
      (device_profile_id, screen, zone_id) values (${profileId}, 'pass', ${zoneId})`);

    await db.execute(sql`delete from devices where device_profile_id = ${profileId}`);
    await db.execute(sql`delete from device_profiles where id = ${profileId}`);

    expect(await count("device_profile_kitchen_screens")).toBe(0);
    expect(await count("device_profile_kitchen_screen_stations")).toBe(0);
    expect(await count("device_profile_kitchen_screen_zones")).toBe(0);
  });

  it("refuses an unknown screen, every zone on a station screen and a zone on a station screen", async () => {
    const { zoneId, profileId, deviceId } = await venue();
    // The controls: every kind is accepted, and a pass screen may cover every zone.
    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values
      (${profileId}, 'station', 1, 0), (${profileId}, 'pass', 1, 1),
      (${profileId}, 'pass_monitor', 1, 1)`);
    await db.execute(sql`insert into device_kitchen_screens
      (device_id, screen, every_station, every_zone) values
      (${deviceId}, 'station', 1, 0), (${deviceId}, 'pass', 1, 1)`);
    await db.execute(sql`insert into device_profile_kitchen_screen_zones
      (device_profile_id, screen, zone_id) values (${profileId}, 'pass', ${zoneId})`);
    await db.execute(sql`insert into device_kitchen_screen_zones
      (device_id, screen, zone_id) values (${deviceId}, 'pass', ${zoneId})`);

    await db.execute(sql`delete from device_profile_kitchen_screens`);
    await db.execute(sql`delete from device_kitchen_screens`);

    await checkRefusal(
      sql`insert into device_profile_kitchen_screens (device_profile_id, screen, every_station, every_zone)
          values (${profileId}, 'floor', 1, 1)`,
      "device_profile_kitchen_screens_screen_ck",
    );
    await checkRefusal(
      sql`insert into device_kitchen_screens (device_id, screen, every_station, every_zone)
          values (${deviceId}, 'floor', 1, 1)`,
      "device_kitchen_screens_screen_ck",
    );
    await checkRefusal(
      sql`insert into device_profile_kitchen_screens (device_profile_id, screen, every_station, every_zone)
          values (${profileId}, 'station', 1, 1)`,
      "device_profile_kitchen_screens_station_zones_ck",
    );
    await checkRefusal(
      sql`insert into device_kitchen_screens (device_id, screen, every_station, every_zone)
          values (${deviceId}, 'station', 1, 1)`,
      "device_kitchen_screens_station_zones_ck",
    );

    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values (${profileId}, 'station', 1, 0)`);
    await db.execute(sql`insert into device_kitchen_screens
      (device_id, screen, every_station, every_zone) values (${deviceId}, 'station', 1, 0)`);
    await checkRefusal(
      sql`insert into device_profile_kitchen_screen_zones (device_profile_id, screen, zone_id)
          values (${profileId}, 'station', ${zoneId})`,
      "device_profile_kitchen_screen_zones_not_station_ck",
    );
    await checkRefusal(
      sql`insert into device_kitchen_screen_zones (device_id, screen, zone_id)
          values (${deviceId}, 'station', ${zoneId})`,
      "device_kitchen_screen_zones_not_station_ck",
    );
  });

  it("refuses a removal naming both a station and a zone", async () => {
    const { stationId, zoneId, deviceId } = await venue();
    const removal = (station: string | null, zone: string | null) =>
      sql`insert into device_kitchen_screen_removals (id, device_id, screen, station_id, zone_id, removed_at)
          values (${randomUUID()}, ${deviceId}, 'pass', ${station}, ${zone}, ${new Date().toISOString()})`;
    // The controls: a station, a zone, or neither (the kind itself).
    await db.execute(removal(stationId, null));
    await db.execute(removal(null, zoneId));
    await db.execute(removal(null, null));

    await checkRefusal(removal(stationId, zoneId), "device_kitchen_screen_removals_one_target_ck");
    await checkRefusal(
      sql`insert into device_kitchen_screen_removals (id, device_id, screen, removed_at)
          values (${randomUUID()}, ${deviceId}, 'floor', ${new Date().toISOString()})`,
      "device_kitchen_screen_removals_screen_ck",
    );
  });

  it("deletes a device's chosen stations and zones with its kitchen screen row and keeps its removals", async () => {
    const { stationId, zoneId, deviceId } = await venue();
    await db.execute(sql`insert into device_kitchen_screens
      (device_id, screen, every_station, every_zone) values
      (${deviceId}, 'station', 0, 0), (${deviceId}, 'pass', 0, 0)`);
    await db.execute(sql`insert into device_kitchen_screen_stations
      (device_id, screen, station_id) values (${deviceId}, 'station', ${stationId}),
      (${deviceId}, 'pass', ${stationId})`);
    await db.execute(sql`insert into device_kitchen_screen_zones
      (device_id, screen, zone_id) values (${deviceId}, 'pass', ${zoneId})`);
    await db.execute(sql`insert into device_kitchen_screen_removals
      (id, device_id, screen, station_id, removed_at)
      values (${randomUUID()}, ${deviceId}, 'pass', ${stationId}, ${new Date().toISOString()})`);

    await db.execute(sql`delete from device_kitchen_screens where screen = 'pass'`);

    expect((await db.execute(sql`select screen from device_kitchen_screen_stations`)).rows).toEqual(
      [{ screen: "station" }],
    );
    expect(await count("device_kitchen_screen_zones")).toBe(0);
    expect(await count("device_kitchen_screen_removals")).toBe(1);
  });

  it("refuses to delete a device that still holds a kitchen screen or a removal", async () => {
    const { deviceId } = await venue();
    await db.execute(sql`insert into device_kitchen_screens
      (device_id, screen, every_station, every_zone) values (${deviceId}, 'station', 1, 0)`);
    const held = await captureError(() =>
      db.transaction((tx) => tx.execute(sql`delete from devices where id = ${deviceId}`)),
    );
    expect(isRefusal(held, FOREIGN_KEY_VIOLATION)).toBe(true);

    await db.execute(sql`delete from device_kitchen_screens`);
    await db.execute(sql`insert into device_kitchen_screen_removals (id, device_id, screen, removed_at)
      values (${randomUUID()}, ${deviceId}, 'pass', ${new Date().toISOString()})`);
    const removed = await captureError(() =>
      db.transaction((tx) => tx.execute(sql`delete from devices where id = ${deviceId}`)),
    );
    expect(isRefusal(removed, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
