import { newId } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

const pg = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
});

/**
 * `cuota_total`/`importe_total` hold the huella's literal hash input, so the bytes read back must
 * equal the bytes written. `@waitron/verifactu`'s `buildCadena` reads
 * `record.CuotaTotal`/`record.ImporteTotal` verbatim as strings and hashes them byte-for-byte; it
 * never re-runs `formatAmountExact`. A column that re-rendered the literal — dropping a trailing
 * zero, normalising `-0.00` — would corrupt an art. 7.i re-render of a row nobody touched.
 *
 * The amount below is 12 integer digits, the widest `ImporteSgn12.2Type` permits, and the case
 * still asks for it because a column that silently narrowed a legal amount is the failure this
 * test was written for. What the ENGINE refuses has changed: `packages/db/src/schema/columns.ts`
 * records that the SQLite column accepts values its PostgreSQL predecessor rejected, so this case
 * is now about the round trip alone and nothing here should be read as a width guarantee.
 *
 * Three spellings in the statement below changed with the engine, each measured against it by
 * running this file: `'[]'::jsonb` arrived as `unrecognized token: ":"` (a colon opens a bind
 * parameter to SQLite's parser) and the columns are TEXT holding JSON, so the cast is gone;
 * `repeat('F', 64)` arrived as `no such function: repeat`, so the 64 F's are built in JavaScript
 * and bound, the shape `node-columns.test.ts` already used; and `id`/`creado_en` are stated rather
 * than omitted, because both are `$defaultFn` columns only the insert BUILDER fills — a raw
 * statement omitting them is refused `NOT NULL constraint failed: registros_facturacion.id`.
 */
describe("cuota_total / importe_total round-trip the huella's literal hash input", () => {
  it("stores and reads back a 12-integer-digit AEAT-legal amount byte-identically", async () => {
    // 12 integer digits + 2 decimal. Not scale-2-padded from a round number either: proves no
    // re-rendering happens on the way in or out, only a literal string round-trip.
    const importeTotal = "999999999999.99";
    const cuotaTotal = "173913043.47";

    const result = await pg.db.execute<{ cuota_total: string; importe_total: string }>(sql`
      insert into registros_facturacion (
        id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
      ) values (${newId()}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
        1, 'alta',
        '89890001K', 'A/1', '2026-07-20', 'Waitron SL',
        'F2', 'Venta en establecimiento', '[]', ${cuotaTotal}, ${importeTotal},
        true, '{}',
        '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
      ) returning cuota_total, importe_total
    `);

    expect(result.rows[0]?.importe_total).toBe(importeTotal);
    expect(result.rows[0]?.cuota_total).toBe(cuotaTotal);
  });
});
