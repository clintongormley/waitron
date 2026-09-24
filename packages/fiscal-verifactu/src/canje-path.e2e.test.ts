import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { buildAltaRecord, serializeEnvio } from "@waitron/verifactu";
import type { Cabecera, EnvioRegistro, RegistroAlta } from "@waitron/verifactu";
import { decodeRegistroRow, fromRegistroRow, toRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedSale, seedTill, TEST_NIF, TEST_SISTEMA, type SeededTill } from "./testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

/**
 * Store an F3 record and serialize its stored columns through the drainer path. Both
 * Destinatarios and FacturasSustituidas must reach the wire. The fixture builds the record
 * directly to isolate storage and serialization.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(suite.db, "A");
});

/** An F3 canje record carrying BOTH the substituted ticket's identity (FacturasSustituidas) and the
 * recipient the F3 must always bear (Destinatarios). PrimerRegistro so no predecessor is needed —
 * this slice exercises the storage/serialisation round-trip, not chain bookkeeping. */
function f3CanjeRecord(): RegistroAlta {
  return buildAltaRecord({
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: "F3/1",
    FechaExpedicionFactura: new Date("2026-07-21T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F3",
    FacturasSustituidas: [
      {
        IDEmisorFactura: TEST_NIF,
        NumSerieFactura: "A/8",
        FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
      },
    ],
    Destinatarios: {
      IDDestinatario: [{ NombreRazon: "Cliente Empresarial SL", NIF: "B12345678" }],
    },
    DescripcionOperacion: "Canje de tiques simplificados",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "102.02",
        CuotaRepercutida: "21.43",
        TipoImpositivo: "21",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "21.43",
    ImporteTotal: "123.45",
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 21, 17, 20, 30)),
    offsetMinutes: 120,
    Encadenamiento: { PrimerRegistro: "S" },
  });
}

/** Insert the flattened record under a fresh sale and return the sale id. */
async function storeF3(record: RegistroAlta): Promise<string> {
  const saleId = await seedSale(suite.db, till, 1);
  const row = toRegistroRow(record, {
    tillId: till.tillId,
    nodeId: till.nodeId,
    sifId: till.sifId,
    saleId,
    secuencia: 1,
    // Must equal the record's own offsetMinutes so `fromRegistroRow` reproduces the exact
    // FechaHoraHusoGenRegistro literal that was hashed.
    offsetMinutes: 120,
    entorno: "production",
  });
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(registrosFacturacion).values(row);
  });
  return saleId;
}

/** One `select *` row in the snake_case `RegistroRow` shape `fromRegistroRow` reads — never
 * Drizzle's camelCase `.select()` (see `./registro-row.ts`'s own note on why the two differ).
 *
 * Through `decodeRegistroRow`, the function the product's own raw reads call: a raw select
 * reaches no drizzle column mapper, so the JSON columns arrive as the stored TEXT and
 * `primer_registro` as `0`/`1`. Hand-parsing the columns HERE would turn this case green while
 * leaving the drainer broken, which is the one thing this case exists to catch. Delete that call
 * and this case fails with `Cannot read properties of undefined (reading 'map')` out of
 * `serializeEnvio`. */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.db.execute<Record<string, unknown>>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return decodeRegistroRow(row);
}

describe("the F3 canje drain path", () => {
  it("stores an F3 registro carrying the recipient and substituted tickets", async () => {
    // Check the stored recipient and substitution blocks before serialization.
    const saleId = await storeF3(f3CanjeRecord());

    const [row] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(row?.tipoFactura).toBe("F3");
    expect(row?.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: "Cliente Empresarial SL", NIF: "B12345678" }],
    });
    expect(row?.facturasSustituidas).toEqual({
      IDFacturaSustituida: [
        { IDEmisorFactura: TEST_NIF, NumSerieFactura: "A/8", FechaExpedicionFactura: "20-07-2026" },
      ],
    });
  });

  it("serialises AEAT XML carrying both Destinatarios and FacturasSustituidas from the stored row", async () => {
    // The stored registro is run through the path the drainer submits by (drain.ts's
    // `toEnvioRegistro` -> serializeEnvio). If `destinatarios` had not survived `fromRegistroRow`,
    // the XML AEAT receives would omit the mandatory recipient and the F3 would be rejected.
    const saleId = await storeF3(f3CanjeRecord());
    const row = await rawRegistro(saleId);

    // Mirrors drain.ts's `toEnvioRegistro` and `cabeceraFor`, both module-private:
    // rebuild the record, stamp our registro id as RefExterna, and wrap it as the drainer does.
    const record = fromRegistroRow(row) as RegistroAlta;
    const envio: EnvioRegistro = { RegistroAlta: { ...record, RefExterna: row.id } };
    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura },
    };

    const xml = serializeEnvio(cabecera, [envio]);

    // Both mandatory F3 blocks reached the wire.
    expect(xml).toContain("<sf:Destinatarios>");
    expect(xml).toContain("<sf:FacturasSustituidas>");
    // The recipient's own identity reached the wire too, inside Destinatarios.
    expect(xml).toContain("<sf:NombreRazon>Cliente Empresarial SL</sf:NombreRazon>");
    expect(xml).toContain("<sf:NIF>B12345678</sf:NIF>");
    // And the substituted ticket's identity, inside FacturasSustituidas.
    expect(xml).toContain("<sf:NumSerieFactura>A/8</sf:NumSerieFactura>");
  });
});
