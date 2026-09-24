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
 * `node_id` is the NOT NULL chain key on `registro_sif`, `cadenas` and `registros_facturacion`.
 * Only `registros_facturacion`'s foreign key onto `nodes` is exercised here.
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

async function nodeIdNullability(table: string): Promise<{ is_nullable: string }[]> {
  const { rows } = await pg.db.execute<{ notnull: number }>(
    sql`select "notnull" from pragma_table_info(${table}) where name = 'node_id'`,
  );
  return rows.map((row) => ({ is_nullable: row.notnull === 1 ? "NO" : "YES" }));
}

describe("registro_sif.node_id", () => {
  it("is NOT NULL, populated on the seeded row with a real node", async () => {
    expect(await nodeIdNullability("registro_sif")).toEqual([{ is_nullable: "NO" }]);
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
    // `actualizado_en` is stated because only the insert BUILDER fills its default.
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
  /** A minimal alta carrying `nodeId` (or null). `id` and `creado_en` are stated: omitting one is
   * refused NOT NULL on the WRONG column, so the null-node_id case would pass for the wrong reason. */
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
