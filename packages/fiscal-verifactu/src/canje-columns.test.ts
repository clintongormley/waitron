import {
  CHECK_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
  triggerRaised,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";

/**
 * Check canje JSON round-trips and the constraint limiting facturas_sustituidas to F3.
 *
 * The trigger case below is the only thing refusing an UPDATE of `destinatarios`.
 */
const pg = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
  resetPerTest: false,
});

// One shared database backs the whole file, so every insert must claim a fresh secuencia
// (registros_tenant_node_secuencia_uq) and a fresh num_serie (registros_identidad_uq).
let secuenciaSeq = 0;
function nextSecuencia(): number {
  secuenciaSeq += 1;
  return secuenciaSeq;
}

/** A JSON bind fragment: the stringified value, or a NULL. */
function jsonParam(value: unknown) {
  return value === undefined || value === null ? sql`null` : sql`${JSON.stringify(value)}`;
}

interface RegistroFields {
  tipoFactura?: string | null;
  facturasSustituidas?: unknown;
  destinatarios?: unknown;
}

const A_DESTINATARIO = { IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B99999999" }] };
const A_FACTURA_SUSTITUIDA = {
  IDFacturaSustituida: [
    { IDEmisorFactura: "89890001K", NumSerieFactura: "A/1", FechaExpedicionFactura: "20-07-2026" },
  ],
};

/**
 * Insert a canje alta. `id` and `creado_en` are stated because only the insert BUILDER fills their
 * defaults; omitting them would let a CHECK case below pass for the wrong reason.
 */
async function insertRegistro(exec: Database, fields: RegistroFields = {}): Promise<void> {
  const secuencia = nextSecuencia();
  await exec.execute(sql`
    insert into registros_facturacion (
      id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, facturas_sustituidas, destinatarios,
      descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
    ) values (${newId()}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"F/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      ${fields.tipoFactura === undefined ? "F3" : fields.tipoFactura},
      ${jsonParam(fields.facturasSustituidas)},
      ${jsonParam(fields.destinatarios)},
      'Canje de tiques simplificados', '[]', '21.43', '123.45',
      true, '{}',
      '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
    )
  `);
}

describe("the destinatarios column is JSON and round-trips", () => {
  it("stores and returns destinatarios verbatim", async () => {
    await insertRegistro(pg.db, { tipoFactura: "F3", destinatarios: A_DESTINATARIO });
    const { rows } = await pg.db.execute<{ destinatarios: string }>(
      sql`select destinatarios from registros_facturacion
           where destinatarios is not null order by secuencia desc limit 1`,
    );
    // A raw read returns the column's TEXT; drizzle's `json` read mapping does not run.
    expect(JSON.parse(rows[0]!.destinatarios)).toEqual(A_DESTINATARIO);
  });

  it("accepts a null destinatarios on an ordinary alta", async () => {
    await expect(
      insertRegistro(pg.db, { tipoFactura: "F2", destinatarios: null }),
    ).resolves.toBeUndefined();
  });
});

describe("registros_facturas_sustituidas_f3_ck — a substitution block only on an F3", () => {
  it("accepts facturas_sustituidas on an F3", async () => {
    await expect(
      insertRegistro(pg.db, {
        tipoFactura: "F3",
        facturasSustituidas: A_FACTURA_SUSTITUIDA,
        destinatarios: A_DESTINATARIO,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts a null facturas_sustituidas on a non-F3 (the ordinary case)", async () => {
    await expect(
      insertRegistro(pg.db, { tipoFactura: "F2", facturasSustituidas: null }),
    ).resolves.toBeUndefined();
  });

  it("rejects a facturas_sustituidas sitting on a non-F3 tipo_factura", async () => {
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: "F2", facturasSustituidas: A_FACTURA_SUSTITUIDA }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/registros_facturas_sustituidas_f3_ck/);
  });

  it("rejects a facturas_sustituidas sitting on a NULL tipo_factura", async () => {
    // A NULL tipo_factura makes `NULL = 'F3'` NULL, which a CHECK treats as passing; the
    // `tipo_factura is not null and` arm is what rejects this.
    const error = await captureError(() =>
      insertRegistro(pg.db, { tipoFactura: null, facturasSustituidas: A_FACTURA_SUSTITUIDA }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/registros_facturas_sustituidas_f3_ck/);
  });
});

describe("the destinatarios column inherits the table's immutability", () => {
  it("refuses an UPDATE of destinatarios by the append-only trigger", async () => {
    await insertRegistro(pg.db, { tipoFactura: "F3", destinatarios: A_DESTINATARIO });
    const error = await captureError(async () =>
      pg.db.execute(sql`update registros_facturacion set destinatarios = '{}'`),
    );
    // `triggerRaised` matches the words too, so an `ON DELETE RESTRICT` refusal under the same
    // result code cannot satisfy it.
    expect(triggerRaised(error, "registros_facturacion is append-only")).toBe(true);
  });
});
