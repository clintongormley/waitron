// Every drizzle table and enum declaration in this package, compared with the database the core
// migrations actually build: table name, column names and SQL types, nullability, column defaults,
// primary keys, foreign keys with the actions they take on delete and on update, unique
// constraints, indexes, check-constraint names, and each enum's labels in order. Plus one rule the
// database cannot state: every column spells its own name out rather than letting drizzle derive
// one from the property key.
//
// Nothing else in the suite reads a declaration and checks it against the schema, so a declaration
// that drifts from its migration — a renamed column, a foreign key pointing at the wrong table, a
// money column declared as free text — is invisible until a query fails at runtime.
import { is, SQL, sql } from "drizzle-orm";
import {
  getTableConfig,
  isPgEnum,
  PgDialect,
  type PgColumn,
  PgTable,
  type PgEnum,
} from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";
import { deployment } from "./deployment.js";
import * as barrel from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

/** Every table a module exports, plus `deployment`, which is deliberately not in the barrel. */
function tablesIn(module: Record<string, unknown>, extra: PgTable): PgTable[] {
  return [
    ...Object.values<unknown>(module).filter((value): value is PgTable => is(value, PgTable)),
    extra,
  ];
}

function enumsIn(module: Record<string, unknown>): PgEnum<[string, ...string[]]>[] {
  return Object.values<unknown>(module).filter((value): value is PgEnum<[string, ...string[]]> =>
    isPgEnum(value),
  );
}

// Reloads the declarations INSIDE the calling test. The comparisons below would read the same
// values without this; what it changes is whether the MUTATION run ever runs them. A drizzle
// declaration executes when its module loads, not while a test runs, so Stryker's `perTest`
// coverage credits each of those mutants to whatever test happened to be running when the module
// first loaded — in a whole-package run, some unrelated file's test, which is then the only test
// the mutant is run against. Receipt: mutation run 35498146363 on this branch, shard 7, where the
// surviving mutant in `src/schema/printers.ts` is covered-by six cases in
// `src/testing/harness.docker.test.ts` and by none of the cases here, and the file scored 5.8%.
// Re-importing in the test body puts the declaration's execution inside the test.
async function reload(): Promise<{ tables: PgTable[]; enums: PgEnum<[string, ...string[]]>[] }> {
  vi.resetModules();
  const fresh: Record<string, unknown> = await import("./index.js");
  const { deployment: freshDeployment } = await import("./deployment.js");
  return { tables: tablesIn(fresh, freshDeployment), enums: enumsIn(fresh) };
}

const declared: PgTable[] = tablesIn(barrel, deployment);

