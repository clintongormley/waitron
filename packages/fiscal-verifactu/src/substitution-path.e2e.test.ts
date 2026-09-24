import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { invoiceSeries, sales, withTransaction } from "@waitron/db";
import { computeHuella } from "@waitron/verifactu";
import type { Counterparty, SaleForFiscalRecord } from "@waitron/fiscal";
import { decimal, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow, toAeatDate } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

/**
 * Record an F3 substitution, including callers that start together. Check its chain position,
 * hash, substituted identities, recipients and pending sidecar, and verify that the original
 * tickets retain their alta records.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let till: SeededTill;
// A SECOND series for the F3 canje invoices. The F3 draws its own number, and `sales` is unique on
// (series_id, invoice_number), so an F3 cannot reuse a ticket's series+number. `purpose` is
// 'standard' rather than a bespoke 'substitution' value: the invoice_series CHECK admits only
// 'standard'/'rectificative', and giving F3 its own purpose is a core decision the BACKEND does not
// enforce — it derives NumSerieFactura from `seriesCode`/`invoiceNumber`, never from this row.
let substitutionSeriesId: string;

const RECIPIENT: Counterparty = {
  taxId: "B12345678",
  legalName: "Cliente Empresarial SL",
  countryCode: "ES",
};

beforeEach(async () => {
  till = await seedTill(suite.db, "A");
  // Through the table: `id` and `created_at` are `$defaultFn` generators that only the insert
  // BUILDER runs.
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: till.nodeId, code: "F3", purpose: "standard", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  substitutionSeriesId = series!.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    // `db` is only read by `pendingCount`, which this suite never calls; `recordSale`/
    // `recordSubstitution` act on the transaction they are handed.
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** An F3's OWN data — a full invoice restating the substituted operations, POSITIVE total, and a
 * non-null recipient. `seriesCode` "F3" → NumSerieFactura "F3/<n>". */
function substitutionSaleFor(
  saleId: string,
  invoiceNumber: number,
  overrides: Partial<SaleForFiscalRecord> = {},
): SaleForFiscalRecord {
  return {
    tillId: till.tillId,
    nodeId: till.nodeId,
    saleId: brandSaleId(saleId),
    // Never read by `recordSubstitution` (it uses `seriesCode`/`invoiceNumber` for NumSerieFactura);
    // branded only to satisfy the type.
    seriesId: brandSeriesId(substitutionSeriesId),
    seriesCode: "F3",
    invoiceNumber,
    issuedAt: new Date("2026-03-02T12:05:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Canje de tiques simplificados",
    total: decimal("123.45"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("102.02"), tax: decimal("21.43") }],
    counterparty: RECIPIENT,
    ...overrides,
  };
}

/** The substituted simplified (F2) ticket: `counterparty: null` (so recordSale files it F2),
 * positive totals. `seriesCode` "A" → NumSerieFactura "A/<n>". */
function ticketSaleFor(saleId: string, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tillId: till.tillId,
    nodeId: till.nodeId,
    saleId: brandSaleId(saleId),
    seriesId: brandSeriesId(till.seriesId),
    seriesCode: "A",
    invoiceNumber,
    issuedAt: new Date("2026-03-01T12:05:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Venta en establecimiento",
    total: decimal("123.45"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("102.02"), tax: decimal("21.43") }],
    counterparty: null,
  };
}

/** Records one substituted F2 ticket (seeding its `sales` row first). Returns the ticket sale's
 * id — a `substitutedSaleId` an F3 points at. */
async function recordTicket(invoiceNumber: number): Promise<string> {
  const ticketId = await seedSale(suite.db, till, invoiceNumber);
  await withTransaction(suite.db, async (tx) => {
    await backend.recordSale(tx, ticketSaleFor(ticketId, invoiceNumber));
  });
  return ticketId;
}

