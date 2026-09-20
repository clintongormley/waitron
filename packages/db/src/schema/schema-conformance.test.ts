// Every drizzle table declaration in this package, compared with the database the core migrations
// actually build: table name, column names and SQL types, nullability, primary keys, foreign keys
// and unique constraints.
//
// Nothing else in the suite reads a declaration and checks it against the schema, so a declaration
// that drifts from its migration — a renamed column, a foreign key pointing at the wrong table, a
// money column declared as free text — is invisible until a query fails at runtime.
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deployment } from "./deployment.js";
import * as barrel from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

// `deployment` is deliberately not re-exported from the barrel (see its own file), so it is named
// here rather than discovered.
const declared: PgTable[] = [
  ...Object.values(barrel).filter((value): value is PgTable => is(value, PgTable)),
  deployment,
];

// Foreign keys the migrations create that no declaration here carries. Each one is hand-written in
// SQL for a stated reason at the column — most often that declaring it would make this file import
// the file holding the target table and close an import cycle (`locations.catalogue_id` states it
// at `tenants.ts`), and for a self-reference (`working_order_lines.parent_line_id`,
// `sale_lines.parent_line_id`, `dining_tables.tab_id`) that the table cannot reference itself while
// it is being declared. They are listed rather than ignored so that dropping one from a migration
// fails this test.
const SQL_ONLY_FOREIGN_KEYS: Readonly<Record<string, readonly string[]>> = {
  categories: ["station_id -> kitchen_stations(id)"],
  device_profiles: ["canvas_id -> canvases(id)"],
  devices: [
    "device_profile_id -> device_profiles(id)",
    "receipt_printer_id -> printers(id)",
    "station_id -> kitchen_stations(id)",
    "till_id -> tills(id)",
  ],
  dining_tables: ["tab_id -> working_orders(id)", "zone_id -> floor_zones(id)"],
  drawer_opens: ["sale_id -> sales(id)", "till_id -> tills(id)"],
  location_catalogues: ["catalogue_id -> catalogues(id)", "location_id -> locations(id)"],
  locations: ["catalogue_id -> catalogues(id)"],
  print_jobs: ["claimed_by -> print_agents(id)", "printer_id -> printers(id)"],
  products: ["course_id -> kitchen_courses(id)", "station_id -> kitchen_stations(id)"],
  sale_lines: ["parent_line_id -> sale_lines(id)"],
  station_printers: ["printer_id -> printers(id)", "station_id -> kitchen_stations(id)"],
  ticket_items: [
    "course_id -> kitchen_courses(id)",
    "node_id -> nodes(id)",
    "station_id -> kitchen_stations(id)",
    "working_order_line_id -> working_order_lines(id)",
  ],
  tills: ["receipt_printer_id -> printers(id)"],
  working_order_lines: [
    "course_id -> kitchen_courses(id)",
    "parent_line_id -> working_order_lines(id)",
  ],
  working_orders: ["delivery_table_id -> dining_tables(id)"],
};

// Unique indexes and check constraints the migrations create that no declaration here carries —
// each written by hand in SQL, the file named beside it. Listed rather than ignored so that
// dropping one from a migration fails this test.
const SQL_ONLY_INDEXES: Readonly<Record<string, readonly string[]>> = {
  incidents: ["unique incidents_open_dedup(till_id,code,sale_id)"], // 0001_db_baseline_sql.sql
  kitchen_stations: ["unique kitchen_stations_default_key(location_id)"], // 0001, re-made by 0034
  printers: ["unique printers_local_key_key(location_id,local_key)"], // 0032/0034
  tills: ["unique tills_tenant_location_name_key(location_id,name)"], // 0006, re-made by 0034
};

const SQL_ONLY_CHECKS: Readonly<Record<string, readonly string[]>> = {
  deployment: ["deployment_environment_ck"], // 0001_db_baseline_sql.sql
  kitchen_stations: ["kitchen_stations_thresholds_ordered"], // 0001_db_baseline_sql.sql
  printers: ["printers_transport_fields_ck"], // 0001, widened by 0014
};

// A column whose stored type the declaration cannot spell. `deployment.fence_lsn` is `pg_lsn` in
// `drizzle/0001_db_baseline_sql.sql` and `label()` here because drizzle has no pg_lsn type, which
// its own comment in `deployment.ts` states is safe only because that table is outside the schema
// barrel.
const STORED_TYPE: Readonly<Record<string, string>> = { "deployment.fence_lsn": "pg_lsn" };

interface TableShape {
  readonly name: string;
  readonly columns: Record<string, { type: string; notNull: boolean }>;
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly uniques: readonly string[];
  readonly indexes: readonly string[];
  readonly checks: readonly string[];
}

/** `numeric(12, 2)` and `numeric(12,2)` are the same type; `time` is `time without time zone`. */
function normaliseType(type: string): string {
  return type
    .toLowerCase()
    .replaceAll(", ", ",")
    .replace(/^time$/, "time without time zone");
}

