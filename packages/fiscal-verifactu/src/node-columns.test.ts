import { CORE_MIGRATIONS, captureError, pgErrorCode } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * `node_id` is the NOT NULL chain key on `registro_sif`, `cadenas` and `registros_facturacion`
 * (node-id rekey, 2026-08-03: the SIF is the compute node, #33). This supersedes Task 3's scaffolding
 * assertions that the column was nullable — Task 4 populated it everywhere and flipped it NOT NULL,
 * dropping the old `till_id` key from `cadenas`/`registro_sif` (it stays a snapshot on
 * `registros_facturacion`). These tests pin the finished contract: node_id is present, NOT NULL, and
 * FK-checked against core's `nodes` on all three tables.
 *
 * PGlite (via usePgliteDb), matching this package's other column tests (`canje-columns.test.ts`):
 * these are column-nullability and FK-round-trip assertions, none of which needs the non-superuser
 * deployment role or lock contention that would require real Postgres (CLAUDE.md §4).
 */
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS],
  setup: seedTenantTillSif,
});

// One shared PGlite database backs the whole file, so every registros_facturacion insert must claim
// a fresh secuencia (registros_tenant_node_secuencia_uq) and num_serie (registros_identidad_uq).
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

/** The `is_nullable` rows for a table's node_id column — `[{ is_nullable: "NO" }]` after the rekey. */
async function nodeIdNullability(table: string): Promise<{ is_nullable: string }[]> {
  const { rows } = await pg.db.execute<{ is_nullable: string }>(
    sql`select is_nullable from information_schema.columns
         where table_name = ${table} and column_name = 'node_id'`,
  );
  return rows;
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
  it("is NOT NULL and is the (tenant, node) chain key", async () => {
    expect(await nodeIdNullability("cadenas")).toEqual([{ is_nullable: "NO" }]);
    const node = await seedNodeForA();
    // A fresh chain head for this node (seedTenantTillSif seeds no cadenas row). ultimo_registro_id
    // and ultima_huella stay null — both-null satisfies cadenas_puntero_ck. No till_id column any more.
    const inserted = await pg.db.execute<{ node_id: string | null }>(
      sql`insert into cadenas (tenant_id, node_id)
           values (${TENANT_A.id}, ${node}) returning node_id`,
    );
    expect(inserted.rows[0]?.node_id).toBe(node);
  });

  it("rejects a null node_id (the chain key is required)", async () => {
    const error = await captureError(() =>
      pg.db.execute(sql`insert into cadenas (tenant_id) values (${TENANT_A.id})`),
    );
    // 23502 not_null_violation.
    expect(pgErrorCode(error)).toBe("23502");
  });
});

describe("registros_facturacion.node_id", () => {
  /** A minimal alta registro carrying `nodeId` (or null). Keeps the `till_id` snapshot too, since the
   * rekey preserved it; `primer_registro = true` keeps every anterior_* null (encadenamiento_ck). */
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

  it("is NOT NULL — a registro without it is refused", async () => {
    expect(await nodeIdNullability("registros_facturacion")).toEqual([{ is_nullable: "NO" }]);
    const error = await captureError(() => insertRegistro(null));
    // 23502 not_null_violation.
    expect(pgErrorCode(error)).toBe("23502");
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