/** Insert an F3 sale with counterparty columns and return its id. */
async function seedSubstitutionRow(invoiceNumber: number): Promise<string> {
  // Through the table: `id` and `created_at` are builder-side `$defaultFn` generators a raw insert
  // never reaches.
  const [row] = await suite.db
    .insert(sales)
    .values({
      tillId: till.tillId,
      nodeId: till.nodeId,
      seriesId: substitutionSeriesId,
      invoiceNumber,
      issuedAt: "2026-03-02T12:05:00+01:00",
      issuedOffsetMinutes: 60,
      total: 12345,
      vatBreakdown: [],
      counterpartyTaxId: RECIPIENT.taxId,
      counterpartyLegalName: RECIPIENT.legalName,
      counterpartyCountryCode: RECIPIENT.countryCode,
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  if (row === undefined) throw new Error("seedSubstitutionRow inserted nothing");
  return row.id;
}

/** Records one F3 substituting `substitutedSaleIds`, seeding its own F3 `sales` row first. Returns
 * the F3 sale's id. */
async function substitute(
  substitutedSaleIds: string[],
  overrides: Partial<SaleForFiscalRecord> = {},
): Promise<string> {
  const invoiceNumber = overrides.invoiceNumber ?? 1;
  const substitutionId = await seedSubstitutionRow(invoiceNumber);
  const sale = substitutionSaleFor(substitutionId, invoiceNumber, overrides);
  await withTransaction(suite.db, async (tx) => {
    await backend.recordSubstitution(tx, sale, {
      substitutedSaleIds: substitutedSaleIds.map((id) => brandSaleId(id)),
    });
  });
  return substitutionId;
}

/** One `select *` row in the raw snake_case `RegistroRow` shape `fromRegistroRow`/`computeHuella`
 * need — an F3's registro is the only one carrying its OWN (substitution) sale id, so this is
 * unambiguous. */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.db.execute<Record<string, unknown>>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return decodeRegistroRow(row);
}

/** The same row read through the TABLE, so every column's own read mapping applies — the JSON
 * columns come back parsed and the booleans as booleans. Used by the cases whose subject is what a
 * column HOLDS; `rawRegistro` above is for the one case that rebuilds the record `computeHuella`
 * hashes, which needs the snake_case shape. A raw `select *` skips drizzle's read mapping and
 * answers the stored JSON text. */
async function registro(saleId: string) {
  const [row] = await suite.db
    .select()
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.saleId, saleId));
  if (row === undefined) throw new Error(`registro: no row for sale ${saleId}`);
  // The AEAT shapes, restated here because `./schema/registros.ts` declares these columns as a
  // bare `json(...)` with no `$type`, so drizzle types them `{}` and a property access on one is a
  // TS2339. `RegistroRow` (`./registro-row.ts`) carries the real types for the same columns under
  // their snake_case names. A cast, not a runtime change: the values are already parsed by the
  // column's own `mode: "json"` mapping.
  return row as typeof row & {
    facturasSustituidas: RegistroRow["facturas_sustituidas"];
    destinatarios: RegistroRow["destinatarios"];
  };
}

