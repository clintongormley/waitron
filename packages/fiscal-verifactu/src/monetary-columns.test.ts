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
 * equal the bytes written: `@waitron/verifactu`'s `buildCadena` hashes them byte-for-byte. A column
 * that re-rendered the literal — dropping a trailing zero, normalising `-0.00` — would corrupt a
 * re-hash of a row nobody touched.
 *
 * The amount below is 12 integer digits, the widest `ImporteSgn12.2Type` permits. This case is
 * about the round trip alone: nothing here should be read as a width guarantee, because the column
 * refuses no width (`packages/db/src/schema/columns.ts`).
 */
describe("cuota_total / importe_total round-trip the huella's literal hash input", () => {
  it("stores and reads back a 12-integer-digit AEAT-legal amount byte-identically", async () => {
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
