import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  menus,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  departments,
  engineErrorMessage,
  floorZones,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  kitchenStations,
  UNIQUE_VIOLATION,
  withTransaction,
} from "../../index.js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";
import {
  seedDevice,
  seedDeviceProfiles,
  seedTaxpayer,
  seedVenue,
  seedZone,
} from "../../testing/seed.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const TABLES = [
  "departments",
  "floor_zones",
  "device_profile_service_access",
  "device_profile_zones",
  "routing_cells",
  "routing_cell_periods",
  "working_line_contexts",
  "kitchen_notices",
  "device_profile_kitchen_screens",
  "device_profile_kitchen_screen_stations",
  "device_profile_kitchen_screen_zones",
  "seasons",
  "special_days",
  "special_day_dates",
  "opening_hours",
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
      statement: sql`update floor_zones set service_mode = 'prepay'`,
      column: "service_mode",
    },
  ])("refuses a write to the retired $column column", async ({ statement, column }) => {
    const refused = await captureError(() => withTransaction(db, (tx) => tx.execute(statement)));
    expect(engineErrorMessage(refused)).toContain(`no such column: ${column}`);
  });
});

describe("the late-send storage", () => {
  type Column = { name: string; notnull: number; dflt_value: string | null };
  async function column(table: string, name: string): Promise<Column | undefined> {
    const rows = await db.execute<Column>(
      sql`select name, "notnull", dflt_value from pragma_table_info(${table}) where name = ${name}`,
    );
    return rows.rows[0];
  }

  it("a department and a line context carry the late-send columns", async () => {
    expect(await column("departments", "late_send_needs_manager")).toEqual({
      name: "late_send_needs_manager",
      notnull: 1,
      dflt_value: "false",
    });
    expect(await column("working_line_contexts", "late_period_name")).toEqual({
      name: "late_period_name",
      notnull: 0,
      dflt_value: null,
    });
    expect(await column("working_line_contexts", "late_confirmed_by")).toEqual({
      name: "late_confirmed_by",
      notnull: 0,
      dflt_value: null,
    });
  });
});