describe("recordSubstitution against the real Veri*Factu backend", () => {
  it("records the substitution as an F3 alta at the next chain position", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);

    const [row] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, substitutionId));
    expect(row?.tipoRegistro).toBe("alta");
    expect(row?.tipoFactura).toBe("F3");
    expect(row?.numSerieFactura).toBe("F3/1");
    // Ticket at 1, F3 at 2 — an alta takes the next secuencia in generation order.
    expect(row?.secuencia).toBe(2);
    expect(row?.primerRegistro).toBe(false);
    // An F3 is NOT a rectificativa: none of the four rectificativa columns is populated.
    expect(row?.tipoRectificativa).toBeNull();
    expect(row?.facturasRectificadas).toBeNull();
    expect(row?.importeRectificacion).toBeNull();
  });

  it("stores a huella that recomputes from its own columns, hashing the positive ImporteTotal", async () => {
    // The strongest single assertion. `CuotaTotal`/`ImporteTotal` and `TipoFactura` ARE huella
    // inputs, so a recompute that agrees with the stored huella proves the POSITIVE totals and the
    // `F3` type were the exact literals hashed — a module that hashed a different record than it
    // persisted, or negated the total, passes nothing here.
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);
    const row = await rawRegistro(substitutionId);

    expect(row.importe_total).toBe("123.45");
    expect(row.cuota_total).toBe("21.43");
    expect(row.tipo_factura).toBe("F3");
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });

  it("carries the substituted ticket's exact stored identity in FacturasSustituidas", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);

    const ticket = await registro(ticketId);
    const substitution = await registro(substitutionId);
    // Read from the TICKET's row, not the fixture: this pins "the ticket's exact stored identity"
    // rather than "a value that happens to match the fixture". The date is stored on the ticket as
    // `YYYY-MM-DD` and rendered into FacturasSustituidas as AEAT's `DD-MM-YYYY`.
    expect(substitution.facturasSustituidas).toEqual({
      IDFacturaSustituida: [
        {
          IDEmisorFactura: ticket.idEmisorFactura,
          NumSerieFactura: ticket.numSerieFactura,
          FechaExpedicionFactura: toAeatDate(ticket.fechaExpedicionFactura),
        },
      ],
    });
    expect(ticket.numSerieFactura).toBe("A/1");
  });

  it("carries every substituted ticket when one F3 exchanges many (the N:1 fan-out)", async () => {
    const ticketA = await recordTicket(1);
    const ticketB = await recordTicket(2);
    const substitutionId = await substitute([ticketA, ticketB]);

    const rowA = await registro(ticketA);
    const rowB = await registro(ticketB);
    const substitution = await registro(substitutionId);
    expect(substitution.facturasSustituidas?.IDFacturaSustituida).toEqual([
      {
        IDEmisorFactura: rowA.idEmisorFactura,
        NumSerieFactura: rowA.numSerieFactura,
        FechaExpedicionFactura: toAeatDate(rowA.fechaExpedicionFactura),
      },
      {
        IDEmisorFactura: rowB.idEmisorFactura,
        NumSerieFactura: rowB.numSerieFactura,
        FechaExpedicionFactura: toAeatDate(rowB.fechaExpedicionFactura),
      },
    ]);
  });

  it("refuses duplicate ids in substitutedSaleIds — a ticket may be substituted at most once per F3", async () => {
    // Reject repeated ids before appending: each substituted invoice appears once in the record.
    const ticketId = await recordTicket(1);
    await expect(substitute([ticketId, ticketId])).rejects.toThrow(/duplicate/i);

    // Nothing chained: the till carries only the ticket's own F2 alta; the F3 was never appended.
    const rows = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, till.nodeId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipoFactura).toBe("F2");
  });

  it("carries the recipient the F3 must always name in Destinatarios", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);
    const substitution = await registro(substitutionId);

    expect(substitution.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: RECIPIENT.legalName, NIF: RECIPIENT.taxId }],
    });
  });

  it("does NOT annul the substituted tickets — no anulación registro is written for them", async () => {
    // The crux: the substituted tickets stay declared exactly once. There is no
    // anulación in this flow at all — `TipoFactura=F3` + `FacturasSustituidas` is what tells AEAT the
    // amount was already declared on the tickets, not any negation or annulment on our side.
    const ticketA = await recordTicket(1);
    const ticketB = await recordTicket(2);
    await substitute([ticketA, ticketB]);

    const rows = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, till.nodeId));
    // Every registro on this till is an alta — the two F2 tickets and the one F3 — and not one of
    // them is an anulación.
    expect(rows.map((r) => r.tipoRegistro).sort()).toEqual(["alta", "alta", "alta"]);
    // Each substituted ticket still has exactly its own single alta, untouched.
    for (const ticketId of [ticketA, ticketB]) {
      const ticketRows = rows.filter((r) => r.saleId === ticketId);
      expect(ticketRows).toHaveLength(1);
      expect(ticketRows[0]?.tipoRegistro).toBe("alta");
      expect(ticketRows[0]?.tipoFactura).toBe("F2");
    }
  });

  it("gives the substitution its own pending sidecar row, with nothing sent", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);
    const registro = await rawRegistro(substitutionId);

    const [sidecar] = await suite.db
      .select()
      .from(envios)
      .where(eq(envios.registroId, registro.id));
    expect(sidecar?.estado).toBe("pendiente");
    expect(sidecar?.intentos).toBe(0);
    expect(sidecar?.csv).toBeNull();
    expect(sidecar?.enviadoEn).toBeNull();
  });

  it("reconstructs the substituted ticket's calendar day exactly, even under a day-crossing offset", async () => {
    // The offset-cancellation `recordCorrection`/`recordVoid` prove (backend.ts): the ticket's stored
    // `date` (offset discarded) is re-rendered into FacturasSustituidas with the F3's own
    // offsetMinutes, and anchoring at midnight-UTC-minus-that-offset makes the shift land back on the
    // exact stored day for any offset. -780 (−13:00) rolls the calendar day off midnight UTC, so a
    // dropped cancellation term would render the WRONG day here.
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId], {
      offsetMinutes: -780,
      issuedAt: new Date("2026-03-02T13:05:00.000Z"),
    });

    const ticket = await registro(ticketId);
    const substitution = await registro(substitutionId);
    const substituted = substitution.facturasSustituidas?.IDFacturaSustituida[0];
    expect(substituted?.FechaExpedicionFactura).toBe(toAeatDate(ticket.fechaExpedicionFactura));
  });
});

