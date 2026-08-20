import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { computeHuella } from "@waitron/verifactu";
import type { Counterparty, SaleForFiscalRecord } from "@waitron/fiscal";
import { decimal, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { fromRegistroRow, toAeatDate } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";

/**
 * The end-to-end counterpart to `./correction-path.e2e.test.ts`, for
 * `VerifactuBackend.recordSubstitution` — the F3 canje write path.
 *
 * **Real Postgres, not PGlite** (like `correction-path.e2e.test.ts`, unlike the pure-assembly
 * suites): the concurrency suite at the foot genuinely requires it — PGlite serialises every query
 * onto one backend, so a contention test on it is a false pass (CLAUDE.md §4). The correctness suite
 * runs the write path as the non-superuser deployment role (`withTenant` + `asAppUser`) so RLS is
 * enforced during the append rather than bypassed by a superuser session.
 *
 * What this proves that the PGlite `backend.test.ts` refusals cannot: an F3 registro is a real ALTA
 * at the next chain position (NOT an anulación, and NOT a rectificativa), its stored huella recomputes
 * from its own columns (including the POSITIVE `ImporteTotal`/`CuotaTotal` it hashes and its
 * `TipoFactura = F3`), its `FacturasSustituidas` carries each substituted ticket's exact stored
 * identity, its `Destinatarios` carries the recipient the F3 must always name, the substituted tickets
 * are NEVER annulled (no anulación registro appears for them — the crux of how AEAT avoids
 * double-counting: `TipoFactura=F3` + `FacturasSustituidas`, not negation), and it advances the same
 * chain the tickets sit on with its own `pendiente` sidecar.
 */
// A clone of the shared container's `core_fiscal` template (CORE + FISCAL).
const suite = useTemplateDb({ template: "core_fiscal" });

let backend: VerifactuBackend;
let till: SeededTill;
// A SECOND series for the F3 canje invoices. The F3 draws its own number, and `sales` is unique on
// (tenant, series, invoice_number), so an F3 cannot reuse a ticket's series+number. `purpose` is
// 'standard' rather than a bespoke 'substitution' value: the invoice_series CHECK admits only
// 'standard'/'rectificative' today, and giving F3 its own purpose is a core/Slice-4 decision (plan
// §5.3) the BACKEND does not enforce — it derives NumSerieFactura from `seriesCode`/`invoiceNumber`,
// never from this row.
let substitutionSeriesId: string;

const RECIPIENT: Counterparty = {
  taxId: "B12345678",
  legalName: "Cliente Empresarial SL",
  countryCode: "ES",
};

beforeEach(async () => {
  // Each call mints a fresh tenant (and NIF), so tests never collide on the append-only,
  // TRUNCATE-blocking `registros_facturacion` — the same reseed-without-truncate reasoning
  // `correction-path.e2e.test.ts` documents.
  till = await seedTill(suite.admin, "A");
  const series = await suite.admin.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose, next_number)
    values (${till.tenantId}, ${till.nodeId}, 'F3', 'standard', 1)
    returning id
  `);
  substitutionSeriesId = series.rows[0]!.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    // `db` is only read by `pendingCount`, which this suite never calls; `recordSale`/
    // `recordSubstitution` act on the transaction they are handed. The admin connection suffices.
    db: suite.admin,
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
    tenantId: till.tenantId,
    tillId: till.tillId,
    nodeId: till.nodeId,
    saleId: brandSaleId(saleId),
    // Never read by `recordSubstitution` (it uses `seriesCode`/`invoiceNumber` for NumSerieFactura);
    // branded only to satisfy the type, exactly as `correction-path`'s corrective fixture does.
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
    tenantId: till.tenantId,
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

/** Records one substituted F2 ticket (seeding its `sales` row first) under the deployment role.
 * Returns the ticket sale's id — a `substitutedSaleId` an F3 points at. */
async function recordTicket(invoiceNumber: number): Promise<string> {
  const ticketId = await seedSale(suite.admin, till, invoiceNumber);
  await withTenant(suite.admin, till.tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.recordSale(tx, ticketSaleFor(ticketId, invoiceNumber));
  });
  return ticketId;
}

/** Inserts one F3 `sales` row (positive total, `corrects_sale_id` NULL, the three counterparty_*
 * columns) as the RLS-bypassing admin, returning its generated id. */
async function seedSubstitutionRow(invoiceNumber: number): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into sales (tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
                       issued_offset_minutes, total, vat_breakdown,
                       counterparty_tax_id, counterparty_legal_name, counterparty_country_code,
                       locale, invoice_locales, fiscal_backend, fiscal_state)
    values (${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${substitutionSeriesId}, ${invoiceNumber},
            '2026-03-02T12:05:00+01:00', 60, '123.45', '[]'::jsonb,
            ${RECIPIENT.taxId}, ${RECIPIENT.legalName}, ${RECIPIENT.countryCode},
            'es', array['es'], 'verifactu', 'recorded')
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedSubstitutionRow inserted nothing");
  return row.id;
}

/** Records one F3 substituting `substitutedSaleIds` under the deployment role, seeding its own F3
 * `sales` row first. Returns the F3 sale's id. */
async function substitute(
  substitutedSaleIds: string[],
  overrides: Partial<SaleForFiscalRecord> = {},
): Promise<string> {
  const invoiceNumber = overrides.invoiceNumber ?? 1;
  const substitutionId = await seedSubstitutionRow(invoiceNumber);
  const sale = substitutionSaleFor(substitutionId, invoiceNumber, overrides);
  await withTenant(suite.admin, till.tenantId, async (tx) => {
    await asAppUser(tx);
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
  const { rows } = await suite.admin.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return row;
}

describe("recordSubstitution against the real Veri*Factu backend", () => {
  it("records the substitution as an F3 alta at the next chain position", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);

    const [row] = await suite.admin
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

    const ticket = await rawRegistro(ticketId);
    const substitution = await rawRegistro(substitutionId);
    // Read from the TICKET's row, not the fixture: this pins "the ticket's exact stored identity"
    // rather than "a value that happens to match the fixture". The date is stored on the ticket as
    // `YYYY-MM-DD` and rendered into FacturasSustituidas as AEAT's `DD-MM-YYYY`.
    expect(substitution.facturas_sustituidas).toEqual({
      IDFacturaSustituida: [
        {
          IDEmisorFactura: ticket.id_emisor_factura,
          NumSerieFactura: ticket.num_serie_factura,
          FechaExpedicionFactura: toAeatDate(ticket.fecha_expedicion_factura),
        },
      ],
    });
    expect(ticket.num_serie_factura).toBe("A/1");
  });

  it("carries every substituted ticket when one F3 exchanges many (the N:1 fan-out)", async () => {
    const ticketA = await recordTicket(1);
    const ticketB = await recordTicket(2);
    const substitutionId = await substitute([ticketA, ticketB]);

    const rowA = await rawRegistro(ticketA);
    const rowB = await rawRegistro(ticketB);
    const substitution = await rawRegistro(substitutionId);
    expect(substitution.facturas_sustituidas?.IDFacturaSustituida).toEqual([
      {
        IDEmisorFactura: rowA.id_emisor_factura,
        NumSerieFactura: rowA.num_serie_factura,
        FechaExpedicionFactura: toAeatDate(rowA.fecha_expedicion_factura),
      },
      {
        IDEmisorFactura: rowB.id_emisor_factura,
        NumSerieFactura: rowB.num_serie_factura,
        FechaExpedicionFactura: toAeatDate(rowB.fecha_expedicion_factura),
      },
    ]);
  });

  it("refuses duplicate ids in substitutedSaleIds — a ticket may be substituted at most once per F3", async () => {
    // Defense-in-depth (§5): a repeated id would emit a DOUBLED FacturasSustituidas entry into an
    // unrepairable filing. Rejected at this last layer before AEAT, regardless of what core passes.
    // Real PG so the deletion proof can observe the doubled entry actually chain: with the guard
    // removed, the loop reads the recorded F2 twice, builds a 2-entry FacturasSustituidas and appends
    // the F3 registro (its sales row is seeded by `substitute`), so both the reject AND the
    // nothing-chained assertion below flip.
    const ticketId = await recordTicket(1);
    await expect(substitute([ticketId, ticketId])).rejects.toThrow(/duplicate/i);

    // Nothing chained: the till carries only the ticket's own F2 alta; the F3 was never appended.
    const rows = await suite.admin
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, till.nodeId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipoFactura).toBe("F2");
  });

  it("carries the recipient the F3 must always name in Destinatarios", async () => {
    const ticketId = await recordTicket(1);
    const substitutionId = await substitute([ticketId]);
    const substitution = await rawRegistro(substitutionId);

    expect(substitution.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: RECIPIENT.legalName, NIF: RECIPIENT.taxId }],
    });
  });

  it("does NOT annul the substituted tickets — no anulación registro is written for them", async () => {
    // The crux (findings §10.2): the substituted tickets stay declared exactly once. There is no
    // anulación in this flow at all — `TipoFactura=F3` + `FacturasSustituidas` is what tells AEAT the
    // amount was already declared on the tickets, not any negation or annulment on our side.
    const ticketA = await recordTicket(1);
    const ticketB = await recordTicket(2);
    await substitute([ticketA, ticketB]);

    const rows = await suite.admin
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

    const [sidecar] = await suite.admin
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

    const ticket = await rawRegistro(ticketId);
    const substitution = await rawRegistro(substitutionId);
    const substituted = substitution.facturas_sustituidas?.IDFacturaSustituida[0];
    expect(substituted?.FechaExpedicionFactura).toBe(toAeatDate(ticket.fecha_expedicion_factura));
  });
});

describe("recordSubstitution under real chain contention", () => {
  // An F3 ALWAYS follows an existing ticket alta (recordSubstitution reads it, or throws), so the
  // chain head always exists before any F3 runs — the from-empty head-creation race is structurally
  // unreachable here, exactly as for `recordCorrection`. What real contention still exercises, and
  // PGlite (one backend, serialised) cannot: several F3s on distinct backends racing the SAME
  // chain-head row lock must still serialise into a gap-free, correctly-chained run of distinct
  // secuencias, never a crossed pair or a duplicated position (which
  // `registros_tenant_node_secuencia_uq` would reject). Five, like `correction-path`, for the same
  // reason: a wider race is a stronger probe of the same property.
  const RACERS = 5;

  it("commits several concurrent substitutions into one gap-free, correctly-chained sequence", async () => {
    const ticketId = await recordTicket(1);
    const substitutionIds = await Promise.all(
      Array.from({ length: RACERS }, (_, i) => seedSubstitutionRow(i + 2)),
    );

    const dbs = await Promise.all(Array.from({ length: RACERS }, () => suite.pg.connect()));
    try {
      const sales = substitutionIds.map((id, i) => substitutionSaleFor(id, i + 2));
      const refs = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            backend.recordSubstitution(tx, sales[i]!, {
              substitutedSaleIds: [brandSaleId(ticketId)],
            }),
          ),
        ),
      );
      expect(refs).toHaveLength(RACERS);

      const rows = await suite.admin
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
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
