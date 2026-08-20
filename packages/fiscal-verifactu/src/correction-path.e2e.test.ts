import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { computeHuella } from "@waitron/verifactu";
import type { SaleForFiscalRecord } from "@waitron/fiscal";
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
 * The end-to-end counterpart to `./write-path.e2e.test.ts`/`./void-path.e2e.test.ts`, for
 * `VerifactuBackend.recordCorrection` — the R5 rectificativa write path.
 *
 * **Real Postgres, not PGlite** (unlike those two, which use `usePgliteDb`): this slice's brief
 * calls for it, and the concurrency suite at the foot genuinely requires it — PGlite serialises
 * every query onto one backend, so a contention test on it is a false pass (CLAUDE.md §4). The
 * correctness suite runs the write path as the non-superuser deployment role (`withTenant` +
 * `asAppUser`, exactly `write-path.e2e.test.ts`'s shape) so RLS is genuinely enforced during the
 * append rather than bypassed by a superuser session.
 *
 * What this proves that the PGlite `backend.test.ts` refusals cannot: a rectificativa registro is a
 * real alta at the next chain position, its stored huella recomputes from its own columns
 * (including the negative `ImporteTotal`/`CuotaTotal` it hashes), its `FacturasRectificadas` carries
 * the ORIGINAL registro's exact stored identity, and it advances the same chain the original sits
 * on with its own `pendiente` sidecar — none of which a refusal-only test exercises.
 */
// A clone of the shared container's `core_fiscal` template (CORE + FISCAL).
const suite = useTemplateDb({ template: "core_fiscal" });

let backend: VerifactuBackend;
let till: SeededTill;
// A SECOND series, `purpose = 'rectificative'`, for the corrective sales — a rectificativa draws
// its number from its own series (RD 1619/2012 art. 6.1.a), and `sales` is unique on
// (tenant, series, invoice_number), so the corrective cannot reuse the original's series+number.
let rectificativeSeriesId: string;

beforeEach(async () => {
  // Each call mints a fresh tenant (and NIF), so tests never collide on the append-only,
  // TRUNCATE-blocking `registros_facturacion` — the same reseed-without-truncate reasoning
  // `chain.concurrency.test.ts` documents.
  till = await seedTill(suite.admin, "A");
  const series = await suite.admin.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose, next_number)
    values (${till.tenantId}, ${till.nodeId}, 'R', 'rectificative', 1)
    returning id
  `);
  rectificativeSeriesId = series.rows[0]!.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    // `db` is only read by `pendingCount`, which this suite never calls; `recordSale`/
    // `recordCorrection` act on the transaction they are handed. The admin connection suffices.
    db: suite.admin,
    resolveClient: staticResolver(fakeClient),
  });
});

/** The corrective's OWN data — a rectificativa por diferencias with negative lines and total. */
function correctiveSaleFor(saleId: string, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tenantId: till.tenantId,
    tillId: till.tillId,
    nodeId: till.nodeId,
    saleId: brandSaleId(saleId),
    // `seriesId` is never read by `recordCorrection` (it uses `seriesCode`/`invoiceNumber` for the
    // NumSerieFactura); branded only to satisfy the type. Enforcing that this is a `rectificative`
    // series is a core/Slice-4 concern, not the backend's.
    seriesId: brandSeriesId(rectificativeSeriesId),
    seriesCode: "R",
    invoiceNumber,
    issuedAt: new Date("2026-03-02T12:05:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Rectificacion por diferencias",
    total: decimal("-123.45"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("-102.02"), tax: decimal("-21.43") }],
    counterparty: null,
  };
}

/** The original simplified (F2) sale: `counterparty: null`, positive totals. `seriesCode` "A" →
 * NumSerieFactura "A/1". */
function originalSaleFor(saleId: string, invoiceNumber: number): SaleForFiscalRecord {
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

/** Records the original F2 alta (seeding its `sales` row first) under the deployment role. Returns
 * the original sale's id — the `correctsSaleId` a correction points at. */
async function recordOriginal(): Promise<string> {
  const originalId = await seedSale(suite.admin, till, 1);
  await withTenant(suite.admin, till.tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.recordSale(tx, originalSaleFor(originalId, 1));
  });
  return originalId;
}

/** Inserts one corrective `sales` row (negative total + `corrects_sale_id`, allowed by migration
 * 0013's relaxed check) as the RLS-bypassing admin, returning its generated id. */
async function seedCorrectiveRow(
  invoiceNumber: number,
  correctsSaleId: string,
  total: string,
): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into sales (tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
                       issued_offset_minutes, total, vat_breakdown, corrects_sale_id,
                       locale, invoice_locales, fiscal_backend, fiscal_state)
    values (${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${rectificativeSeriesId}, ${invoiceNumber},
            '2026-03-02T12:05:00+01:00', 60, ${total}, '[]'::jsonb, ${correctsSaleId},
            'es', array['es'], 'verifactu', 'recorded')
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedCorrectiveRow inserted nothing");
  return row.id;
}

/** Records one correction against `correctsSaleId` under the deployment role, seeding its own
 * corrective `sales` row first. Returns the corrective sale's id. */
async function correct(
  correctsSaleId: string,
  overrides: Partial<SaleForFiscalRecord> = {},
): Promise<string> {
  const invoiceNumber = overrides.invoiceNumber ?? 1;
  const total = overrides.total ?? "-123.45";
  const correctiveId = await seedCorrectiveRow(invoiceNumber, correctsSaleId, total);
  const sale = { ...correctiveSaleFor(correctiveId, invoiceNumber), ...overrides };
  await withTenant(suite.admin, till.tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.recordCorrection(tx, sale, { correctsSaleId: brandSaleId(correctsSaleId) });
  });
  return correctiveId;
}

/** One `select *` row in the raw snake_case `RegistroRow` shape `fromRegistroRow`/`computeHuella`
 * need — a correction's registro is the only one carrying its OWN (corrective) sale id, so this is
 * unambiguous (unlike a voided sale, whose alta and anulación share one sale id). */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await suite.admin.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return row;
}

describe("recordCorrection against the real Veri*Factu backend", () => {
  it("records the correction as an R5 / I rectificativa at the next chain position", async () => {
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);

    const [row] = await suite.admin
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, correctiveId));
    expect(row?.tipoRegistro).toBe("alta");
    expect(row?.tipoFactura).toBe("R5");
    expect(row?.tipoRectificativa).toBe("I");
    expect(row?.numSerieFactura).toBe("R/1");
    // Original at 1, correction at 2 — an alta takes the next secuencia in generation order.
    expect(row?.secuencia).toBe(2);
    expect(row?.primerRegistro).toBe(false);
  });

  it("stores a huella that recomputes from its own columns, hashing the negative ImporteTotal", async () => {
    // The strongest single assertion. `CuotaTotal`/`ImporteTotal` ARE huella inputs, so a
    // recompute that agrees with the stored huella proves the negative totals were the exact
    // literals hashed — a module that stored a positive total, or hashed a different record than it
    // persisted, passes nothing here.
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);
    const row = await rawRegistro(correctiveId);

    expect(row.importe_total).toBe("-123.45");
    expect(row.cuota_total).toBe("-21.43");
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });

  it("carries the original registro's exact stored identity in FacturasRectificadas", async () => {
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);

    const original = await rawRegistro(originalId);
    const corrective = await rawRegistro(correctiveId);
    // Read from the ORIGINAL row, not from the fixture: this is what pins "the original's exact
    // stored identity" rather than "a value that happens to match the fixture". The date is stored
    // on the original as `YYYY-MM-DD` and rendered into FacturasRectificadas as AEAT's `DD-MM-YYYY`.
    expect(corrective.facturas_rectificadas).toEqual({
      IDFacturaRectificada: [
        {
          IDEmisorFactura: original.id_emisor_factura,
          NumSerieFactura: original.num_serie_factura,
          FechaExpedicionFactura: toAeatDate(original.fecha_expedicion_factura),
        },
      ],
    });
    expect(original.num_serie_factura).toBe("A/1");
    // I mode: neither of the two S-only fields is populated.
    expect(corrective.facturas_sustituidas).toBeNull();
    expect(corrective.importe_rectificacion).toBeNull();
  });

  it("gives the correction its own pending sidecar row, with nothing sent", async () => {
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);
    const registro = await rawRegistro(correctiveId);

    const [sidecar] = await suite.admin
      .select()
      .from(envios)
      .where(eq(envios.registroId, registro.id));
    expect(sidecar?.estado).toBe("pendiente");
    expect(sidecar?.intentos).toBe(0);
    expect(sidecar?.csv).toBeNull();
    expect(sidecar?.enviadoEn).toBeNull();
  });

  it("reconstructs the rectified invoice's calendar day exactly, even under a day-crossing offset", async () => {
    // The offset-cancellation `recordVoid` proves (backend.ts): the original's stored `date` (offset
    // discarded) is re-rendered into FacturasRectificadas with the CORRECTIVE's own offsetMinutes,
    // and anchoring at midnight-UTC-minus-that-offset makes the shift land back on the exact stored
    // day for any offset. -780 (−13:00) rolls the calendar day off midnight UTC, so a dropped
    // cancellation term would render the WRONG day here — a moderate offset would not exercise it.
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId, {
      offsetMinutes: -780,
      issuedAt: new Date("2026-03-02T13:05:00.000Z"),
    });

    const original = await rawRegistro(originalId);
    const corrective = await rawRegistro(correctiveId);
    const rectified = corrective.facturas_rectificadas?.IDFacturaRectificada[0];
    expect(rectified?.FechaExpedicionFactura).toBe(toAeatDate(original.fecha_expedicion_factura));
  });
});

describe("recordCorrection under real chain contention", () => {
  // A correction ALWAYS follows an existing original alta (recordCorrection reads it, or throws), so
  // the chain head always exists before any correction runs — the from-empty head-creation race that
  // drives `appendToChain`'s 23505 retry (chain.concurrency.test.ts) is structurally unreachable
  // here. What real contention still exercises, and PGlite (one backend, serialised) cannot: several
  // corrections on distinct backends racing the SAME chain-head row lock must still serialise into a
  // gap-free, correctly-chained run of distinct secuencias, never a crossed pair or a duplicated
  // position (which `registros_tenant_node_secuencia_uq` would reject). Five, not the brief's minimal
  // two, for the same reason chain.concurrency runs twenty: a wider race is a stronger probe of the
  // same property.
  const RACERS = 5;

  it("commits several concurrent corrections into one gap-free, correctly-chained sequence", async () => {
    const originalId = await recordOriginal();
    const correctiveIds = await Promise.all(
      Array.from({ length: RACERS }, (_, i) => seedCorrectiveRow(i + 2, originalId, "-123.45")),
    );

    const dbs = await Promise.all(Array.from({ length: RACERS }, () => suite.pg.connect()));
    try {
      const sales = correctiveIds.map((id, i) => correctiveSaleFor(id, i + 2));
      const refs = await Promise.all(
        dbs.map((db, i) =>
          db.transaction((tx) =>
            backend.recordCorrection(tx, sales[i]!, { correctsSaleId: brandSaleId(originalId) }),
          ),
        ),
      );
      expect(refs).toHaveLength(RACERS);

      const rows = await suite.admin
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.nodeId, till.nodeId))
        .orderBy(asc(registrosFacturacion.secuencia));

      // Original at 1, the five corrections at 2..6 — distinct, contiguous, no gaps.
      expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rows.map((r) => r.tipoFactura)).toEqual(["F2", "R5", "R5", "R5", "R5", "R5"]);
      // The chain walks cleanly: every record after the first points at its predecessor's huella.
      // A single lost race is precisely a crossed pair in the middle here.
      expect(rows[0]?.primerRegistro).toBe(true);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]?.anteriorHuella).toBe(rows[i - 1]?.huella);
      }
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });
});
