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
 * Nothing here catches fiscal migrating before core: this engine creates a table whose foreign key
 * names a missing table. The product's order comes from `orderedMigrationSets`
 * (`packages/module/src/module.ts`).
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

/** Every table in the database, drizzle's per-package journals included, SQLite's own excluded. */
async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' order by 1`,
  );
  return rows.rows.map((r) => r.name);
}

async function journalCount(db: Database, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

/** A table's columns as `{ <column>: "NO" | "YES" }`, meaning nullable or not. */
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
    // Core's tables and the module's tables coexist, created by independent migration sets.
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
  });

  it("keeps the two journals separate", async () => {
    const db = pg.db;

    // Separate journals: drizzle runs only migrations newer than a journal's latest `created_at`.
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

    // A re-application would CREATE TABLE an existing table and be refused.
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
