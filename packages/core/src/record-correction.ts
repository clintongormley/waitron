// Side-effect only: registers this package's `sale.*` codes on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for why, and ./errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts). Mirrors ./record-sale.ts / ./record-void.ts's identical convention.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  locations,
  saleLines,
  saleVoids,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, decimal } from "@waitron/shared";
import type { SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { buildVatBreakdown } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";

export interface RecordCorrectionInput {
  tenantId: TenantId;
  /**
   * The till/SIF that ISSUES this rectificativa and whose chain it extends. Caller-supplied and used
   * verbatim: checked against the corrective SERIES (`sale.series_wrong_till`, step 2) but NOT against
   * the original sale's own `tillId` — and that is correct, not a gap. A rectificativa is a
   * self-standing NEW invoice that references the original only by IDENTITY (`FacturasRectificadas` =
   * NIF + serie&número + fecha — how AEAT links a rectificativa to what it corrects), so which SIF
   * issues it is unconstrained. This is not merely theoretical: under active-active / failover
   * (server-as-SIF, #33) a venue runs MORE THAN ONE SIF (each server is its own SIF), so a correction
   * genuinely can land on a different server-SIF than the original. AEAT's developer FAQ (4-Dec-2025)
   * confirms that is lawful for the sibling correction records — an RF de subsanación or de anulación
   * «se [podría] generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió la
   * factura original» (same-SIF is merely the usual case). Extending that permission to a
   * self-standing rectificativa is OUR inference, not the FAQ's words — it names only the
   * subsanación/anulación records; the reading is sound because a rectificativa links by identity
   * (above), but it is unverified for rectificativas specifically and to be confirmed with the
   * asesor before a real cross-SIF till caller is wired (F3). (`recordVoid` pins to the original's
   * `tillId` by its own choice, not a
   * regime requirement.) The chain is keyed per `till_id` today; the server-as-SIF `server_id` rekey
   * re-keys it to the server.
   */
  tillId: TillId;
  /**
   * MUST name a `purpose='rectificative'` series (spec §5). A correction draws its own new number
   * from a corrective series — never the ordinary one the corrected sale used — and this is guarded
   * (`sale.series_wrong_purpose`), never inferred. The caller supplies it exactly as it supplies the
   * `standard` series for `recordSale`; no series is auto-provisioned.
   */
  seriesId: SeriesId;
  /** The earlier sale being corrected. Read RLS-scoped, so a cross-tenant id is `sale.not_found`. */
  correctsSaleId: SaleId;
  /**
   * The corrective invoice's OWN total — negative for a full or partial reversal, allowed on `sales`
   * only because `corrects_sale_id` is set (the relaxed `sales_total_ck`, migration 0013). This is
   * a delta-in model: the caller supplies the already-signed figure the corrective reports, and it
   * flows verbatim into the fiscal record's own total, so it must be the value that record needs.
   */
  total: string;
  /** The already-signed delta lines (negative for a reversal). Same shape as an ordinary sale's. */
  lines: RecordSaleLine[];
  fiscalBackend: string;
  clock: TrustedClock;
}

/**
 * Records a corrective invoice (a credit note / rectificativa) for a prior sale, spec §4.2.
 *
 * Structurally a hybrid of `./record-sale.ts` (it mints its OWN new number and writes its own sale
 * row) and `./record-void.ts` (it references an earlier sale rather than a working order). Unlike a
 * sale it settles NOTHING — the corrective is recorded unsettled and the customer refund is a
 * separate payments-layer action (decoupled refund, spec §4). Unlike a void it takes a number of
 * its own, because a correction is a fresh registro de alta pointing at the invoice it corrects, not
 * an annulment of it.
 *
 * No fiscal condition blocks a correction: a failed chain-integrity check records an incident and
 * the correction proceeds anyway, because a staff member correcting the very sale an incident
 * concerns must never be blocked by it (spec §5, «NUNCA debe interrumpirse») — the same rule
 * `recordSale`/`recordVoid` follow.
 *
 * Issues on the caller-supplied `input.tillId`, NOT the original sale's till — see that field's doc
 * for the open cross-till fiscal-policy question a future till caller must resolve first.
 *
 * Takes a transaction handle, like every write in this package: atomicity between the corrective
 * sale and its fiscal record is the whole point, and step 7 (the caller's commit) is what lets a
 * till write the correction and its fiscal record as one unit of work.
 */
export async function recordCorrection(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordCorrectionInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // Step 1. The original sale, RLS-scoped and tenant-unqualified exactly as `./record-void.ts`:
  // RLS filters a row belonging to another tenant, so a cross-tenant original is genuinely
  // not-found rather than forbidden — the right answer to leak. `locale`/`invoiceLocales` are read
  // here because the corrective INHERITS them (spec §9: a corrective invoice inherits the original
  // list); they are not supplied on the input.
  const [original] = await tx
    .select({ locale: sales.locale, invoiceLocales: sales.invoiceLocales })
    .from(sales)
    .where(eq(sales.id, input.correctsSaleId));

  if (original === undefined) {
    throw new AppError("sale.not_found", { saleId: input.correctsSaleId });
  }

  // Step 1b. Refuse to correct a VOIDED sale (ratified decision, spec §4). A sale that should never
  // have existed is annulled, not corrected; correcting an already-annulled sale is a staff/UI
  // error. Reuses `sale.voided`, RLS-scoped like the lookup above.
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.correctsSaleId));

  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.correctsSaleId });
  }

  // Step 2. The corrective series, and the purpose guard that IS the §5 separation. A correction
  // must draw from a `purpose='rectificative'` series; an ordinary sale must not (the mirror guard
  // lives in `./record-sale.ts`). The explicit tenant predicate mirrors `recordSale` and is
  // redundant under RLS but guards a non-scoped connection too.
  const [series] = await tx
    .select({
      code: invoiceSeries.code,
      tillId: invoiceSeries.tillId,
      purpose: invoiceSeries.purpose,
    })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.id, input.seriesId), eq(invoiceSeries.tenantId, input.tenantId)));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    });
  }
  if (series.tillId !== input.tillId) {
    throw new AppError("sale.series_wrong_till", {
      seriesId: input.seriesId,
      expected: series.tillId,
      actual: input.tillId,
    });
  }
  if (series.purpose !== "rectificative") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId: input.seriesId,
      expected: "rectificative",
      actual: series.purpose,
    });
  }

  // Step 3. Art. 7.i verification, exactly as for an alta. Nothing branches on `verification.ok` —
  // a failed check records ONE aggregated incident (below, once `saleId` exists) and the correction
  // is chained anyway. The table-wide `incidents_open_dedup` index holds at most one open incident
  // per (tenant, till, code, sale), so emitting one row per issue would collapse to a single row and
  // drop every issue after the first; `params.issues` carries them all. Mirrors `./record-sale.ts`.
  const verification = await backend.checkIntegrity(tx, input.tenantId, input.tillId);
  const pending: Array<{ error: AppError; severity: IncidentSeverity }> = [];
  if (verification.issues.length > 0) {
    pending.push({
      error: new AppError("chain.verification_failed", {
        tillId: input.tillId,
        issues: verification.issues.map((issue) => ({
          issueCode: issue.code,
          recordId: issue.recordId ?? null,
          issueParams: issue.params,
        })),
      }),
      severity: "error",
    });
  }

  // Step 4. One clock reading for the whole transaction — the SAME `instant`/`offsetMinutes` travel
  // into both the `sales` row below and `SaleForFiscalRecord.issuedAt`/`offsetMinutes`, so the
  // corrective sale and its fiscal record cannot carry different timestamps for one event.
  const now = input.clock.now();

  // Clock-confidence degraded is WARN ONLY, never blocking (spec §5) — `now.warning` is already a
  // fully-formed AppError, forwarded verbatim rather than reconstructed, exactly as `recordSale`.
  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  // Step 5. Allocation takes the series row lock and comes AFTER `checkIntegrity`'s chain-head lock,
  // never before: both stay held until commit, so every write path must take them chain-then-series
  // or two concurrent writers on one till deadlock. The guard SELECTs above take no persistent lock,
  // so they do not affect that order.
  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // Step 6. The corrective sale: a negative `total` (allowed by the relaxed CHECK because
  // `corrects_sale_id` is set), `fiscalState: "recorded"`, and `locale`/`invoiceLocales` inherited
  // from the original. NO settlement and NO tenders — the refund is decoupled (spec §4).
  const [inserted] = await tx
    .insert(sales)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      seriesId: input.seriesId,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: input.total,
      locale: original.locale,
      invoiceLocales: original.invoiceLocales,
      fiscalBackend: input.fiscalBackend,
      fiscalState: "recorded",
      correctsSaleId: input.correctsSaleId,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // Unreachable for the same reason as `recordSale`: this INSERT carries no WHERE clause, and
    // RLS's WITH CHECK fails a mismatched tenant with an error rather than inserting zero rows.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // Recorded now that `saleId` exists, on this same transaction — never a fresh connection, which
  // would let an incident commit for a correction that later rolls back. Attached to the CORRECTIVE
  // sale (the one this call created), matching `recordSale`'s own deferral until `saleId` exists.
  for (const incident of pending) {
    await recordIncident(tx, {
      tenantId: input.tenantId,
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }

  await tx.insert(saleLines).values(
    input.lines.map((line) => ({
      tenantId: input.tenantId,
      saleId,
      lineNo: line.lineNo,
      descriptions: line.descriptions,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
  );

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(and(eq(tills.id, input.tillId), eq(tills.tenantId, input.tenantId)));

  /* v8 ignore start */
  if (location === undefined) {
    // Structurally unreachable given the schema: `tills.location_id` is a NOT NULL foreign key, so
    // a till that exists joins to exactly one location. Reaching here means the till does not exist
    // or RLS hid another tenant's — a caller programming error, not a fiscal condition.
    throw new Error(`recordCorrection: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  // Step 7. Behind this one call the module reads the ORIGINAL's stored fiscal identity (by
  // `correctsSaleId`), builds the corrective fiscal record referencing it, advances its own chain,
  // and inserts its own pending-submission row — all on this transaction. Built exactly as
  // `recordSale` builds `SaleForFiscalRecord`, with `counterparty: null`: this task wires no
  // recipient-identified (B2B) correction, so the reachable corrective is of a simplified invoice.
  const fiscal = await backend.recordCorrection(
    tx,
    {
      tenantId: input.tenantId,
      tillId: input.tillId,
      saleId,
      seriesId: input.seriesId,
      seriesCode: series.code,
      invoiceNumber,
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
      descriptionOfOperation: location.operationDescription,
      total: decimal(input.total),
      vatBreakdown: buildVatBreakdown(input.lines),
      counterparty: null,
    },
    { correctsSaleId: input.correctsSaleId },
  );

  // Step 8 is the caller's. Returning inside the transaction rather than committing here lets the
  // till write the correction and its fiscal record as one unit of work.
  return { saleId, fiscal };
}
