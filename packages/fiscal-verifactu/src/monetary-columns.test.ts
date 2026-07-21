import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  await seedTenantTillSif(db);
});

afterAll(async () => {
  await db.close();
});

/**
 * `cuota_total`/`importe_total` must be `text`, not `numeric(12,2)` — this is the test that would
 * have caught the regression. `packages/verifactu/src/huella.ts`'s `buildCadena` reads
 * `record.CuotaTotal`/`record.ImporteTotal` verbatim as strings and hashes them byte-for-byte; it
 * never re-runs `formatAmount`. The stored column value therefore IS the huella's hash input, and
 * the bytes read back must equal the bytes written — a guarantee only `text` gives. `numeric`
 * would additionally silently re-render a non-canonical literal (e.g. drop a trailing zero, or
 * normalise `-0.00`), which would corrupt an art. 7.i re-render of a row nobody touched.
 *
 * `numeric(12,2)` is also objectively too narrow for the domain type it was standing in for:
 * AEAT's `ImporteSgn12.2Type` allows 12 integer digits, `numeric(12,2)` allows only 10 (its
 * `precision` of 12 is TOTAL digits, split 10 integer + 2 scale) — so a fully legal 11-or-12
 * integer-digit amount overflows with SQLSTATE 22003 under `numeric(12,2)`, not merely
 * theoretically but the first time a large sale reaches this column.
 */
describe("cuota_total / importe_total round-trip the huella's literal hash input", () => {
  it("stores and reads back a 12-integer-digit AEAT-legal amount byte-identically", async () => {
    // 12 integer digits + 2 decimal — the maximum ImporteSgn12.2Type permits, and 2 digits wider
    // than numeric(12,2)'s 10+2. Not scale-2-padded from a round number either: proves no numeric
    // re-rendering happens on the way in or out, only a literal string round-trip.
    const importeTotal = "999999999999.99";
    const cuotaTotal = "173913043.47";

    const result = await db.execute<{ cuota_total: string; importe_total: string }>(sql`
      insert into registros_facturacion (
        tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
        id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
        tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
        primer_registro, sistema_informatico,
        fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
      ) values (
        ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
        1, 'alta',
        '89890001K', 'A/1', '2026-07-20', 'Waitron SL',
        'F2', 'Venta en establecimiento', '[]'::jsonb, ${cuotaTotal}, ${importeTotal},
        true, '{}'::jsonb,
        '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
      ) returning cuota_total, importe_total
    `);

    expect(result.rows[0]?.importe_total).toBe(importeTotal);
    expect(result.rows[0]?.cuota_total).toBe(cuotaTotal);
  });
});
