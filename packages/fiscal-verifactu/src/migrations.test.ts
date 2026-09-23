import {
  CORE_MIGRATIONS,
  CHECK_VIOLATION,
  captureError,
  isRefusal,
  newId,
  runMigrations,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Database } from "@waitron/db";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";

/**
 * **Four cases went with the storage switch, and each is named here rather than left as a silent
 * deletion.**
 *
 *  - `fails when fiscal runs before core` expected `runMigrations(db, FISCAL_MIGRATIONS)` on an
 *    empty database to be refused `42P01` and to leave no fiscal tables behind. This engine
 *    ACCEPTS it: a `CREATE TABLE` whose foreign key names a table that does not exist is created
 *    anyway, and only the first INSERT is refused, with `no such table: main.<parent>` (measured
 *    on node v26.7.0 against `node:sqlite`, one table referencing a missing one). So the ordering
 *    mistake is no longer caught at migrate time and no longer leaves the database clean — it
 *    surfaces at the first write instead. Nothing here holds that property now; what decides the
 *    order in the product is `orderedMigrationSets` (`packages/module/src/module.ts`), and
 *    `scripts/module-graph-honesty.test.ts` reads the declared dependency edges.
 *  - the three `envios drainer enumeration` cases asked a PostgreSQL catalogue
 *    (`has_function_privilege`, `pg_proc`) about `envios_work_due(timestamptz)`, a SQL function
 *    this branch's regeneration dropped and this engine could not hold anyway. What the two
 *    THRESHOLD cases pinned is live again, through `drain()` rather than through SQL, in
 *    `drain.containment.test.ts`'s "the due-work gate's thresholds". The grant case has no
 *    successor and is not owed one: there are no roles on this engine.
 */
const pg = useVenueDb({
  migrations: [],
  setup: async (db) => {
    for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
  },
});
afterEach(async () => {
  await pg.db.execute(sql`delete from envios`);
});

/**
 * Every table in the database, drizzle's per-package journals included and SQLite's own excluded.
 *
 * `information_schema.tables` reached this engine as `no such table:
 * information_schema.tables`; `sqlite_master` is the catalogue here, the way
 * `packages/db/src/testing/venue-db.ts` and `scripts/append-only-triggers.test.ts` both read it.
 * The journals stay IN the list because the `table_schema = 'public'` filter they replace
 * included them — there is one namespace on this engine and nothing to filter by.
 */
async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' order by 1`,
  );
  return rows.rows.map((r) => r.name);
}

/**
 * How many rows a package's migration journal holds.
 *
 * `count(*)::int` was casting away the BigInt the PostgreSQL driver returned. Measured on node
 * v26.7.0 against `node:sqlite`: `select count(*) as n` comes back as a JavaScript `number`, so
 * nothing needs casting — and the `::` the cast needed reaches this engine as `unrecognized
 * token: ":"`.
 */
async function journalCount(db: Database, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

/**
 * A table's columns as `{ <column>: "NO" | "YES" }`, the two words `information_schema.columns`
 * answered `is_nullable` with.
 *
 * That view reached this engine as `no such table: information_schema.columns`;
 * `pragma_table_info` answers the same question, the way
 * `packages/db/src/schema/sales.test.ts`'s own `columnsOf` helper reads it. Its `notnull` is 1 or
 * 0, translated back here so the expected values below are unchanged. The table name is BOUND:
 * measured on node v26.7.0, `pragma_table_info(?)` accepts a bind parameter and returns the same
 * rows as the literal form.
 */
async function nullabilityOf(db: Database, table: string): Promise<Record<string, string>> {
  const { rows } = await db.execute<{ name: string; notnull: number }>(
    sql`select name, "notnull" from pragma_table_info(${table})`,
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.notnull === 1 ? "NO" : "YES"]));
}

describe("migration composition across packages", () => {
  it("applies the full manifest (core → … → fiscal) against an empty database", async () => {
    const db = pg.db;

    const names = await tableNames(db);
    // Core's tables and the module's tables coexist in one schema, created by independent migration
    // sets. The whole manifest is migrated in production order (see ../test/migrations.ts) so fiscal
    // lands on top of its `core` dependency.
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
  });

  it("keeps the two journals separate", async () => {
    const db = pg.db;

    // Two tables, both non-empty. One shared journal would make each package's next `generate`
    // read the other's entries as unknown and re-apply its own set from zero.
    expect(await journalCount(db, CORE_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(await journalCount(db, FISCAL_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(CORE_MIGRATIONS.migrationsTable).not.toBe(FISCAL_MIGRATIONS.migrationsTable);
    expect(CORE_MIGRATIONS.migrationsFolder).not.toBe(FISCAL_MIGRATIONS.migrationsFolder);
  });

  it("is idempotent — running both sets twice is a no-op", async () => {
    const db = pg.db;

    const before = [
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ];

    // No throw, and nothing applied a second time: a re-application would try to CREATE TABLE a
    // table that exists and be refused, rather than pass quietly, which is the reason this test
    // asserts on a fresh run rather than on the counts alone.
    for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);

    expect([
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ]).toEqual(before);
  });
});

describe("envio_flujo migration", () => {
  it("creates envio_flujo as a one-row table with both value columns not-null", async () => {
    const db = pg.db;
    const byName = await nullabilityOf(db, "envio_flujo");
    expect(byName).toMatchObject({
      id: "NO",
      proximo_envio_en: "NO",
      tiempo_espera_seg: "NO",
    });

    // The one-row constraint: a second row is refused by the singleton check, whatever id it names.
    await db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, '2026-07-21T00:00:00Z', 60)
    `);
    const second = await captureError(async () =>
      db.execute(sql`
        insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
        values (2, '2026-07-21T00:00:00Z', 60)
      `),
    );
    expect(isRefusal(second, CHECK_VIOLATION)).toBe(true); // envio_flujo_singleton_ck
    await db.execute(sql`delete from envio_flujo`);
  });
});

describe("acks migration", () => {
  it("creates acks with the required state and delivery columns", async () => {
    const db = pg.db;
    const by = await nullabilityOf(db, "acks");
    expect(by).toMatchObject({
      registro_id: "NO",
      submitted_at: "NO",
      state: "NO",
      delivered_at: "YES",
      csv: "YES",
    });
  });
});

describe("envios.reconciled_resubmit_at migration", () => {
  it("adds envios.reconciled_resubmit_at (nullable)", async () => {
    const db = pg.db;
    expect(await nullabilityOf(db, "envios")).toMatchObject({ reconciled_resubmit_at: "YES" });
  });
});

describe("registros_facturacion.entorno migration", () => {
  it("adds registros_facturacion.entorno (nullable)", async () => {
    const db = pg.db;
    expect(await nullabilityOf(db, "registros_facturacion")).toMatchObject({ entorno: "YES" });
  });

  it("rejects any value outside 'production'/'preproduction'", async () => {
    const db = pg.db;
    const error = await captureError(async () =>
      db.execute(sql`
        insert into registros_facturacion (id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
          primer_registro, sistema_informatico,
          fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno, creado_en)
        values (${newId()}, ${"00000000-0000-4000-8000-000000000000"},
          ${"00000000-0000-4000-8000-000000000000"}, ${"00000000-0000-4000-8000-000000000000"},
          ${"00000000-0000-4000-8000-000000000000"}, 1,
          'alta', '89890001K', 'A/1', '2026-07-20', 'Waitron SL', true, '{}',
          '2026-07-20T19:20:31+02:00', 120, '01', ${"0".repeat(64)}, ${"staging"},
          '2026-07-20T17:20:31.000Z')
      `),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true); // registros_entorno_ck
  });
});
