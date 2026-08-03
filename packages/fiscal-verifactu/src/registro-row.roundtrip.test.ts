import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { buildAltaRecord, serializeEnvio } from "@waitron/verifactu";
import type { AltaInput, Cabecera, EnvioRegistro, RegistroAlta } from "@waitron/verifactu";
import { registrosFacturacion } from "./schema/registros.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { fromRegistroRow, toRegistroRow, type RegistroRow } from "./registro-row.js";
import { seedSale, seedTill, TEST_NIF, TEST_SISTEMA, type SeededTill } from "./testing/seed.js";

// PGlite, deliberately (CLAUDE.md §4): every case here only builds a record, flattens it through
// `toRegistroRow`, inserts it, reads it back with `select *` and rehydrates via `fromRegistroRow` —
// pure flatten/rehydrate and XML assembly. It exercises no RLS, no deployment role and no
// concurrency (each case is its own single insert under a fresh tenant), so real Postgres would buy
// nothing here and PGlite is the lighter target. The columns' immutability/REVOKE backstop and the
// deployment-role/RLS behaviour are Slice 1's real-PG suites, not this file's.
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

let till: SeededTill;

beforeEach(async () => {
  till = await seedTill(pg.db);
});

// Distinct invoice number per sale, so successive `seedSale` calls in one test never collide on the
// series' number — each `seedTill` mints its own series, but a test may seed more than one sale.
let invoiceSequence = 0;

/**
 * Flattens `record` through `toRegistroRow`, inserts it under a fresh sale on the shared till, and
 * returns the raw `select *` row — the snake_case `RegistroRow` shape `fromRegistroRow` reads (never
 * Drizzle's camelCase `.select()`, per `./registro-row.ts`'s own note). `secuencia: 1` + a
 * `PrimerRegistro` record keeps every stored row a first record, so the tests need no chain
 * bookkeeping (`cadenas`) at all.
 */
async function storeAndReadBack(record: RegistroAlta): Promise<RegistroRow> {
  invoiceSequence += 1;
  const saleId = await seedSale(pg.db, till, invoiceSequence);
  const row = toRegistroRow(record, {
    tenantId: till.tenantId,
    tillId: till.tillId,
    nodeId: till.nodeId,
    sifId: till.sifId,
    saleId,
    secuencia: 1,
    // Must equal the record's own offsetMinutes, so `fromRegistroRow` reproduces the exact
    // FechaHoraHusoGenRegistro literal that was hashed (this is what makes the deep-equal hold on
    // that field, and is the property write-path.e2e.test.ts pins via the huella).
    offsetMinutes: 120,
    entorno: "production",
  });
  await pg.db.insert(registrosFacturacion).values(row);
  const { rows } = await pg.db.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const raw = rows[0];
  if (raw === undefined) throw new Error(`storeAndReadBack: no row for sale ${saleId}`);
  return raw;
}

/** The reachable v1 case: an R5 rectificativa por diferencias — TipoRectificativa "I", one rectified
 * invoice, negative totals (plan §1, findings §10.2). PrimerRegistro so no predecessor is needed. */
function r5RectificativaInput(): AltaInput {
  return {
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: "R/1",
    FechaExpedicionFactura: new Date("2026-07-21T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "R5",
    TipoRectificativa: "I",
    FacturasRectificadas: [
      {
        IDEmisorFactura: TEST_NIF,
        NumSerieFactura: "A/7",
        FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
      },
    ],
    DescripcionOperacion: "Rectificacion por diferencias",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "-102.02",
        CuotaRepercutida: "-21.43",
        TipoImpositivo: "21",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "-21.43",
    ImporteTotal: "-123.45",
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 21, 17, 20, 30)),
    offsetMinutes: 120,
    Encadenamiento: { PrimerRegistro: "S" },
  };
}

