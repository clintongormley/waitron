import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { seedFiscalRegistro, insertFiscalRegistro } from "./testing/fiscal-fixtures.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";

/**
 * This package's shared fixtures, RUN against a real migrated venue database: a broken fixture
 * otherwise fails every caller's `beforeAll` without naming itself.
 */

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("the shared fixtures seed a real migrated venue", () => {
  it("seeds the two legacy selling units with their names and precisions", async () => {
    await seedLegacySellingUnits(db);
    const { rows } = await withTransaction(db, async (tx) => {
      return tx.execute<{ seed_key: string; precision: number; hardware_unit: string | null }>(
        sql`select seed_key, precision, hardware_unit from units order by seed_key`,
      );
    });
    expect(rows).toEqual([
      { seed_key: "each", precision: 0, hardware_unit: null },
      { seed_key: "kg", precision: 3, hardware_unit: "kg" },
    ]);
  });

  it("seeds a fiscal registro with its whole FK closure, chain head and envío", async () => {
    const seeded = await seedFiscalRegistro(db, { cadena: true, envio: true });
    const { rows } = await db.execute<{
      huella: string;
      entorno: string;
      fecha: string;
      creado: string;
      chain: string;
      envio: string;
    }>(sql`
      select r.huella, r.entorno,
             r.fecha_hora_huso_gen_registro as fecha, r.creado_en as creado,
             c.ultima_huella as chain, e.estado as envio
      from registros_facturacion r
      join cadenas c on c.node_id = r.node_id
      join envios e on e.registro_id = r.id
      where r.id = ${seeded.registroId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      huella: seeded.huella,
      entorno: "production",
      chain: seeded.huella,
      envio: "pendiente",
      // The fixture's `+01:00` literal reaches the column as the UTC instant it names.
      fecha: "2026-07-20T18:20:30.000Z",
    });
    // `creado_en` comes from the column's own generator, which only the insert BUILDER runs.
    expect(Number.isNaN(Date.parse(rows[0]!.creado))).toBe(false);
  });

  it("plants a second registro on the same chain", async () => {
    const first = await seedFiscalRegistro(db);
    const second = await insertFiscalRegistro(db, first, { secuencia: 2, numSerie: "A/2" });
    expect(second.secuencia).toBe(2);
    const { rows } = await db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from registros_facturacion where node_id = ${first.nodeId}`,
    );
    expect(rows[0]!.n).toBe(2);
  });
});
