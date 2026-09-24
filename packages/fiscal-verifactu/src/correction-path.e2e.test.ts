import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { invoiceSeries, sales, withTransaction } from "@waitron/db";
import { computeHuella } from "@waitron/verifactu";
import type { SaleForFiscalRecord } from "@waitron/fiscal";
import {
  decimal,
  decimalToCents,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
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
 * Record an R5 correction, including callers that start together. Check its chain position,
 * recomputed hash, original invoice identity and pending sidecar.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let till: SeededTill;
// A SECOND series, `purpose = 'rectificative'`, for the corrective sales — a rectificativa draws
// its number from its own series (RD 1619/2012 art. 6.1.a), and `sales` is unique on
// (series_id, invoice_number), so the corrective cannot reuse the original's series+number.
let rectificativeSeriesId: string;

beforeEach(async () => {
  till = await seedTill(suite.db, "A");
  // Through the table: `id` and `created_at` are `$defaultFn` generators that only the insert
  // BUILDER runs.
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId: till.nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  rectificativeSeriesId = series!.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    // `db` is only read by `pendingCount`, which this suite never calls; `recordSale`/
    // `recordCorrection` act on the transaction they are handed.
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** The corrective's OWN data — a rectificativa por diferencias with negative lines and total. */
function correctiveSaleFor(saleId: string, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tillId: till.tillId,
    nodeId: till.nodeId,
    saleId: brandSaleId(saleId),
    // `seriesId` is never read by `recordCorrection` (it uses `seriesCode`/`invoiceNumber` for the
    // NumSerieFactura); branded only to satisfy the type. Enforcing that this is a `rectificative`
    // series is a core concern, not the backend's.
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

/** Records the original F2 alta (seeding its `sales` row first). Returns the original sale's id —
 * the `correctsSaleId` a correction points at. */
async function recordOriginal(): Promise<string> {
  const originalId = await seedSale(suite.db, till, 1);
  await withTransaction(suite.db, async (tx) => {
    await backend.recordSale(tx, originalSaleFor(originalId, 1));
  });
  return originalId;
}

/** Insert a corrective sale and return its id. */
async function seedCorrectiveRow(
  invoiceNumber: number,
  correctsSaleId: string,
  total: Decimal,
): Promise<string> {
  // Through the table: `id` and `created_at` are builder-side `$defaultFn` generators a raw insert
  // never reaches.
  const [row] = await suite.db
    .insert(sales)
    .values({
      tillId: till.tillId,
      nodeId: till.nodeId,
      seriesId: rectificativeSeriesId,
      invoiceNumber,
      issuedAt: "2026-03-02T12:05:00+01:00",
      issuedOffsetMinutes: 60,
      total: decimalToCents(total),
      vatBreakdown: [],
      correctsSaleId,
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  if (row === undefined) throw new Error("seedCorrectiveRow inserted nothing");
  return row.id;
}

/** Records one correction against `correctsSaleId`, seeding its own corrective `sales` row first.
 * Returns the corrective sale's id. */
async function correct(
  correctsSaleId: string,
  overrides: Partial<SaleForFiscalRecord> = {},
): Promise<string> {
  const invoiceNumber = overrides.invoiceNumber ?? 1;
  const total = overrides.total ?? decimal("-123.45");
  const correctiveId = await seedCorrectiveRow(invoiceNumber, correctsSaleId, total);
  const sale = { ...correctiveSaleFor(correctiveId, invoiceNumber), ...overrides };
  await withTransaction(suite.db, async (tx) => {
    await backend.recordCorrection(tx, sale, { correctsSaleId: brandSaleId(correctsSaleId) });
  });
  return correctiveId;
}

/** One `select *` row in the raw snake_case `RegistroRow` shape `fromRegistroRow`/`computeHuella`
 * need — a correction's registro is the only one carrying its OWN (corrective) sale id, so this is
 * unambiguous (unlike a voided sale, whose alta and anulación share one sale id). */
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
 * hashes, which needs the snake_case shape. */
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
    facturasRectificadas: RegistroRow["facturas_rectificadas"];
    facturasSustituidas: RegistroRow["facturas_sustituidas"];
  };
}

describe("recordCorrection against the real Veri*Factu backend", () => {
  it("records the correction as an R5 / I rectificativa at the next chain position", async () => {
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);

    const [row] = await suite.db
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

    // Through the TABLE, not `rawRegistro`: a raw `select *` skips drizzle's read mapping, so
    // `facturas_rectificadas` would come back as the stored JSON text rather than an object.
    const original = await registro(originalId);
    const corrective = await registro(correctiveId);
    // Read from the ORIGINAL row, not from the fixture: this is what pins "the original's exact
    // stored identity" rather than "a value that happens to match the fixture". The date is stored
    // on the original as `YYYY-MM-DD` and rendered into FacturasRectificadas as AEAT's `DD-MM-YYYY`.
    expect(corrective.facturasRectificadas).toEqual({
      IDFacturaRectificada: [
        {
          IDEmisorFactura: original.idEmisorFactura,
          NumSerieFactura: original.numSerieFactura,
          FechaExpedicionFactura: toAeatDate(original.fechaExpedicionFactura),
        },
      ],
    });
    expect(original.numSerieFactura).toBe("A/1");
    // I mode: neither of the two S-only fields is populated.
    expect(corrective.facturasSustituidas).toBeNull();
    expect(corrective.importeRectificacion).toBeNull();
  });

  it("gives the correction its own pending sidecar row, with nothing sent", async () => {
    const originalId = await recordOriginal();
    const correctiveId = await correct(originalId);
    const registro = await rawRegistro(correctiveId);

    const [sidecar] = await suite.db
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

    // Through the TABLE, same reason as the FacturasRectificadas case above.
    const original = await registro(originalId);
    const corrective = await registro(correctiveId);
    const rectified = corrective.facturasRectificadas?.IDFacturaRectificada[0];
    expect(rectified?.FechaExpedicionFactura).toBe(toAeatDate(original.fechaExpedicionFactura));
  });
});

describe("recordCorrection from five callers started together", () => {
  // A correction ALWAYS follows an existing original alta (recordCorrection reads it, or throws), so
  // the chain head always exists before any correction runs: this case never exercises
  // `readChainHead`'s create-the-head branch.
  //
  // Not a lock test. Five callers started together against the ONE handle are serialised by the
  // venue file's write queue: `withTransaction` (`packages/db/src/tenancy.ts`) runs inside
  // `db.withWriteLock`, and `packages/store/src/write-queue.ts` issues `begin immediate` … `commit`.
  // The chain's own guarantee — distinct, contiguous secuencias, each record linked to its
  // predecessor's huella — is exactly what a queue that did NOT serialise would break, and
  // `registros_tenant_node_secuencia_uq` refuses a duplicate position whatever wrote it.
  // Control: with `withTransaction` replaced by a bare `backend.recordCorrection(...)` call, this
  // case fails with `no such savepoint`.
  const RACERS = 5;

  it("commits five simultaneously-started corrections into one gap-free, correctly-chained sequence", async () => {
    const originalId = await recordOriginal();
    const correctiveIds = await Promise.all(
      Array.from({ length: RACERS }, (_, i) =>
        seedCorrectiveRow(i + 2, originalId, decimal("-123.45")),
      ),
    );

    const correctiveSales = correctiveIds.map((id, i) => correctiveSaleFor(id, i + 2));
    // Started together and NOT awaited in turn: nothing but the write queue keeps the second out
    // while the first is open.
    const refs = await Promise.all(
      correctiveSales.map((sale) =>
        withTransaction(suite.db, (tx) =>
          backend.recordCorrection(tx, sale, { correctsSaleId: brandSaleId(originalId) }),
        ),
      ),
    );
    expect(refs).toHaveLength(RACERS);

    const rows = await suite.db
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
  });
});
