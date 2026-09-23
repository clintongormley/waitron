import {
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  captureError,
  isRefusal,
  newId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * `node_id` is the NOT NULL chain key on `registro_sif`, `cadenas` and `registros_facturacion`
 * (node-id rekey, 2026-08-03: the SIF is the compute node, #33). These tests pin the finished
 * contract: node_id is present, NOT NULL, and FK-checked against core's `nodes` on all three
 * tables.
 *
 * These are column-nullability and FK-round-trip assertions, none of which needs contention or a
 * second connection, so they run on the venue database `useVenueDb` opens (CLAUDE.md §4).
 */
const pg = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
  resetPerTest: false,
});

// One shared database backs the whole file, so every registros_facturacion insert must claim
// a fresh secuencia (registros_tenant_node_secuencia_uq) and num_serie (registros_identidad_uq).
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

/** A fresh node under TENANT_A's seeded location. */
async function seedNodeForA(): Promise<string> {
  return seedNode(pg.db, brandLocationId(TENANT_A.locationId));
}

/**
 * The `is_nullable` rows for a table's node_id column — `[{ is_nullable: "NO" }]` after the rekey.
 *
 * `information_schema.columns` reached this engine as `no such table: information_schema.columns`;
 * `pragma_table_info` is what answers the same question here, the way
 * `packages/db/src/schema/sales.test.ts`'s own `columnsOf` helper reads it. Its `notnull` is 1 or
 * 0, translated back to the two words the assertions below already spoke so the expected values
 * are unchanged. The table name is BOUND rather than pasted in: measured on node v26.7.0 against
 * `node:sqlite`, `pragma_table_info(?)` accepts a bind parameter and returns the same rows as the
 * literal form.
 */
async function nodeIdNullability(table: string): Promise<{ is_nullable: string }[]> {
  const { rows } = await pg.db.execute<{ notnull: number }>(
    sql`select "notnull" from pragma_table_info(${table}) where name = 'node_id'`,
  );
  return rows.map((row) => ({ is_nullable: row.notnull === 1 ? "NO" : "YES" }));
}

describe("registro_sif.node_id", () => {
  it("is NOT NULL, populated on the seeded row with a real node", async () => {
    expect(await nodeIdNullability("registro_sif")).toEqual([{ is_nullable: "NO" }]);
    // seedTenantTillSif now registers the SIF against TENANT_A's node (node-keyed).
    const row = await pg.db.execute<{ node_id: string | null }>(
      sql`select node_id from registro_sif where id = ${TENANT_A.sifId}`,
    );
    expect(row.rows[0]?.node_id).toBe(TENANT_A.nodeId);
  });
});

describe("cadenas.node_id", () => {
  it("is NOT NULL and is the chain key", async () => {
    expect(await nodeIdNullability("cadenas")).toEqual([{ is_nullable: "NO" }]);
    const node = await seedNodeForA();
    // A fresh chain head for this node (seedTenantTillSif seeds no cadenas row). ultimo_registro_id
    // and ultima_huella stay null — both-null satisfies cadenas_puntero_ck. `actualizado_en` is
    // stated because it is a `$defaultFn` column only the insert BUILDER fills.
    const inserted = await pg.db.execute<{ node_id: string | null }>(
      sql`insert into cadenas (node_id, actualizado_en)
           values (${node}, '2026-07-20T18:20:30.000Z') returning node_id`,
    );
    expect(inserted.rows[0]?.node_id).toBe(node);
  });

  it("rejects a null node_id (the chain key is required)", async () => {
    const error = await captureError(async () =>
      pg.db.execute(
        sql`insert into cadenas (node_id, actualizado_en) values (null, '2026-07-20T18:20:30.000Z')`,
      ),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
  });
});

describe("registros_facturacion.node_id", () => {
  /** A minimal alta registro carrying `nodeId` (or null). Keeps the `till_id` snapshot too, since the
   * rekey preserved it; `primer_registro = true` keeps every anterior_* null (encadenamiento_ck).
   * `id` and `creado_en` are stated for the reason `cadenas.actualizado_en` is above: omitting one
   * is refused NOT NULL on the WRONG column, which would let the null-node_id case below pass for
   * a reason that has nothing to do with node_id. */
  async function insertRegistro(nodeId: string | null): Promise<{ node_id: string | null }[]> {
    const secuencia = nextSecuencia();
    const { rows } = await pg.db.execute<{ node_id: string | null }>(sql`
      insert into registros_facturacion (
        id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
      ) values (${newId()}, ${TENANT_A.tillId}, ${nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
        ${secuencia}, 'alta',
        '89890001K', ${"R/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
        true, '{}',
        '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
      ) returning node_id`);
    return rows;
  }

  it("is NOT NULL — a registro without it is refused", async () => {
    expect(await nodeIdNullability("registros_facturacion")).toEqual([{ is_nullable: "NO" }]);
    const error = await captureError(() => insertRegistro(null));
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
  });

  it("accepts a valid node id", async () => {
    const node = await seedNodeForA();
    const inserted = await insertRegistro(node);
    expect(inserted[0]?.node_id).toBe(node);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const error = await captureError(() => insertRegistro(BOGUS_NODE));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
