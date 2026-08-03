import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { buildAltaRecord, serializeEnvio } from "@waitron/verifactu";
import type { Cabecera, EnvioRegistro, RegistroAlta } from "@waitron/verifactu";
import { fromRegistroRow, toRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { seedSale, seedTill, TEST_NIF, TEST_SISTEMA, type SeededTill } from "./testing/seed.js";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";

/**
 * The end-to-end proof that an F3 canje's recipient and substitution blocks survive the EXACT path
 * the drainer submits by. `drain.ts`'s `toEnvioRegistro` (:722-729) rebuilds a record from its
 * stored columns via `fromRegistroRow` and hands it to `serializeEnvio` (the same serialiser the
 * real client submits with, client.ts:50). If `destinatarios` did not round-trip through the
 * registro row, the F3 AEAT receives would be stripped of its mandatory recipient and rejected —
 * the same failure mode #46 fixed for the R5's `TipoRectificativa` (plan §2.3). This proves both
 * `<sf:Destinatarios>` and `<sf:FacturasSustituidas>` reach the wire from a stored row.
 *
 * **Real Postgres, not PGlite** (the sibling `registro-row.roundtrip.test.ts` uses PGlite for the
 * pure flatten/rehydrate): the F3 registro is stored under the NON-superuser deployment role
 * (`withTenant` + `asAppUser`, exactly `correction-path.e2e.test.ts`'s shape), so RLS is genuinely
 * enforced during the append and the recipient/substitution jsonb round-trips through the real
 * engine the production drainer serialises from — neither of which PGlite (every connection a
 * superuser, RLS bypassed) can show. `recordSubstitution` (the backend writer that will assemble
 * this record from a sale) is Slice 3, not built here; this slice isolates the storage round-trip
 * and drain serialisation by building the F3 record directly via `buildAltaRecord` → `toRegistroRow`.
 */
const suite = useRealPostgres({ start: startRealPostgres, timeoutMs: CONTAINER_SETUP_TIMEOUT_MS });

let till: SeededTill;

beforeEach(async () => {
  // Each call mints a fresh tenant (and NIF), so tests never collide on the append-only,
  // TRUNCATE-blocking `registros_facturacion` — the same reseed-without-truncate reasoning
  // `correction-path.e2e.test.ts` documents.
  till = await seedTill(suite.admin, "A");
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

/** Flattens `record` through `toRegistroRow` and inserts it under a fresh sale on the shared till,
 * AS THE DEPLOYMENT ROLE (`asAppUser` under the till's tenant), so RLS is enforced during the
 * append. Returns the sale id the registro is keyed on. */
async function storeF3AsAppUser(record: RegistroAlta): Promise<string> {
  const saleId = await seedSale(suite.admin, till, 1);
  const row = toRegistroRow(record, {
    tenantId: till.tenantId,
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
  await withTenant(suite.admin, till.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.insert(registrosFacturacion).values(row);
  });
  return saleId;
}

/** One `select *` row in the raw snake_case `RegistroRow` shape `fromRegistroRow` reads — never
 * Drizzle's camelCase `.select()` (see `./registro-row.ts`'s own note on why the two differ). */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.admin.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return row;
}

describe("the F3 canje drain path against real Postgres", () => {
  it("stores an F3 registro carrying the recipient and substituted tickets under the deployment role", async () => {
    // The registro exists and its jsonb blocks survived the RLS-enforced insert on the real engine —
    // the storage half of the round-trip, before serialisation. `registros_facturas_sustituidas_f3_ck`
    // (migration 0011) also passed, since an F3 is the one tipo_factura that may carry the block.
    const saleId = await storeF3AsAppUser(f3CanjeRecord());

    const [row] = await suite.admin
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
    // The submission gap made concrete for the F3 canje. The stored registro is run through the
    // EXACT path the drainer submits by (drain.ts:722-729 `toEnvioRegistro` -> serializeEnvio). If
    // `destinatarios` had not survived `fromRegistroRow`, the XML AEAT receives would omit the
    // mandatory recipient and the F3 would be rejected — the same class of bug #46 fixed for the R5.
    const saleId = await storeF3AsAppUser(f3CanjeRecord());
    const row = await rawRegistro(saleId);

    // Mirrors drain.ts:722-729 `toEnvioRegistro` and :733-735 `cabeceraFor`, both module-private:
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
