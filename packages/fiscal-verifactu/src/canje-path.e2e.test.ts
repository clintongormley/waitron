import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { buildAltaRecord, serializeEnvio } from "@waitron/verifactu";
import type { Cabecera, EnvioRegistro, RegistroAlta } from "@waitron/verifactu";
import { fromRegistroRow, toRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedSale, seedTill, TEST_NIF, TEST_SISTEMA, type SeededTill } from "./testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

/**
 * Store an F3 record and serialize its stored columns through the drainer path. Both
 * Destinatarios and FacturasSustituidas must reach the wire. The fixture builds the record
 * directly to isolate storage and serialization.
 *
 * LOST in the PostgreSQL → SQLite conversion: this file used to run its insert as `app_user`, a
 * distinct database role holding only the deployment grants, so a write the fiscal table's ACL
 * refuses would have failed here. `asAppUser` is an inert function on this engine
 * (`packages/db/src/testing/roles.ts`) and SQLite has no roles at all, so the insert below now
 * runs with whatever the one connection can do. What still refuses a rewrite of a stored fiscal
 * record is the append-only trigger, installed here because `TEST_MIGRATIONS` carries each set's
 * `appendOnlyTables` (`packages/migrations/src/manifest.ts:163`). That refusal was MEASURED on
 * this engine rather than assumed — the probe, its output and why `inmutabilidad.test.ts` could
 * not be cited are in `chain.concurrency.test.ts`'s header. The ROLE half is covered by nothing,
 * which is the whole loss recorded against the deleted `privileges.test.ts`.
 */
// The whole migration manifest, the SQLite counterpart of the shared container's `manifest`
// template this file used to clone.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let till: SeededTill;

beforeEach(async () => {
  // Each call mints a fresh node (and NIF). `useVenueDb` also empties every data table between
  // tests, dropping and recreating the append-only triggers around the delete
  // (`packages/db/src/testing/venue-db.ts`, `buildResetPlan`/`applyReset`) — which is why the
  // reseed-without-truncate reasoning this comment used to carry no longer applies.
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

/** Insert the flattened record under a fresh sale as app_user and return the sale id. */
async function storeF3AsAppUser(record: RegistroAlta): Promise<string> {
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
    await asAppUser(tx);
    await tx.insert(registrosFacturacion).values(row);
  });
  return saleId;
}

/** One `select *` row in the raw snake_case `RegistroRow` shape `fromRegistroRow` reads — never
 * Drizzle's camelCase `.select()` (see `./registro-row.ts`'s own note on why the two differ).
 *
 * STILL RED ON THIS ENGINE, and deliberately not worked around here. A raw `select *` skips
 * drizzle's read mapping, so `facturas_sustituidas`, `destinatarios` and `desglose` come back as
 * the stored TEXT and `primer_registro` as `0`/`1`. `fromRegistroRow` spreads them as objects, so
 * the rebuilt record's `IDFacturaSustituida` is `undefined` and `serializeEnvio` throws
 * `Cannot read properties of undefined (reading 'map')` — measured by running this file,
 * 2026-09-22. That is the PRODUCT's read path, not this fixture's: `drain.ts:562`
 * (`select r.*, e.intentos from envios e ...`) and `verify.ts:55` read `RegistroRow` exactly this
 * way. Parsing the columns here would turn this case green while leaving the drainer broken —
 * which is the one thing this case exists to catch. It stays red until the `RegistroRow` raw-read
 * path is converted. */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.db.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return row;
}

describe("the F3 canje drain path", () => {
  it("stores an F3 registro carrying the recipient and substituted tickets", async () => {
    // Check the stored recipient and substitution blocks before serialization.
    const saleId = await storeF3AsAppUser(f3CanjeRecord());

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
