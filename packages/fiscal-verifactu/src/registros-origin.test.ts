import {
  CHECK_VIOLATION,
  NOT_NULL_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

const suite = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
  resetPerTest: false,
});

let secuenciaSeq = 0;

/** A minimal alta naming `source` and `device_id`; `device` names the seeded sale's device. */
async function insertRegistro(
  source: string | null,
  device: "seeded" | null,
): Promise<{ source: string; device_id: string | null }[]> {
  secuenciaSeq += 1;
  const deviceId =
    device === "seeded" ? sql`(select device_id from sales where id = ${TENANT_A.saleId})` : null;
  const { rows } = await suite.db.execute<{ source: string; device_id: string | null }>(sql`
    insert into registros_facturacion (
      id, source, device_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
    ) values (${newId()}, ${source}, ${deviceId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId},
      ${TENANT_A.saleId}, ${secuenciaSeq}, 'alta',
      '89890001K', ${"O/" + String(secuenciaSeq)}, '2026-07-20', 'Waitron SL',
      true, '{}',
      '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
    ) returning source, device_id`);
  return rows;
}

describe("registros_facturacion — the source and device", () => {
  it("refuses a record filed from the dashboard", async () => {
    const error = await captureError(() => insertRegistro("dashboard", null));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "CHECK constraint failed: registros_facturacion_source_ck",
    );
  });

  it("refuses a device source with no device", async () => {
    const error = await captureError(() => insertRegistro("device", null));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "CHECK constraint failed: registros_facturacion_source_device_ck",
    );
  });

  it("refuses a record with no source", async () => {
    const error = await captureError(() => insertRegistro(null, null));
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "NOT NULL constraint failed: registros_facturacion.source",
    );
  });

  it("accepts a record from a device, and one from the readiness test with no device", async () => {
    const [fromDevice] = await insertRegistro("device", "seeded");
    expect(fromDevice!.source).toBe("device");
    expect(fromDevice!.device_id).not.toBeNull();
    expect(await insertRegistro("readiness_test", null)).toEqual([
      { source: "readiness_test", device_id: null },
    ]);
  });
});