describe("registro-row round-trip of the four AEAT rectificativa fields", () => {
  it("round-trips an R5 rectificativa including TipoRectificativa and FacturasRectificadas", async () => {
    // The gap-closing invariant: a stored rectificativa must rebuild into the SAME record it was
    // flattened from, four AEAT fields and all — otherwise the drainer files it stripped of its
    // mandatory TipoRectificativa and AEAT rejects it (error 1114). A full deep-equal is the
    // strongest form: it fails if ANY field the record carried fails to survive storage.
    const built = buildAltaRecord(r5RectificativaInput());
    const row = await storeAndReadBack(built);

    expect(fromRegistroRow(row)).toEqual(built);
    // Named, not only covered by the deep-equal, so a regression report points straight at the two
    // fields this slice exists to preserve.
    const rebuilt = fromRegistroRow(row) as RegistroAlta;
    expect(rebuilt.TipoRectificativa).toBe("I");
    expect(rebuilt.FacturasRectificadas).toEqual(built.FacturasRectificadas);
  });

  it("round-trips an R5 rectificativa in S mode — TipoRectificativa, FacturasRectificadas and ImporteRectificacion", async () => {
    // The rectificativa trio non-null on one R5 registro: proves ImporteRectificacion survives
    // storage (the S-mode field, absent from the I-mode case above) alongside TipoRectificativa and
    // FacturasRectificadas — the "present" arm of three of fromRegistroRow's conditional spreads.
    //
    // FacturasSustituidas — the F3 canje block — is deliberately NOT set here. It was, in an earlier
    // version of this test, purely to store all four columns non-null in one row; but migration 0011
    // added registros_facturas_sustituidas_f3_ck, which requires FacturasSustituidas to sit on an F3
    // (tipo_factura R1–R5 and F3 are mutually exclusive), so an R5 carrying it is no longer
    // storable. Its round-trip moved to the F3 case below — the fourth "present" arm — so no
    // coverage is lost.
    const built = buildAltaRecord({
      ...r5RectificativaInput(),
      TipoRectificativa: "S",
      ImporteRectificacion: {
        BaseRectificada: "102.02",
        CuotaRectificada: "21.43",
        CuotaRecargoRectificado: "0.00",
      },
    });
    const row = await storeAndReadBack(built);

    expect(fromRegistroRow(row)).toEqual(built);
  });

  it("round-trips an F3 canje carrying FacturasSustituidas and Destinatarios", async () => {
    // The fourth conditional-spread "present" arm, plus the recipient this slice adds:
    // FacturasSustituidas names the substituted simplified tickets on an F3 canje (plan §1), and
    // Destinatarios carries the recipient an F3 must always bear (findings §10.2 — "siempre debe
    // llevar el destinatario"). An F3 is a full invoice with a POSITIVE total and carries none of
    // the three rectificativa fields; registros_facturas_sustituidas_f3_ck requires the block to sit
    // on an F3, so this is the one record shape that stores both. If `destinatarios` did NOT
    // round-trip, the drainer would file the F3 stripped of its mandatory recipient and AEAT would
    // reject it — the same failure mode #46 fixed for the R5's TipoRectificativa (plan §2.3).
    const built = buildAltaRecord({
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
    const row = await storeAndReadBack(built);

    const rebuilt = fromRegistroRow(row) as RegistroAlta;
    expect(rebuilt).toEqual(built);
    // Named, not only covered by the deep-equal, so a regression report points straight at the two
    // fields the F3 canje record exists to carry.
    expect(rebuilt.FacturasSustituidas).toEqual(built.FacturasSustituidas);
    expect(rebuilt.Destinatarios).toEqual(built.Destinatarios);
  });

  it("round-trips an ordinary alta, leaving all four fields absent (not null)", async () => {
    // The "absent" arm of every conditional spread: an ordinary F1 alta carries none of the four,
    // and a rehydrated record must OMIT them, not set them to null — buildAltaRecord itself omits
    // an absent field, so a `TipoRectificativa: null` on the rebuilt side would break the deep-equal
    // against a record that has no such key at all.
    const built = buildAltaRecord({
      IDEmisorFactura: TEST_NIF,
      NumSerieFactura: "A/9",
      FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta en establecimiento",
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
      generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, 30)),
      offsetMinutes: 120,
      Encadenamiento: { PrimerRegistro: "S" },
    });
    const row = await storeAndReadBack(built);

    const rebuilt = fromRegistroRow(row) as RegistroAlta;
    expect(rebuilt).toEqual(built);
    expect("TipoRectificativa" in rebuilt).toBe(false);
    expect("FacturasRectificadas" in rebuilt).toBe(false);
    expect("FacturasSustituidas" in rebuilt).toBe(false);
    expect("ImporteRectificacion" in rebuilt).toBe(false);
    // The recipient's "absent" arm too: an ordinary alta (and the R5 above) stores a NULL
    // `destinatarios`, and a rehydrated record must OMIT the key, never set it to null.
    expect("Destinatarios" in rebuilt).toBe(false);
  });
});

describe("drain serialisation files the mandatory rectificativa fields (the gap-closing test)", () => {
  it("produces AEAT XML carrying TipoRectificativa and FacturasRectificadas from a stored row", async () => {
    // The submission gap made concrete. A rectificativa registro is stored, then run through the
    // EXACT path the drainer submits by (drain.ts:722-729 `toEnvioRegistro` -> serializeEnvio, and
    // the real client serialises via the very same serializeEnvio — client.ts:50). If the four
    // fields did not survive `fromRegistroRow`, the XML AEAT receives would omit the mandatory
    // TipoRectificativa and be rejected (error 1114). Built directly via `toRegistroRow`, NOT
    // through `recordCorrection`, so this isolates the storage round-trip and serialisation from the
    // record-assembly path.
    const built = buildAltaRecord(r5RectificativaInput());
    const row = await storeAndReadBack(built);

    // Mirrors drain.ts:722-729 `toEnvioRegistro` and :733-735 `cabeceraFor`, both module-private:
    // rebuild the record, stamp our registro id as RefExterna, and wrap it as the drainer does.
    const record = fromRegistroRow(row) as RegistroAlta;
    const envio: EnvioRegistro = { RegistroAlta: { ...record, RefExterna: row.id } };
    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura },
    };

    const xml = serializeEnvio(cabecera, [envio]);

    expect(xml).toContain("<sf:TipoRectificativa>I</sf:TipoRectificativa>");
    expect(xml).toContain("<sf:FacturasRectificadas>");
    // The rectified invoice's identity reached the wire too, inside FacturasRectificadas.
    expect(xml).toContain("<sf:NumSerieFactura>A/7</sf:NumSerieFactura>");
  });
});