// Foreign keys the migrations create that no declaration here carries. Each one is hand-written in
// SQL for a stated reason at the column — most often that declaring it would make this file import
// the file holding the target table and close an import cycle (`locations.catalogue_id` states it
// at `tenants.ts`), and for a self-reference (`working_order_lines.parent_line_id`,
// `sale_lines.parent_line_id`, `dining_tables.tab_id`) that the table cannot reference itself while
// it is being declared. They are listed rather than ignored so that dropping one from a migration
// fails this test.
const SQL_ONLY_FOREIGN_KEYS: Readonly<Record<string, readonly string[]>> = {
  categories: ["station_id -> kitchen_stations(id) on delete no action on update no action"],
  device_profiles: ["canvas_id -> canvases(id) on delete restrict on update no action"],
  devices: [
    "device_profile_id -> device_profiles(id) on delete restrict on update no action",
    "receipt_printer_id -> printers(id) on delete restrict on update no action",
    "station_id -> kitchen_stations(id) on delete no action on update no action",
    "till_id -> tills(id) on delete restrict on update no action",
  ],
  dining_tables: [
    "tab_id -> working_orders(id) on delete no action on update no action",
    "zone_id -> floor_zones(id) on delete no action on update no action",
  ],
  drawer_opens: [
    "sale_id -> sales(id) on delete no action on update no action",
    "till_id -> tills(id) on delete no action on update no action",
  ],
  location_catalogues: [
    "catalogue_id -> catalogues(id) on delete no action on update no action",
    "location_id -> locations(id) on delete no action on update no action",
  ],
  locations: ["catalogue_id -> catalogues(id) on delete no action on update no action"],
  print_jobs: [
    "claimed_by -> print_agents(id) on delete no action on update no action",
    "printer_id -> printers(id) on delete no action on update no action",
  ],
  products: [
    "course_id -> kitchen_courses(id) on delete no action on update no action",
    "station_id -> kitchen_stations(id) on delete no action on update no action",
  ],
  sale_lines: ["parent_line_id -> sale_lines(id) on delete no action on update no action"],
  station_printers: [
    "printer_id -> printers(id) on delete no action on update no action",
    "station_id -> kitchen_stations(id) on delete no action on update no action",
  ],
  ticket_items: [
    "course_id -> kitchen_courses(id) on delete no action on update no action",
    "node_id -> nodes(id) on delete no action on update no action",
    "station_id -> kitchen_stations(id) on delete no action on update no action",
    "working_order_line_id -> working_order_lines(id) on delete cascade on update no action",
  ],
  tills: ["receipt_printer_id -> printers(id) on delete no action on update no action"],
  working_order_lines: [
    "course_id -> kitchen_courses(id) on delete no action on update no action",
    "parent_line_id -> working_order_lines(id) on delete no action on update no action",
  ],
  working_orders: [
    "delivery_table_id -> dining_tables(id) on delete no action on update no action",
  ],
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

const dialect = new PgDialect();

/**
 * The default the declaration asks the DATABASE for, in the words the database renders it back in
 * — `undefined` where it asks for none. A default drizzle computes in JavaScript (`$defaultFn`) is
 * one the database does not hold, so it reads as none here.
 */
function declaredDefault(column: PgColumn): string | undefined {
  if (!column.hasDefault || column.defaultFn !== undefined) return undefined;
  const value = column.default;
  if (value === undefined) return undefined;
  if (is(value, SQL)) return normaliseDefault(dialect.sqlToQuery(value).sql);
  if (typeof value === "object") return normaliseDefault(JSON.stringify(value));
  return normaliseDefault(String(value));
}

/** Drops the type cast PostgreSQL renders on a stored default, and the quotes around a literal. */
function normaliseDefault(expression: string): string {
  const withoutCast = expression.replace(/::[a-z0-9_ ".]+(\[\])?$/i, "");
  return withoutCast.replace(/^'([\s\S]*)'$/, "$1");
}

interface TableShape {
  readonly name: string;
  readonly columns: Record<string, { type: string; notNull: boolean; default?: string }>;
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
  const columns: Record<string, { type: string; notNull: boolean; default?: string }> = {};
  for (const column of config.columns) {
    const value = declaredDefault(column);
    columns[column.name] = {
      type: STORED_TYPE[`${config.name}.${column.name}`] ?? normaliseType(column.getSQLType()),
      notNull: column.notNull,
      ...(value === undefined ? {} : { default: value }),
    };
  }
  const primaryKey = [
    ...config.columns.filter((column) => column.primary).map((column) => column.name),
    ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
  ].sort();
  const foreignKeys = [
    ...(SQL_ONLY_FOREIGN_KEYS[config.name] ?? []),
    ...config.foreignKeys.map((key) => {
      const reference = key.reference();
      const target = getTableConfig(reference.foreignTable);
      // The two referential actions are part of the key: dropping `onDelete: "restrict"` turns a
      // refused delete into one PostgreSQL performs. A key that declares neither gets the SQL
      // default, which is `no action`.
      const actions = `on delete ${key.onDelete ?? "no action"} on update ${key.onUpdate ?? "no action"}`;
      return `${reference.columns.map((column) => column.name).join(",")} -> ${target.name}(${reference.foreignColumns.map((column) => column.name).join(",")}) ${actions}`;
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
  column_default: string | null;
}

interface ConstraintRow {
  kind: string;
  name: string;
  columns: string[];
  foreign_table: string | null;
  foreign_columns: string[] | null;
  delete_action: string | null;
  update_action: string | null;
}

/** `pg_constraint.confdeltype` / `confupdtype`, in the words drizzle uses for the same actions. */
const REFERENTIAL_ACTION: Readonly<Record<string, string>> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

interface IndexRow {
  name: string;
  is_unique: boolean;
  columns: (string | null)[];
}

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** A schema nothing else uses, where a copy of a table can be given the declared constraints. */
const SCRATCH_SCHEMA = "schema_conformance_scratch";

/**
 * Every check constraint on one table, keyed by name, in the words `pg_get_constraintdef` renders
 * it back in.
 */
async function checkExpressionsIn(
  db: Database,
  schema: string,
  name: string,
): Promise<Record<string, string>> {
  const found = await rows<{ name: string; def: string }>(
    db,
    sql`
      select c.conname as name, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      where c.conrelid = ${`${schema}."${name}"`}::regclass and c.contype = 'c'
    `,
  );
  return Object.fromEntries(found.map((row) => [row.name, row.def]));
}

/**
 * The check expressions the declaration asks for, put through the SAME renderer the database side
 * is read with: a bare copy of the table in a scratch schema, given the declared constraints, read
 * back with `pg_get_constraintdef`. Comparing the two rendered forms compares what the expressions
 * MEAN — PostgreSQL rewrites `in (…)` into `= ANY (ARRAY[…])` and `between` into a pair of
 * comparisons — where comparing the text as typed would differ on wording alone.
 */
async function declaredCheckExpressions(
  db: Database,
  table: PgTable,
): Promise<Record<string, string>> {
  const config = getTableConfig(table);
  if (config.checks.length === 0) return {};
  await db.execute(sql.raw(`create schema ${SCRATCH_SCHEMA}`));
  try {
    const copy = `${SCRATCH_SCHEMA}."${config.name}"`;
    await db.execute(sql.raw(`create table ${copy} (like public."${config.name}")`));
    for (const check of config.checks) {
      const expression = dialect.sqlToQuery(check.value).sql;
      await db.execute(
        sql.raw(`alter table ${copy} add constraint "${check.name}" check (${expression})`),
      );
    }
    return await checkExpressionsIn(db, SCRATCH_SCHEMA, config.name);
  } finally {
    await db.execute(sql.raw(`drop schema ${SCRATCH_SCHEMA} cascade`));
  }
}

async function fromDatabase(db: Database, name: string): Promise<TableShape> {
  const columnRows = await rows<ColumnRow>(
    db,
    sql`
      select
        a.attname as name,
        format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as not_null,
        pg_get_expr(d.adbin, d.adrelid) as column_default
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
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
        c.confdeltype as delete_action,
        c.confupdtype as update_action,
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
  const columns: Record<string, { type: string; notNull: boolean; default?: string }> = {};
  for (const column of columnRows)
    columns[column.name] = {
      type: normaliseType(column.type),
      notNull: column.not_null,
      ...(column.column_default === null
        ? {}
        : { default: normaliseDefault(column.column_default) }),
    };
  const primaryKey = constraintRows
    .filter((row) => row.kind === "p")
    .flatMap((row) => row.columns)
    .sort();
  const foreignKeys = constraintRows
    .filter((row) => row.kind === "f")
    .map(
      (row) =>
        `${row.columns.join(",")} -> ${row.foreign_table}(${(row.foreign_columns ?? []).join(",")}) on delete ${REFERENTIAL_ACTION[row.delete_action ?? "a"]} on update ${REFERENTIAL_ACTION[row.update_action ?? "a"]}`,
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

const declaredEnums: PgEnum<[string, ...string[]]>[] = enumsIn(barrel);

interface EnumRow {
  label: string;
}

describe("the drizzle enum declarations match the database the core migrations build", () => {
  it("declares at least one enum", () => {
    expect(declaredEnums.length).toBeGreaterThan(0);
  });

  it.each(declaredEnums.map((declared, index) => [declared.enumName, index] as const))(
    "%s",
    async (_name, index) => {
      const { enums } = await reload();
      expect(enums).toHaveLength(declaredEnums.length);
      const declared = enums[index];
      // Labels in declaration order, which is the order PostgreSQL stores and sorts them in. A
      // label that differs, is missing, or has moved is a value the application can write and the
      // database refuses, or the other way round.
      const labels = await rows<EnumRow>(
        suite.db,
        sql`
          select e.enumlabel as label
          from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = ${declared.enumName}
          order by e.enumsortorder
        `,
      );
      expect(labels.map((row) => row.label)).toEqual([...declared.enumValues]);
    },
  );
});

describe("the drizzle schema matches the database the core migrations build", () => {
  it("declares at least every core table", () => {
    expect(declared.length).toBeGreaterThan(30);
  });

  it.each(declared.map((table, index) => [getTableConfig(table).name, index] as const))(
    "%s",
    async (_name, index) => {
      const { tables } = await reload();
      expect(tables).toHaveLength(declared.length);
      // Every column spells its database name out. Left empty, drizzle derives the name from the
      // property key instead, which reads as a declared name while declaring none — and a derived
      // name would move if the `casing` option ever changed.
      const derived = getTableConfig(tables[index]).columns.filter((column) => column.keyAsName);
      expect(derived.map((column) => column.name)).toEqual([]);
      const shape = fromDeclaration(tables[index]);
      await expect(fromDatabase(suite.db, shape.name)).resolves.toEqual(shape);
      // The shape above compares check constraints by NAME. This compares what each declared one
      // SAYS with what the migration built, so a permitted value dropped from a list, a bound
      // moved, or a comparison flipped is caught rather than passing on a matching name.
      const expressions = await declaredCheckExpressions(suite.db, tables[index]);
      const built = await checkExpressionsIn(suite.db, "public", shape.name);
      expect(expressions).toEqual(
        Object.fromEntries(Object.keys(expressions).map((name) => [name, built[name]])),
      );
    },
  );
});