describe("recordSubstitution from five callers started together", () => {
  // An F3 ALWAYS follows an existing ticket alta (recordSubstitution reads it, or throws), so the
  // chain head always exists before any F3 runs: this case never exercises `readChainHead`'s
  // create-the-head branch.
  //
  // Not a lock test. Five callers started together against the ONE handle are serialised by the
  // venue file's write queue: `withTransaction` (`packages/db/src/tenancy.ts`) runs inside
  // `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues `begin immediate` … `commit`.
  // Distinct, contiguous secuencias each linked to the predecessor's huella is exactly what a queue
  // that did NOT serialise would break, because appends reading the same head compute the same
  // next position.
  const RACERS = 5;

  it("commits five simultaneously-started substitutions into one gap-free, correctly-chained sequence", async () => {
    const ticketId = await recordTicket(1);
    const substitutionIds = await Promise.all(
      Array.from({ length: RACERS }, (_, i) => seedSubstitutionRow(i + 2)),
    );

    const substitutionSales = substitutionIds.map((id, i) => substitutionSaleFor(id, i + 2));
    // Started together and NOT awaited in turn: nothing but the write queue keeps the second out
    // while the first is open.
    const refs = await Promise.all(
      substitutionSales.map((sale) =>
        withTransaction(suite.db, (tx) =>
          backend.recordSubstitution(tx, sale, {
            substitutedSaleIds: [brandSaleId(ticketId)],
          }),
        ),
      ),
    );
    expect(refs).toHaveLength(RACERS);

    const rows = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, till.nodeId))
      .orderBy(asc(registrosFacturacion.secuencia));

    // Ticket at 1, the five F3s at 2..6 — distinct, contiguous, no gaps.
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.tipoFactura)).toEqual(["F2", "F3", "F3", "F3", "F3", "F3"]);
    // The chain walks cleanly: every record after the first points at its predecessor's huella. A
    // single lost race is precisely a crossed pair in the middle here.
    expect(rows[0]?.primerRegistro).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.anteriorHuella).toBe(rows[i - 1]?.huella);
    }
  });
});
