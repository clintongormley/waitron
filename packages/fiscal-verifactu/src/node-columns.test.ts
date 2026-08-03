import { CORE_MIGRATIONS, captureError, pgErrorCode } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * node_id scaffolding (Task 3 of the node rekey): `registro_sif`, `cadenas` and
 * `registros_facturacion` each gain a NULLABLE `node_id` with a plain FK to core's `nodes`.
 * Nothing writes it yet — a later task populates it and flips the ones that must be NOT NULL.
 *
 * PGlite (via usePgliteDb), matching this package's other column tests (`canje-columns.test.ts`):
 * these are column-existence, nullability and FK-round-trip assertions, none of which needs the
 * non-superuser deployment role or lock contention that would require real Postgres (CLAUDE.md §4).
 */
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS],
  setup: seedTenantTillSif,
});

// One shared PGlite database backs the whole file, so every registros_facturacion insert must claim
// a fresh secuencia (registros_tenant_till_secuencia_uq) and num_serie (registros_identidad_uq).
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

/** A fresh node under TENANT_A's seeded tenant/location. */
async function seedNodeForA(): Promise<string> {
  return seedNode(pg.db, TENANT_A.id, brandLocationId(TENANT_A.locationId));
}

/** The `is_nullable` rows for a table's node_id column — `[{ is_nullable: "YES" }]` once added. */
async function nodeIdNullability(table: string): Promise<{ is_nullable: string }[]> {
  const { rows } = await pg.db.execute<{ is_nullable: string }>(
    sql`select is_nullable from information_schema.columns
         where table_name = ${table} and column_name = 'node_id'`,
  );
  return rows;
}

describe("registro_sif.node_id", () => {
  it("is a nullable column, null on the seeded row, that accepts a valid node id", async () => {
    expect(await nodeIdNullability("registro_sif")).toEqual([{ is_nullable: "YES" }]);
    // The seeded registro_sif row (seedTenantTillSif) carried no node_id — nullable in practice.
    const before = await pg.db.execute<{ node_id: string | null }>(
      sql`select node_id from registro_sif where id = ${TENANT_A.sifId}`,
    );
    expect(before.rows[0]?.node_id).toBeNull();
    // Setting it to a real node round-trips (registro_sif is updatable — revocation updates it).
    const node = await seedNodeForA();
    const after = await pg.db.execute<{ node_id: string | null }>(
      sql`update registro_sif set node_id = ${node} where id = ${TENANT_A.sifId} returning node_id`,
    );
    expect(after.rows[0]?.node_id).toBe(node);
  });
});

describe("cadenas.node_id", () => {
  it("is a nullable column that accepts a valid node id", async () => {
    expect(await nodeIdNullability("cadenas")).toEqual([{ is_nullable: "YES" }]);
    const node = await seedNodeForA();
    // A fresh chain head for TENANT_A's till (seedTenantTillSif seeds no cadenas row).
    // ultimo_registro_id and ultima_huella stay null — both-null satisfies cadenas_puntero_ck.
    const inserted = await pg.db.execute<{ node_id: string | null }>(
      sql`insert into cadenas (tenant_id, till_id, node_id)
           values (${TENANT_A.id}, ${TENANT_A.tillId}, ${node}) returning node_id`,
    );
    expect(inserted.rows[0]?.node_id).toBe(node);
  });
});

describe("registros_facturacion.node_id", () => {
  /** A minimal alta registro carrying `nodeId` (or null). Positive totals omitted — not needed for
   * a column round-trip; `primer_registro = true` keeps every anterior_* null (encadenamiento_ck). */
  async function insertRegistro(nodeId: string | null): Promise<{ node_id: string | null }[]> {
    const secuencia = nextSecuencia();
    const { rows } = await pg.db.execute<{ node_id: string | null }>(sql`
      insert into registros_facturacion (
        tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
      ) values (
        ${TENANT_A.id}, ${TENANT_A.tillId}, ${nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
        ${secuencia}, 'alta',
        '89890001K', ${"R/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
        true, '{}'::jsonb,
        '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}
      ) returning node_id`);
    return rows;
  }

  it("is nullable — a registro inserts without it", async () => {
    expect(await nodeIdNullability("registros_facturacion")).toEqual([{ is_nullable: "YES" }]);
    const inserted = await insertRegistro(null);
    expect(inserted[0]?.node_id).toBeNull();
  });

  it("accepts a valid node id", async () => {
    const node = await seedNodeForA();
    const inserted = await insertRegistro(node);
    expect(inserted[0]?.node_id).toBe(node);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const error = await captureError(() => insertRegistro(BOGUS_NODE));
    expect(pgErrorCode(error)).toBe("23503");
  });
});