function fromDeclaration(table: PgTable): TableShape {
  const config = getTableConfig(table);
  const columns: Record<string, { type: string; notNull: boolean }> = {};
  for (const column of config.columns)
    columns[column.name] = {
      type: STORED_TYPE[`${config.name}.${column.name}`] ?? normaliseType(column.getSQLType()),
      notNull: column.notNull,
    };
  const primaryKey = [
    ...config.columns.filter((column) => column.primary).map((column) => column.name),
    ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
  ].sort();
  const foreignKeys = [
    ...(SQL_ONLY_FOREIGN_KEYS[config.name] ?? []),
    ...config.foreignKeys.map((key) => {
      const reference = key.reference();
      const target = getTableConfig(reference.foreignTable);
      return `${reference.columns.map((column) => column.name).join(",")} -> ${target.name}(${reference.foreignColumns.map((column) => column.name).join(",")})`;
    }),
  ].sort();
  const uniques = [
    ...config.columns.filter((column) => column.isUnique).map((column) => column.name),
    ...config.uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name).join(","),
    ),
  ].sort();
  const indexes = [
    ...(SQL_ONLY_INDEXES[config.name] ?? []),
    ...config.indexes.map((index) => {
      const { name, unique, columns: parts } = index.config;
      // A part is either one of the table's columns or a raw SQL expression; an expression index
      // is compared by name and uniqueness alone, because the two sides render it differently.
      const columnNames = parts.map((part) =>
        "name" in part ? String(part.name) : "(expression)",
      );
      return `${unique === true ? "unique " : ""}${name}(${columnNames.join(",")})`;
    }),
  ].sort();
  const checks = [
    ...(SQL_ONLY_CHECKS[config.name] ?? []),
    ...config.checks.map((check) => check.name),
  ].sort();
  return { name: config.name, columns, primaryKey, foreignKeys, uniques, indexes, checks };
}

interface ColumnRow {
  name: string;
  type: string;
  not_null: boolean;
}

interface ConstraintRow {
  kind: string;
  name: string;
  columns: string[];
  foreign_table: string | null;
  foreign_columns: string[] | null;
}

interface IndexRow {
  name: string;
  is_unique: boolean;
  columns: (string | null)[];
}

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function fromDatabase(db: Database, name: string): Promise<TableShape> {
  const columnRows = await rows<ColumnRow>(
    db,
    sql`
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null
      from pg_attribute a
      where a.attrelid = ${`public.${name}`}::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum
    `,
  );
  const constraintRows = await rows<ConstraintRow>(
    db,
    sql`
      select
        c.contype as kind,
        c.conname as name,
        (
          select array_agg(a.attname order by k.ord)
          from unnest(c.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) as columns,
        cf.relname as foreign_table,
        (
          select array_agg(a.attname order by k.ord)
          from unnest(c.confkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
        ) as foreign_columns
      from pg_constraint c
      left join pg_class cf on cf.oid = c.confrelid
      where c.conrelid = ${`public.${name}`}::regclass and c.contype in ('p', 'f', 'u', 'c')
    `,
  );
  const columns: Record<string, { type: string; notNull: boolean }> = {};
  for (const column of columnRows)
    columns[column.name] = { type: normaliseType(column.type), notNull: column.not_null };
  const primaryKey = constraintRows
    .filter((row) => row.kind === "p")
    .flatMap((row) => row.columns)
    .sort();
  const foreignKeys = constraintRows
    .filter((row) => row.kind === "f")
    .map(
      (row) =>
        `${row.columns.join(",")} -> ${row.foreign_table}(${(row.foreign_columns ?? []).join(",")})`,
    )
    .sort();
  const uniques = constraintRows
    .filter((row) => row.kind === "u")
    .map((row) => row.columns.join(","))
    .sort();
  const checks = constraintRows
    .filter((row) => row.kind === "c")
    .map((row) => row.name)
    .sort();
  // Indexes PostgreSQL builds for a primary key or a unique constraint are that constraint's, and
  // are compared above; only the ones a declaration asks for by name are listed here.
  const indexRows = await rows<IndexRow>(
    db,
    sql`
      select
        i.relname as name,
        ix.indisunique as is_unique,
        (
          select array_agg(
            case when k.attnum = 0 then null else (
              select a.attname from pg_attribute a where a.attrelid = ix.indrelid and a.attnum = k.attnum
            ) end
            order by k.ord
          )
          from unnest(ix.indkey) with ordinality k(attnum, ord)
        ) as columns
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      where ix.indrelid = ${`public.${name}`}::regclass
        and not ix.indisprimary
        and not exists (select 1 from pg_constraint c where c.conindid = ix.indexrelid)
    `,
  );
  const indexes = indexRows
    .map(
      (row) =>
        `${row.is_unique ? "unique " : ""}${row.name}(${row.columns.map((column) => column ?? "(expression)").join(",")})`,
    )
    .sort();
  return { name, columns, primaryKey, foreignKeys, uniques, indexes, checks };
}

describe("the drizzle schema matches the database the core migrations build", () => {
  it("declares at least every core table", () => {
    expect(declared.length).toBeGreaterThan(30);
  });

  it.each(declared.map((table) => [getTableConfig(table).name, table] as const))(
    "%s",
    async (_name, table) => {
      const shape = fromDeclaration(table);
      await expect(fromDatabase(suite.db, shape.name)).resolves.toEqual(shape);
    },
  );
});
