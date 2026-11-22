import {
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  captureError,
  isRefusal,
  newId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TAXPAYER_A, seedTaxpayerNodeSif } from "../test/fixtures.js";

/**
 * `node_id` is the NOT NULL chain key on `verifactu_identities`, `cadenas` and `verifactu_records`.
 * Only `verifactu_records`'s foreign key onto `nodes` is exercised here.
 */
const suite = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTaxpayerNodeSif,
  resetPerTest: false,
});

// One shared database backs the whole file, so every verifactu_records insert must claim
// a fresh secuencia (verifactu_records_node_secuencia_uq) and num_serie (verifactu_records_identidad_uq).
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

const BOGUS_NODE = "99999999-9999-4999-8999-999999999999";

/** A fresh node under TAXPAYER_A's seeded location. */
async function seedNodeForA(): Promise<string> {
  return seedNode(suite.db);
}

async function nodeIdNullability(table: string): Promise<{ is_nullable: string }[]> {
  const { rows } = await suite.db.execute<{ notnull: number }>(
    sql`select "notnull" from pragma_table_info(${table}) where name = 'node_id'`,
  );
  return rows.map((row) => ({ is_nullable: row.notnull === 1 ? "NO" : "YES" }));
}

describe("verifactu_identities.node_id", () => {
  it("is NOT NULL, populated on the seeded row with a real node", async () => {
    expect(await nodeIdNullability("verifactu_identities")).toEqual([{ is_nullable: "NO" }]);
    const row = await suite.db.execute<{ node_id: string | null }>(
      sql`select node_id from verifactu_identities where id = ${TAXPAYER_A.sifId}`,
    );
    expect(row.rows[0]?.node_id).toBe(TAXPAYER_A.nodeId);
  });
});

describe("cadenas.node_id", () => {
  it("is NOT NULL and is the chain key", async () => {
    expect(await nodeIdNullability("cadenas")).toEqual([{ is_nullable: "NO" }]);
    const node = await seedNodeForA();
    // `actualizado_en` is stated because only the insert BUILDER fills its default.
    const inserted = await suite.db.execute<{ node_id: string | null }>(
      sql`insert into cadenas (node_id, actualizado_en)
           values (${node}, '2026-07-20T18:20:30.000Z') returning node_id`,
    );
    expect(inserted.rows[0]?.node_id).toBe(node);
  });

  it("rejects a null node_id (the chain key is required)", async () => {
    const error = await captureError(async () =>
      suite.db.execute(
        sql`insert into cadenas (node_id, actualizado_en) values (null, '2026-07-20T18:20:30.000Z')`,
      ),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
  });
});

describe("verifactu_records.node_id", () => {
  /** A minimal alta carrying `nodeId` (or null). `id` and `creado_en` are stated: omitting one is
   * refused NOT NULL on the WRONG column, so the null-node_id case would pass for the wrong reason. */
  async function insertRegistro(nodeId: string | null): Promise<{ node_id: string | null }[]> {
    const secuencia = nextSecuencia();
    const { rows } = await suite.db.execute<{ node_id: string | null }>(sql`
      insert into verifactu_records (
        id, source, device_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
      ) values (${newId()}, 'device', (select device_id from sales where id = ${TAXPAYER_A.saleId}), ${nodeId}, ${TAXPAYER_A.sifId}, ${TAXPAYER_A.saleId},
        ${secuencia}, 'alta',
        '89890001K', ${"R/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
        true, '{}',
        '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
      ) returning node_id`);
    return rows;
  }

  it("is NOT NULL — a registro without it is refused", async () => {
    expect(await nodeIdNullability("verifactu_records")).toEqual([{ is_nullable: "NO" }]);
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