describe("the venue-service tables carry no taxpayer column", () => {
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
    expect((await columnsOf("special_day_dates")).length).toBeGreaterThan(0);
  });

  it("leaves none of the named-day hours tables behind", async () => {
    const left = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name in ('special_dates',
        'menu_day_timetables', 'menu_slots', 'zone_closed_times')`,
    );
    expect(left.rows).toEqual([]);
  });

  it("the venue keeps no period extensions", async () => {
    const left = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'period_extensions'`,
    );
    expect(left.rows).toEqual([]);
  });

  it("leaves no profile station or watcher list behind", async () => {
    const left = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where name in ('device_profile_stations',
        'device_profile_watchers')`,
    );
    expect(left.rows).toEqual([]);
  });

  it("keeps service context on the bill without a separate table", async () => {
    expect(await columnsOf("order_service_contexts")).toEqual([]);
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
        foreignKeys: [
          "(receipt_logo_image_id) -> media_images(id) on delete restrict",
          "(transfer_desk_profile_id) -> device_profiles(id) on delete set null",
        ],
      },
      floor_zones: {
        primaryKey: ["id"],
        foreignKeys: [
          "(department_id) -> departments(id)",
          "(today_set_id) -> floor_plan_sets(id)",
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
      routing_cells: {
        primaryKey: ["id"],
        foreignKeys: [
          "(category_id) -> categories(id) on delete cascade",
          "(product_id) -> products(id)",
          "(station_id) -> kitchen_stations(id)",
          "(zone_id) -> floor_zones(id)",
        ],
      },
      routing_cell_periods: {
        primaryKey: ["id"],
        foreignKeys: [
          "(cell_id) -> routing_cells(id) on delete cascade",
          "(period_id) -> menu_periods(id) on delete cascade",
          "(station_id) -> kitchen_stations(id)",
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
      kitchen_notices: {
        primaryKey: ["id"],
        foreignKeys: [
          "(station_id) -> kitchen_stations(id)",
          "(ticket_item_id) -> ticket_items(id) on delete set null",
          "(working_order_id) -> working_orders(id) on delete cascade",
        ],
      },
      device_profile_kitchen_screens: {
        primaryKey: ["device_profile_id"],
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
      seasons: {
        primaryKey: ["id"],
        foreignKeys: [],
      },
      special_days: {
        primaryKey: ["id"],
        foreignKeys: [],
      },
      special_day_dates: {
        primaryKey: ["id"],
        foreignKeys: ["(special_day_id) -> special_days(id) on delete cascade"],
      },
      opening_hours: {
        primaryKey: ["id"],
        foreignKeys: [
          "(department_id) -> departments(id) on delete cascade",
          "(period_id, department_id) -> menu_periods(id, department_id)",
          "(season_id) -> seasons(id) on delete cascade",
          "(special_day_date_id) -> special_day_dates(id) on delete cascade",
          "(zone_id) -> floor_zones(id) on delete cascade",
        ],
      },
    });
  });

  it("rebuilds every index without the taxpayer", async () => {
    const defs: Record<string, { columns: string[]; sql: string; unique: boolean }> = {};
    for (const table of TABLES) Object.assign(defs, await indexesOf(table));
    expect(Object.keys(defs).filter((name) => name.includes("taxpayer"))).toEqual([]);
    expect(Object.values(defs).filter((def) => def.sql.includes("taxpayer"))).toEqual([]);
    const columns = (name: string) => defs[name]?.columns;
    // No PRAGMA reports a partial index's `WHERE`, so it is read off the stored statement.
    const predicate = (name: string) => / WHERE (.*)$/.exec(defs[name]?.sql ?? "")?.[1];
    expect(columns("kitchen_notices_open_idx")).toEqual(["station_id", "created_at"]);
    expect(predicate("kitchen_notices_open_idx")).toBe(
      `"kitchen_notices"."acknowledged_at" is null`,
    );
    expect(columns("departments_name_key")).toEqual(["name"]);
    expect(columns("departments_one_default_key")).toEqual(["is_default"]);
    expect(predicate("departments_one_default_key")).toBe(`"departments"."is_default"`);
    expect(columns("floor_zones_one_counter_default_key")).toEqual(["is_counter_default"]);
    expect(predicate("floor_zones_one_counter_default_key")).toBe(
      `"floor_zones"."is_counter_default" = 1 and "floor_zones"."active" = 1`,
    );
    for (const name of [
      "departments_name_key",
      "departments_one_default_key",
      "floor_zones_one_counter_default_key",
    ]) {
      expect(defs[name]?.unique, name).toBe(true);
    }
  });
});

/** A menu's own row: the foreign keys below need nothing else of it. */
async function insertMenu(name: string): Promise<{ id: string }> {
  const [menu] = await db.insert(menus).values({ name }).returning({ id: menus.id });
  return menu!;
}

describe("the venue-service foreign keys refuse a missing target", () => {
  async function venue() {
    await seedTaxpayer(db);
    const fixtureId = randomUUID();
    await seedVenueSettings(db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    await seedBusinessDay(db, {});
    const [department] = await db
      .insert(departments)
      .values({
        name: `Bar ${fixtureId}`,
        tradingName: "Bar",
      })
      .returning({ id: departments.id });
    const [zone] = await db
      .insert(floorZones)
      .values({ name: `Terrace ${fixtureId}`, departmentId: department!.id })
      .returning({ id: floorZones.id });
    const menu = await insertMenu(`Drinks ${fixtureId}`);
    return {
      zoneId: zone!.id,
      departmentId: department!.id,
      menuId: menu.id,
    };
  }

  async function orderStartPolicies() {
    const v = await venue();
    return v;
  }

  it("order start defaults to counter for a department and null for a zone", async () => {
    const v = await orderStartPolicies();
    expect(
      (
        await db.execute(sql`select order_start from departments
      where id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ order_start: "counter" }]);
    expect(
      (
        await db.execute(sql`select order_start from floor_zones
      where id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ order_start: null }]);
  });

  it("order start stores table and counter independently on each policy", async () => {
    const v = await orderStartPolicies();
    await db.execute(
      sql`update departments set order_start = 'table' where id = ${v.departmentId}`,
    );
    await db.execute(sql`update floor_zones set order_start = 'counter' where id = ${v.zoneId}`);
    expect(
      (
        await db.execute(sql`select p.order_start as department_start, q.order_start as zone_start
      from departments p join floor_zones q on q.id = ${v.zoneId}
      where p.id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ department_start: "table", zone_start: "counter" }]);
    await db.execute(sql`update departments set order_start = 'counter'
      where id = ${v.departmentId}`);
    await db.execute(sql`update floor_zones set order_start = 'table'
      where id = ${v.zoneId}`);
    expect(
      (
        await db.execute(sql`select p.order_start as department_start, q.order_start as zone_start
      from departments p join floor_zones q on q.id = ${v.zoneId}
      where p.id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ department_start: "counter", zone_start: "table" }]);
    await db.execute(sql`update floor_zones set order_start = null where id = ${v.zoneId}`);
    expect(
      (
        await db.execute(sql`select order_start from floor_zones
      where id = ${v.zoneId}`)
      ).rows,
    ).toEqual([{ order_start: null }]);
  });

  it.each(["department", "zone"] as const)(
    "order start rejects an unknown value on %s policy insert and update",
    async (policy) => {
      const v = await orderStartPolicies();
      const insert =
        policy === "department"
          ? sql`insert into departments (id, name, trading_name, created_at, order_start)
            values ('invalid', 'Invalid', 'Invalid', '2026-11-15T00:00:00Z', 'tab')`
          : sql`update floor_zones set order_start = 'tab' where id = ${v.zoneId}`;
      const insertError = await captureError(() => withTransaction(db, (tx) => tx.execute(insert)));
      expect(isRefusal(insertError, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(insertError)).toContain(
        policy === "department" ? "departments_order_start_ck" : "floor_zones_order_start_ck",
      );
      await db.execute(
        policy === "department"
          ? sql`update departments set order_start = 'table' where id = ${v.departmentId}`
          : sql`update floor_zones set order_start = 'counter' where id = ${v.zoneId}`,
      );
      const update =
        policy === "department"
          ? sql`update departments set order_start = 'tab' where id = ${v.departmentId}`
          : sql`update floor_zones set order_start = 'tab' where id = ${v.zoneId}`;
      const updateError = await captureError(() => withTransaction(db, (tx) => tx.execute(update)));
      expect(isRefusal(updateError, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(updateError)).toContain(
        policy === "department" ? "departments_order_start_ck" : "floor_zones_order_start_ck",
      );
      expect(
        (
          await db.execute(
            policy === "department"
              ? sql`select order_start from departments where id = ${v.departmentId}`
              : sql`select order_start from floor_zones where id = ${v.zoneId}`,
          )
        ).rows,
      ).toEqual([{ order_start: policy === "department" ? "table" : "counter" }]);
    },
  );

  it("order start refuses explicit department null instead of applying its default", async () => {
    const v = await orderStartPolicies();
    const error = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.execute(sql`update departments set order_start = null where id = ${v.departmentId}`),
      ),
    );
    expect(engineErrorMessage(error)).toContain(
      "NOT NULL constraint failed: departments.order_start",
    );
    expect(
      (
        await db.execute(sql`select order_start from departments
      where id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ order_start: "counter" }]);
  });

  it("a department sells to eat in, starting eaten in, unless told otherwise", async () => {
    const v = await orderStartPolicies();
    expect(
      (
        await db.execute(sql`select dining, dining_starts_as from departments
      where id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ dining: "eat_in", dining_starts_as: "eat_in" }]);
    await db.execute(sql`update departments
      set dining = 'till_choice', dining_starts_as = 'takeaway'
      where id = ${v.departmentId}`);
    expect(
      (
        await db.execute(sql`select dining, dining_starts_as from departments
      where id = ${v.departmentId}`)
      ).rows,
    ).toEqual([{ dining: "till_choice", dining_starts_as: "takeaway" }]);
  });

  it.each([
    ["dining", "sometimes", "departments_dining_ck"],
    ["dining_starts_as", "sometimes", "departments_dining_starts_as_ck"],
    ["dining_starts_as", "till_choice", "departments_dining_starts_as_ck"],
    ["dining", null, "NOT NULL constraint failed: departments.dining"],
    ["dining_starts_as", null, "NOT NULL constraint failed: departments.dining_starts_as"],
  ] as const)("refuses %s = %j", async (column, value, message) => {
    const v = await orderStartPolicies();
    const error = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.execute(sql`update departments set ${sql.identifier(column)} = ${value}
          where id = ${v.departmentId}`),
      ),
    );
    if (value !== null) expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain(message);
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

  async function routedPeriod() {
    const v = await venue();
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: `Grill ${v.zoneId}` })
      .returning({ id: kitchenStations.id });
    const cellId = randomUUID();
    await db.execute(sql`insert into routing_cells (id, zone_id, station_id)
      values (${cellId}, ${v.zoneId}, ${station!.id})`);
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const choice = (
      over: { cell?: string; period?: string; station?: string | null } = {},
      noPreparation = 0,
    ) => sql`insert into routing_cell_periods
      (id, cell_id, period_id, station_id, no_preparation)
      values (${randomUUID()}, ${over.cell ?? cellId}, ${over.period ?? periodId},
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

  it("ties a period choice to its cell, its period and a station", async () => {
    const r = await routedPeriod();

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

  it("removes the retired local-holiday table", async () => {
    expect(
      (await db.execute(sql`select name from sqlite_master where name = 'local_holidays'`)).rows,
    ).toEqual([]);
  });

  it("retires the department and zone menu lists", async () => {
    const rows = await db.execute(sql`select name from sqlite_master where type = 'table'
      and name in ('department_menus', 'department_all_day_menus', 'zone_all_day_menus', 'zone_period_menus')`);
    expect(rows.rows).toEqual([]);
  });

  it("links a period directly to an existing menu without a separate membership row", async () => {
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

  it("refuses staff menus that are not a JSON array", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'List shape', ${v.menuId})`);
    for (const value of ["{}", '"x"', "nope"]) {
      const error = await captureError(() =>
        db.execute(sql`update menu_periods set staff_menu_ids = ${value} where id = ${periodId}`),
      );
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toBe(
        "CHECK constraint failed: menu_periods_staff_menu_ids_ck",
      );
    }
    for (const value of ["[]", '["staff"]']) {
      await db.execute(
        sql`update menu_periods set staff_menu_ids = ${value} where id = ${periodId}`,
      );
      expect(
        (await db.execute(sql`select staff_menu_ids from menu_periods where id = ${periodId}`))
          .rows,
      ).toEqual([{ staff_menu_ids: value }]);
    }
  });

  it("defaults period colour and staff menus, and removes its list with the period", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    expect(
      (await db.execute(sql`select colour, staff_menu_ids from menu_periods where id=${periodId}`))
        .rows,
    ).toEqual([{ colour: "grey", staff_menu_ids: "[]" }]);
    await db.execute(
      sql`update menu_periods set staff_menu_ids=${JSON.stringify([v.menuId])} where id=${periodId}`,
    );
    await db.execute(sql`delete from menu_periods where id=${periodId}`);
    expect(
      (await db.execute(sql`select staff_menu_ids from menu_periods where id=${periodId}`)).rows,
    ).toEqual([]);
  });

  it("refuses a department, zone or menu that does not exist", async () => {
    const v = await venue();
    const missing = "00000000-0000-4000-8000-00000000dead";

    await refusal(
      sql`update floor_zones set department_id = ${missing} where id = ${v.zoneId}`,
      "floor_zones_department_fk",
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
  });

  it("a season row written without a colour takes grey, and the table takes any text there", async () => {
    await venue();
    const plain = randomUUID();
    await db.execute(sql`insert into seasons (id, name, starts_on)
      values (${plain}, 'Summer', '06-01')`);
    expect((await db.execute(sql`select colour from seasons where id = ${plain}`)).rows).toEqual([
      { colour: "grey" },
    ]);
    const mauve = randomUUID();
    await db.execute(sql`insert into seasons (id, name, starts_on, colour)
      values (${mauve}, 'Winter', '12-01', 'mauve')`);
    expect((await db.execute(sql`select colour from seasons where id = ${mauve}`)).rows).toEqual([
      { colour: "mauve" },
    ]);
  });

  it("a season's week rows go with the season, and a special day's dates with the special day", async () => {
    const v = await venue();
    const periodId = randomUUID();
    await db.execute(sql`insert into menu_periods (id, department_id, name, menu_id)
      values (${periodId}, ${v.departmentId}, 'Lunch', ${v.menuId})`);
    const seasonId = randomUUID();
    await db.execute(sql`insert into seasons (id, name, starts_on)
      values (${seasonId}, 'Summer', '06-01')`);
    const weekDayId = randomUUID();
    await db.execute(sql`insert into opening_hours
        (id, season_id, weekday, department_id, kind, period_id, starts_at, ends_at)
      values (${weekDayId}, ${seasonId}, 6, ${v.departmentId}, 'period', ${periodId}, '12:00:00', '16:00:00')`);
    const zoneDayId = randomUUID();
    await db.execute(sql`insert into opening_hours (id, zone_id, season_id, weekday, kind, starts_at, ends_at)
      values (${zoneDayId}, ${v.zoneId}, ${seasonId}, 6, 'closed', '15:00:00', '17:00:00')`);
    expect(
      (await db.execute(sql`select id from opening_hours where id = ${zoneDayId}`)).rows,
    ).toHaveLength(1);
    await db.execute(sql`delete from seasons where id = ${seasonId}`);
    expect(
      (await db.execute(sql`select id from opening_hours where id = ${zoneDayId}`)).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select id from opening_hours where id = ${weekDayId}`)).rows,
    ).toEqual([]);

    const specialDayId = randomUUID();
    await db.execute(sql`insert into special_days (id, name)
      values (${specialDayId}, 'Fiesta')`);
    const dateId = randomUUID();
    await db.execute(sql`insert into special_day_dates (id, special_day_id, date)
      values (${dateId}, ${specialDayId}, '2026-08-15')`);
    const dateDayId = randomUUID();
    await db.execute(sql`insert into opening_hours
        (id, special_day_date_id, department_id, kind, period_id, starts_at, ends_at)
      values (${dateDayId}, ${dateId}, ${v.departmentId}, 'closed', null, '00:00:00', '23:45:00')`);
    await db.execute(sql`delete from special_days where id = ${specialDayId}`);
    expect(
      (await db.execute(sql`select id from special_day_dates where id = ${dateId}`)).rows,
    ).toEqual([]);
    expect(
      (await db.execute(sql`select id from opening_hours where id = ${dateDayId}`)).rows,
    ).toEqual([]);

    const otherDayId = randomUUID();
    await db.execute(sql`insert into special_days (id, name)
      values (${otherDayId}, 'Feria')`);
    await db.execute(sql`insert into special_day_dates (id, special_day_id, date)
      values (${randomUUID()}, ${otherDayId}, '2026-09-08')`);
    const error = await captureError(() =>
      db.transaction((tx) =>
        tx.execute(sql`insert into special_day_dates (id, special_day_id, date)
          values (${randomUUID()}, ${otherDayId}, '2026-09-08')`),
      ),
    );
    expect(engineErrorMessage(error)).toContain("UNIQUE constraint failed: special_day_dates.date");
  });
});

describe("the kitchen notices table refuses what its rules forbid", () => {
  it("the venue keeps no service settings of its own", async () => {
    expect(
      (
        await db.execute(
          sql`select name from sqlite_master where type = 'table' and name = 'service_settings'`,
        )
      ).rows,
    ).toEqual([]);
  });

  it("refuses a notice kind outside the vocabulary, a zero quantity, a missing station and a table on a notice that is not a move", async () => {
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, order_number, opened_at, dining)
      values (${orderId}, 'dashboard', 1, ${new Date().toISOString()}, 'eat_in')`);
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
                  'Table 7', ${new Date().toISOString()})`;
    // The control: a move names the table it went to.
    await db.execute(movedTo("moved"));
    const onVoid = await captureError(() => db.execute(movedTo("void")));
    expect(isRefusal(onVoid, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(onVoid)).toContain("kitchen_notices_moved_to_ck");
  });

  it("refuses a direction outside added and removed, and a direction on a notice that is not a change", async () => {
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, order_number, opened_at, dining)
      values (${orderId}, 'dashboard', 1, ${new Date().toISOString()}, 'eat_in')`);
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
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.execute(sql`
      insert into working_orders (id, source, order_number, opened_at, dining)
      values (${orderId}, 'dashboard', 1, ${new Date().toISOString()}, 'eat_in')`);
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

describe("department policy columns", () => {
  async function department() {
    const [row] = await db
      .insert(departments)
      .values({ name: "Deli", tradingName: "Deli" })
      .returning();
    return row!.id;
  }

  it("a new department holds its default sale rules without a side row", async () => {
    const id = await department();
    expect(
      (
        await db.execute(sql`select order_start, paid_when, collection_number,
      print_trading_name, transfer_desk_profile_id from departments where id = ${id}`)
      ).rows,
    ).toEqual([
      {
        order_start: "counter",
        paid_when: "prepay",
        collection_number: "none",
        print_trading_name: 1,
        transfer_desk_profile_id: null,
      },
    ]);
  });

  it.each([
    ["order_start", "tab", "table", "counter", "departments_order_start_ck"],
    ["paid_when", "later", "ticket_then_pay", "prepay", "departments_paid_when_ck"],
    ["collection_number", "ticket", "numbered", "none", "departments_collection_number_ck"],
  ])(
    "refuses an invalid %s and accepts both allowed values",
    async (column, invalid, first, second, constraint) => {
      const id = await department();
      const field = sql.identifier(column!);
      const error = await captureError(() =>
        withTransaction(db, (tx) =>
          tx.execute(sql`update departments set ${field} = ${invalid} where id = ${id}`),
        ),
      );
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toContain(constraint!);
      for (const value of [first, second]) {
        await db.execute(sql`update departments set ${field} = ${value} where id = ${id}`);
        expect(
          (await db.execute(sql`select ${field} as value from departments where id = ${id}`)).rows,
        ).toEqual([{ value }]);
      }
    },
  );

  it("refuses a transfer profile that does not exist", async () => {
    const id = await department();
    const error = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.execute(
          sql`update departments set transfer_desk_profile_id = ${randomUUID()} where id = ${id}`,
        ),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("FOREIGN KEY constraint failed");
  });

  it("deleting a transfer profile clears the desk and keeps the department", async () => {
    const id = await department();
    const [profile] = await seedDeviceProfiles(db, { name: "Front till", formFactor: "till" });
    await db.execute(
      sql`update departments set transfer_desk_profile_id = ${profile!.id} where id = ${id}`,
    );
    expect(
      (await db.execute(sql`select transfer_desk_profile_id from departments where id = ${id}`))
        .rows,
    ).toEqual([{ transfer_desk_profile_id: profile!.id }]);
    await db.execute(sql`delete from device_profiles where id = ${profile!.id}`);
    expect(
      (
        await db.execute(
          sql`select name, transfer_desk_profile_id from departments where id = ${id}`,
        )
      ).rows,
    ).toEqual([{ name: "Deli", transfer_desk_profile_id: null }]);
  });
});

describe("the kitchen screen tables refuse what their rules forbid", () => {
  async function venue() {
    await seedVenue(db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Grill" })
      .returning({ id: kitchenStations.id });
    const zone = await seedZone(db, { name: "Terrace" });
    const [profile] = await seedDeviceProfiles(db, { name: "Front till", formFactor: "till" });
    const device = await seedDevice(db, { profileId: profile!.id, label: "Till 1" });
    return {
      stationId: station!.id,
      zoneId: zone!.id,
      profileId: profile!.id,
      deviceId: device.deviceId,
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

  it("refuses a second screen kind on a profile at the database boundary", async () => {
    const { profileId } = await venue();
    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values (${profileId}, 'station', 1, 0)`);
    const error = await captureError(() =>
      db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values (${profileId}, 'pass', 1, 1)`),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("device_profile_kitchen_screens.device_profile_id");
  });

  it("deletes a profile's kitchen screen rows with the profile", async () => {
    const { stationId, zoneId, profileId } = await venue();
    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values
      (${profileId}, 'pass', 0, 0)`);
    await db.execute(sql`insert into device_profile_kitchen_screen_stations
      (device_profile_id, screen, station_id) values (${profileId}, 'pass', ${stationId})`);
    await db.execute(sql`insert into device_profile_kitchen_screen_zones
      (device_profile_id, screen, zone_id) values (${profileId}, 'pass', ${zoneId})`);

    await db.execute(sql`delete from devices where device_profile_id = ${profileId}`);
    await db.execute(sql`delete from device_profiles where id = ${profileId}`);

    expect(await count("device_profile_kitchen_screens")).toBe(0);
    expect(await count("device_profile_kitchen_screen_stations")).toBe(0);
    expect(await count("device_profile_kitchen_screen_zones")).toBe(0);
  });

  it("refuses an unknown screen, every zone on a station screen and a zone on a station screen", async () => {
    const { zoneId, profileId } = await venue();
    // The controls: every kind is accepted, and a pass screen may cover every zone.
    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values
      (${profileId}, 'pass', 1, 1)`);
    await db.execute(sql`insert into device_profile_kitchen_screen_zones
      (device_profile_id, screen, zone_id) values (${profileId}, 'pass', ${zoneId})`);

    await db.execute(sql`delete from device_profile_kitchen_screens`);

    await checkRefusal(
      sql`insert into device_profile_kitchen_screens (device_profile_id, screen, every_station, every_zone)
          values (${profileId}, 'floor', 1, 1)`,
      "device_profile_kitchen_screens_screen_ck",
    );
    await checkRefusal(
      sql`insert into device_profile_kitchen_screens (device_profile_id, screen, every_station, every_zone)
          values (${profileId}, 'station', 1, 1)`,
      "device_profile_kitchen_screens_station_zones_ck",
    );

    await db.execute(sql`insert into device_profile_kitchen_screens
      (device_profile_id, screen, every_station, every_zone) values (${profileId}, 'station', 1, 0)`);
    await checkRefusal(
      sql`insert into device_profile_kitchen_screen_zones (device_profile_id, screen, zone_id)
          values (${profileId}, 'station', ${zoneId})`,
      "device_profile_kitchen_screen_zones_not_station_ck",
    );
  });
});

describe("single-venue defaults", () => {
  const single = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("allows one default department and multiple ordinary departments", async () => {
    await seedVenue(single.db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    async function add(name: string, isDefault: boolean) {
      return single.db.insert(departments).values({ name, tradingName: name, isDefault });
    }
    await add("Main", true);
    const error = await captureError(() => add("Other default", true));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("departments.is_default");
    await add("Ordinary one", false);
    await add("Ordinary two", false);
    expect(await single.db.select().from(departments)).toHaveLength(3);
  });
  it("allows one counter-default zone and multiple ordinary zones", async () => {
    await seedVenue(single.db, {
      name: "Venue",
      invoiceLocales: ["en"],
    });
    const [department] = await single.db
      .insert(departments)
      .values({ name: "Main", tradingName: "Main" })
      .returning();
    async function add(name: string, isCounterDefault: boolean) {
      return single.db
        .insert(floorZones)
        .values({ name, departmentId: department!.id, isCounterDefault });
    }
    await add("Counter", true);
    const error = await captureError(() => add("Other counter", true));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("floor_zones.is_counter_default");
    await add("Ordinary one", false);
    await add("Ordinary two", false);
    expect(await single.db.select().from(floorZones)).toHaveLength(3);
  });
});
