import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS, createCatalogue } from "@waitron/catalogue";
import { captureError, CORE_MIGRATIONS, pgErrorCode, pgErrorMessage } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";

// PGlite applies the same migration files PostgreSQL does; these cases read the catalog and a few
// foreign-key refusals, with no role or concurrency dimension.
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

describe("the venue-service migration set carries no tenant column", () => {
  it("has no tenant_id column on any table in the set", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id'
        and table_name in (${sql.join(
          TABLES.map((table) => sql`${table}`),
          sql`, `,
        )})`);
    expect(rows.rows).toEqual([]);
  });

  it("keys and links every table on its own columns and each parent's primary key", async () => {
    const rows = await db.execute<{ name: string; def: string }>(sql`
      select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
      where contype in ('p', 'u', 'f')
        and conrelid::regclass::text in (${sql.join(
          TABLES.map((table) => sql`${table}`),
          sql`, `,
        )})
      order by conname`);
    expect(Object.fromEntries(rows.rows.map((row) => [row.name, row.def]))).toEqual({
      department_hours_department_fk:
        "FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE",
      department_hours_interval_key: "UNIQUE (department_id, weekday, opens_at, closes_at)",
      department_hours_pkey: "PRIMARY KEY (id)",
      departments_location_fk: "FOREIGN KEY (location_id) REFERENCES locations(id)",
      departments_location_name_key: "UNIQUE (location_id, name)",
      departments_pkey: "PRIMARY KEY (id)",
      device_zone_defaults_device_fk: "FOREIGN KEY (device_id) REFERENCES devices(id)",
      device_zone_defaults_pk: "PRIMARY KEY (device_id)",
      device_zone_defaults_zone_fk: "FOREIGN KEY (zone_id) REFERENCES floor_zones(id)",
      order_service_contexts_department_fk:
        "FOREIGN KEY (department_id) REFERENCES departments(id)",
      order_service_contexts_order_fk:
        "FOREIGN KEY (working_order_id) REFERENCES working_orders(id) ON DELETE CASCADE",
      order_service_contexts_pk: "PRIMARY KEY (working_order_id)",
      order_service_contexts_zone_fk: "FOREIGN KEY (zone_id) REFERENCES floor_zones(id)",
      preparation_routes_category_fk: "FOREIGN KEY (category_id) REFERENCES categories(id)",
      preparation_routes_location_fk: "FOREIGN KEY (location_id) REFERENCES locations(id)",
      preparation_routes_pkey: "PRIMARY KEY (id)",
      preparation_routes_product_fk: "FOREIGN KEY (product_id) REFERENCES products(id)",
      preparation_routes_station_fk: "FOREIGN KEY (station_id) REFERENCES kitchen_stations(id)",
      preparation_routes_zone_fk: "FOREIGN KEY (zone_id) REFERENCES floor_zones(id)",
      working_line_contexts_line_fk:
        "FOREIGN KEY (working_order_line_id) REFERENCES working_order_lines(id) ON DELETE CASCADE",
      working_line_contexts_menu_item_fk: "FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)",
      working_line_contexts_pk: "PRIMARY KEY (working_order_line_id)",
      zone_menus_menu_fk: "FOREIGN KEY (menu_id) REFERENCES catalogues(id)",
      zone_menus_pk: "PRIMARY KEY (zone_id, menu_id)",
      zone_menus_zone_fk:
        "FOREIGN KEY (zone_id) REFERENCES zone_service_policies(zone_id) ON DELETE CASCADE",
      zone_service_policies_default_allowed_fk:
        "FOREIGN KEY (zone_id, default_menu_id) REFERENCES zone_menus(zone_id, menu_id) DEFERRABLE INITIALLY DEFERRED",
      zone_service_policies_default_menu_fk:
        "FOREIGN KEY (default_menu_id) REFERENCES catalogues(id)",
      zone_service_policies_department_fk: "FOREIGN KEY (department_id) REFERENCES departments(id)",
      zone_service_policies_location_fk: "FOREIGN KEY (location_id) REFERENCES locations(id)",
      zone_service_policies_pk: "PRIMARY KEY (zone_id)",
      zone_service_policies_zone_fk: "FOREIGN KEY (zone_id) REFERENCES floor_zones(id)",
    });
  });

  it("rebuilds every index without the tenant", async () => {
    const rows = await db.execute<{ name: string; def: string }>(sql`
      select indexname as name, indexdef as def from pg_indexes
      where schemaname = 'public' and tablename in (${sql.join(
        TABLES.map((table) => sql`${table}`),
        sql`, `,
      )})
      order by indexname`);
    const defs = Object.fromEntries(rows.rows.map((row) => [row.name, row.def]));
    expect(Object.values(defs).filter((def) => def.includes("tenant"))).toEqual([]);
    const columns = (name: string) => /USING btree \(([^)]*)\)/.exec(defs[name] ?? "")?.[1];
    const predicate = (name: string) => / WHERE (.*)$/.exec(defs[name] ?? "")?.[1];
    expect(columns("preparation_routes_lookup_idx")).toBe(
      "location_id, zone_id, product_id, category_id",
    );
    expect(columns("zone_menus_order_idx")).toBe("zone_id, display_order");
    expect(columns("preparation_routes_zone_product_key")).toBe("location_id, zone_id, product_id");
    expect(predicate("preparation_routes_zone_product_key")).toBe(
      "((zone_id IS NOT NULL) AND (product_id IS NOT NULL))",
    );
    expect(columns("preparation_routes_zone_category_key")).toBe(
      "location_id, zone_id, category_id",
    );
    expect(predicate("preparation_routes_zone_category_key")).toBe(
      "((zone_id IS NOT NULL) AND (category_id IS NOT NULL))",
    );
    expect(columns("preparation_routes_venue_product_key")).toBe("location_id, product_id");
    expect(predicate("preparation_routes_venue_product_key")).toBe(
      "((zone_id IS NULL) AND (product_id IS NOT NULL))",
    );
    expect(columns("preparation_routes_venue_category_key")).toBe("location_id, category_id");
    expect(predicate("preparation_routes_venue_category_key")).toBe(
      "((zone_id IS NULL) AND (category_id IS NOT NULL))",
    );
    expect(columns("departments_one_default_per_location_key")).toBe("location_id");
    expect(predicate("departments_one_default_per_location_key")).toBe("is_default");
    expect(columns("zone_service_policies_one_counter_default_key")).toBe("location_id");
    expect(predicate("zone_service_policies_one_counter_default_key")).toBe("is_counter_default");
    for (const name of [
      "preparation_routes_zone_product_key",
      "preparation_routes_zone_category_key",
      "preparation_routes_venue_product_key",
      "preparation_routes_venue_category_key",
      "departments_one_default_per_location_key",
      "zone_service_policies_one_counter_default_key",
    ]) {
      expect(defs[name], name).toMatch(/^CREATE UNIQUE INDEX /);
    }
  });
});

describe("the venue-service foreign keys refuse a missing target", () => {
  async function venue() {
    await seedTenant(db);
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description) values ('Venue', array['en'], 'Hospitality') returning id`);
    const locationId = location.rows[0]!.id;
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (location_id, name) values (${locationId}, 'Terrace') returning id`);
    const department = await db.execute<{ id: string }>(sql`
      insert into departments (location_id, name, trading_name, default_service_mode)
      values (${locationId}, 'Bar', 'Bar', 'prepay') returning id`);
    const menu = await db.transaction((tx) => createCatalogue(tx, { name: "Drinks" }));
    return {
      locationId,
      zoneId: zone.rows[0]!.id,
      departmentId: department.rows[0]!.id,
      menuId: menu.id,
    };
  }

  async function refusal(statement: ReturnType<typeof sql>, constraint: string) {
    const error = await captureError(() => db.transaction((tx) => tx.execute(statement)));
    expect(pgErrorCode(error), constraint).toBe("23503");
    expect(pgErrorMessage(error)).toContain(constraint);
  }

  it("refuses a department, zone or menu that does not exist", async () => {
    const v = await venue();
    const missing = "00000000-0000-4000-8000-00000000dead";
    await refusal(
      sql`insert into departments (location_id, name, trading_name, default_service_mode)
        values (${missing}, 'X', 'X', 'prepay')`,
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
      sql`insert into department_hours (department_id, weekday, opens_at, closes_at)
        values (${missing}, 1, '09:00', '17:00')`,
      "department_hours_department_fk",
    );
    await refusal(
      sql`insert into order_service_contexts
          (working_order_id, location_id, zone_id, department_id, service_mode)
        values (${missing}, ${v.locationId}, ${v.zoneId}, ${v.departmentId}, 'prepay')`,
      "order_service_contexts_order_fk",
    );
  });

  it("refuses a default menu the zone does not allow, checked at commit", async () => {
    const v = await venue();
    await db.execute(sql`
      insert into zone_service_policies (location_id, zone_id, department_id)
      values (${v.locationId}, ${v.zoneId}, ${v.departmentId})`);
    await refusal(
      sql`update zone_service_policies set default_menu_id = ${v.menuId} where zone_id = ${v.zoneId}`,
      "zone_service_policies_default_allowed_fk",
    );
    await db.transaction(async (tx) => {
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
  });
});
