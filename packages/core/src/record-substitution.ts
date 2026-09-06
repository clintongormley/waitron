// Side-effect only: registers this package's `sale.*` codes on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for why, and ./errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts). Mirrors ./record-sale.ts / ./record-correction.ts's identical convention.
import "./errors.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  allocateInvoiceNumber,
  invoiceSeries,
  isUniqueViolation,
  locations,
  saleLines,
  saleSubstitutions,
  saleVoids,
  sales,
  tills,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, decimal } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { Counterparty, FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";
import { buildVatBreakdown } from "./record-sale.js";
import type { RecordSaleLine } from "./record-sale.js";

export interface RecordSubstitutionInput {
  tenantId: TenantId;
  /**
   * The till this F3 rings at — an informational snapshot only (written to `sales.till_id` and the
   * fiscal record's `till_id`, and used for incidents). NOT checked against the series; see `nodeId`
   * below for the guard.
   */
  tillId: TillId;
  /**
   * The node/SIF that ISSUES this F3 and whose chain it extends (node-id rekey, 2026-08-03: the SIF
   * is the node, #33). Checked against the SERIES (`sale.series_wrong_node`, step 2) but NOT against
   * the substituted tickets' own nodes — and, as for a rectificativa, that is correct rather than a
   * gap: an F3 is a self-standing new full invoice that references the tickets only by IDENTITY
   * (`FacturasSustituidas`), so which SIF issues it is unconstrained (see `record-correction.ts`'s
   * `nodeId` doc for the same reasoning and its AEAT citation).
   */
  nodeId: NodeId;
  /**
   * The series the F3 draws its own new number from. v1 REUSES the ordinary `standard` series (owner
   * decision — no separate `'substitution'` purpose is added), so it is guarded exactly as
   * `recordSale`'s series is: it must exist for this tenant (`sale.series_not_found`), belong to
   * this node (`sale.series_wrong_node`) AND be `purpose='standard'` (`sale.series_wrong_purpose`) —
   * a series reserved for another purpose must not number an F3 (step 2). Supplied by the caller
   * exactly as `recordSale` is; no series is auto-provisioned.
   */
  seriesId: SeriesId;
  /**
   * The simplified (F2) tickets being exchanged for this one full invoice — one or many (the N:1
   * fan-out a rectificativa's single `correctsSaleId` does not have). An unknown id is `sale.not_found`. Must be non-empty and free of duplicates (both caller
   * preconditions, rejected in step 1 before any row is written); a ticket already exchanged by a
   * prior F3 is `sale.already_substituted`.
   */
  substitutedSaleIds: SaleId[];
  /**
   * The recipient (destinatario) — REQUIRED, because a full invoice must always name it (findings
   * §10.2, «siempre debe llevar el destinatario»). Written to the F3's `counterparty_*` columns and
   * passed NON-null into the fiscal record, where it becomes the record's `Destinatarios` block —
   * the one method whose `SaleForFiscalRecord.counterparty` is populated rather than null.
   */
  counterparty: Counterparty;
  /** The F3's OWN total — POSITIVE (an F3 restates the substituted operations; it is not a negative
   * rectificativa). `corrects_sale_id` is NULL, so the ordinary `total >= 0` arm of `sales_total_ck`
   * applies unchanged. */
  total: string;
  /** The F3's own (positive) lines — the aggregate of the substituted tickets. Same shape as an
   * ordinary sale's. */
  lines: RecordSaleLine[];
  /** The F3's own locale + invoice-locale list, supplied by the caller (unlike a rectificativa,
   * which inherits the original's): an F3 is a fresh full invoice and its rendering locale is a
   * till-UI choice, not a property carried from any one substituted ticket. */
  locale: string;
  invoiceLocales: string[];
  clock: TrustedClock;
}

/**
 * Records a *factura de canje* (AEAT `TipoFactura` F3) — a full invoice issued in SUBSTITUTION of
 * one or more previously-issued simplified tickets (F2), naming the customer's tax details, at a
 * later request for a proper invoice (spec §3.3, findings §10.2).
 *
 * An F3 is emphatically NOT a rectificativa and issues no credit note: the substituted tickets are
 * neither edited nor annulled — they stay recorded exactly once — and AEAT avoids double-counting
 * the amount because `TipoFactura = F3` plus the `FacturasSustituidas` block identifies the record
 * AS a substitution, not because anything is negated. So the F3 carries a POSITIVE total (its own),
 * `corrects_sale_id` NULL, and one `sale_substitutions` row per ticket it replaces (the generic-layer
 * N:1 projection of that link).
 *
 * The customer already paid on the ticket(s); the F3 introduces no new charge («no cobrar dos
 * veces», findings §10.2). It is therefore recorded UNSETTLED with no tender and no settlement,
 * mirroring how a rectificativa is recorded unsettled.
 *
 * No fiscal condition blocks it: a failed chain-integrity check records an incident and the F3
 * proceeds anyway, because a staff member issuing an invoice a customer is waiting for must never be
 * blocked by it (spec §5, «NUNCA debe interrumpirse») — the same rule `recordSale`/`recordCorrection`
 * follow.
 *
 * Takes a transaction handle, like every write in this package: atomicity between the F3 sale, its
 * substitution links and its fiscal record is the whole point, and step 7 (the caller's commit) is
 * what lets a till write them as one unit of work — a mixed batch that fails at the fiscal layer
 * (one ticket never recorded) rolls the whole thing back, chaining nothing.
 */
export async function recordSubstitution(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordSubstitutionInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  // Step 1. Caller preconditions on the ticket list, rejected before any read or write. Both are
  // programming errors the till UI must prevent, not operational conditions staff can act on, so
  // both are plain Errors (like the verifactu backend's own last-line defences) rather than `sale.*`
  // codes. The empty case would file a full invoice naming nothing it replaces; a DUPLICATE id would
  // double an F3's `FacturasSustituidas` entry and its `sale_substitutions` rows. "The caller passes
  // a valid list" is a property of the caller, not of this code (CLAUDE.md §3) — and the backend is
  // NOT trusted to dedup (defense-in-depth), so both are enforced here at the core layer too.
  if (input.substitutedSaleIds.length === 0) {
    throw new Error(
      "recordSubstitution: substitutedSaleIds must name at least one ticket — an F3 substitutes one or more simplified tickets",
    );
  }
  if (new Set(input.substitutedSaleIds).size !== input.substitutedSaleIds.length) {
    throw new Error(
      "recordSubstitution: substitutedSaleIds must not contain duplicate ids — a ticket may be substituted at most once per F3",
    );
  }

  // Step 1b. Every substituted ticket must exist; look up each by id.
  // Report the first missing id in input order so the caller knows which ticket is missing.
  const found = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(inArray(sales.id, input.substitutedSaleIds));
  const foundIds = new Set(found.map((row) => row.id));
  for (const substitutedSaleId of input.substitutedSaleIds) {
    if (!foundIds.has(substitutedSaleId)) {
      throw new AppError("sale.not_found", { saleId: substitutedSaleId });
    }
  }

  // Step 1c. Refuse to substitute a VOIDED ticket, reusing `sale.voided` exactly as
  // `./record-correction.ts` does: a ticket annulled because it should never have existed cannot be
  // exchanged for a full invoice. One scoped read for the whole batch; the first voided ticket in
  // input order is named.
  const voided = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(inArray(saleVoids.saleId, input.substitutedSaleIds));
  const voidedIds = new Set(voided.map((row) => row.saleId));
  for (const substitutedSaleId of input.substitutedSaleIds) {
    if (voidedIds.has(substitutedSaleId)) {
      throw new AppError("sale.voided", { saleId: substitutedSaleId });
    }
  }

  // Step 2. The series, and its guards. The F3 reuses the ordinary `standard` series (owner
  // decision — no separate `'substitution'` purpose), so it must draw its number from a
  // `purpose='standard'` series, exactly as `recordSale` does: a series reserved for another purpose
  // (a `rectificative` one) numbers a different kind of document «en todo caso» (RD 1619/2012 art.
  // 6.1.a), and drawing an F3's number from it would corrupt a legally significant, unrepairable
  // series. The purpose guard is the mirror of the one `./record-correction.ts` applies from its
  // side (which demands `rectificative`). The explicit tenant predicate mirrors `recordSale` and is
  // applied to the series lookup.
  const [series] = await tx
    .select({
      code: invoiceSeries.code,
      nodeId: invoiceSeries.nodeId,
      purpose: invoiceSeries.purpose,
      retiredAt: invoiceSeries.retiredAt,
    })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.id, input.seriesId), eq(invoiceSeries.tenantId, input.tenantId)));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    });
  }
  if (series.nodeId !== input.nodeId) {
    throw new AppError("sale.series_wrong_node", {
      seriesId: input.seriesId,
      expected: series.nodeId,
      actual: input.nodeId,
    });
  }
  if (series.purpose !== "standard") {
    throw new AppError("sale.series_wrong_purpose", {
      seriesId: input.seriesId,
      expected: "standard",
      actual: series.purpose,
    });
  }
  if (series.retiredAt !== null) {
    throw new AppError("sale.series_retired", {
      seriesId: input.seriesId,
      retiredAt: series.retiredAt.toISOString(),
    });
  }

  // Step 3. Art. 7.i verification, exactly as for an alta. Nothing branches on `verification.ok` — a
  // failed check records ONE aggregated incident (below, once `saleId` exists) and the F3 is chained
  // anyway. The table-wide `incidents_open_dedup` index holds at most one open incident per (tenant,
  // till, code, sale), so emitting one row per issue would collapse to a single row and drop every
  // issue after the first; `params.issues` carries them all. Mirrors `./record-sale.ts`.
  const verification = await backend.checkIntegrity(tx, input.tenantId, input.nodeId);
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
  // into both the `sales` row below and `SaleForFiscalRecord.issuedAt`/`offsetMinutes`, so the F3
  // sale and its fiscal record cannot carry different timestamps for one event.
  const now = input.clock.now();

  // Clock-confidence degraded is WARN ONLY, never blocking (spec §5) — `now.warning` is already a
  // fully-formed AppError, forwarded verbatim rather than reconstructed, exactly as `recordSale`.
  if (now.warning) {
    pending.push({ error: now.warning, severity: "warning" });
  }

  // Step 5. Allocation takes the series row lock and comes AFTER `checkIntegrity`'s chain-head lock,
  // never before: both stay held until commit, so every write path must take them chain-then-series
  // or two concurrent writers on one node deadlock — the chain-head lock is the per-node `cadenas`
  // row, which spans that node's tills (node-id rekey, 2026-08-03). The guard SELECTs above take no
  // persistent lock.
  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // The F3's VAT desglose, resolved ONCE so the SAME value feeds both the `sales` row below and
  // `backend.recordSubstitution` further down (spec 8a's single-source rule): storing it on
  // `sales.vat_breakdown` is a queryable copy of the already-filed data, never a second recompute.
  const vatBreakdown = buildVatBreakdown(input.lines);

  // Step 6. The F3 sale: a POSITIVE `total` (the ordinary `total >= 0` arm applies — `corrects_sale_id`
  // stays NULL, an F3 is not a rectificativa), `fiscalState: "recorded"`, the recipient written to the
  // three `counterparty_*` columns, and the caller-supplied `locale`/`invoiceLocales`. NO settlement
  // and NO tenders — the money was collected on the substituted tickets («no cobrar dos veces»).
  const [inserted] = await tx
    .insert(sales)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      nodeId: input.nodeId,
      seriesId: input.seriesId,
      vatBreakdown,
      invoiceNumber,
      issuedAt: now.instant.toISOString(),
      issuedOffsetMinutes: now.offsetMinutes,
      total: input.total,
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: backend.id,
      fiscalState: "recorded",
      counterpartyTaxId: input.counterparty.taxId,
      counterpartyLegalName: input.counterparty.legalName,
      counterpartyCountryCode: input.counterparty.countryCode,
    })
    .returning({ id: sales.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    // This unconditional INSERT returns its row or throws on a constraint violation.
    throw new Error("sales: insert returned no row");
  }
  /* v8 ignore stop */

  const saleId = inserted.id as SaleId;

  // Recorded now that `saleId` exists, on this same transaction — never a fresh connection, which
  // would let an incident commit for an F3 that later rolls back. Attached to the F3 sale (the one
  // this call created), matching `recordSale`/`recordCorrection`'s own deferral until `saleId` exists.
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

  // One `sale_substitutions` row per ticket — the N:1 fan-out. Inserted one at a time so a
  // `unique(tenant_id, substituted_sale_id)` violation NAMES the exact ticket that collides. That
  // unique — not this insert's success — is the real "substituted at most once" control: two
  // concurrent F3s exchanging one ticket both pass any prior SELECT, and only one passes the
  // constraint. Ordered BEFORE the fiscal write so a rejected substitution consumes no chain work,
  // exactly as `recordVoid` orders its `sale_voids` insert before `backend.recordVoid`.
  for (const substitutedSaleId of input.substitutedSaleIds) {
    try {
      await tx.insert(saleSubstitutions).values({
        tenantId: input.tenantId,
        substitutionSaleId: saleId,
        substitutedSaleId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A translation, not a recovery: the transaction is already aborted by Postgres and must
        // roll back. Catching here only ensures the caller gets a structured code instead of a raw
        // driver error, exactly as `recordVoid` translates its double-void unique violation.
        throw new AppError("sale.already_substituted", { saleId: substitutedSaleId });
      }
      throw error;
    }
  }

  const [location] = await tx
    .select({ operationDescription: locations.operationDescription })
    .from(tills)
    .innerJoin(locations, eq(locations.id, tills.locationId))
    .where(and(eq(tills.id, input.tillId), eq(tills.tenantId, input.tenantId)));

  /* v8 ignore start */
  if (location === undefined) {
    // Structurally unreachable given the schema: `tills.location_id` is a NOT NULL foreign key, so
    // a till that exists joins to exactly one location. Reaching here means the till does not exist
    // or the tenant predicate excluded it — a caller programming error, not a fiscal condition.
    throw new Error(`recordSubstitution: no location found for till ${input.tillId}`);
  }
  /* v8 ignore stop */

  // Step 7. Behind this one call the module builds the F3 registro — its own next `secuencia`, its
  // own huella over the positive totals, `TipoFactura = F3`, the `FacturasSustituidas` block naming
  // each ticket's stored identity, and the `Destinatarios` block from `counterparty` — advances its
  // chain and inserts its pending-submission row, all on this transaction. `counterparty` is passed
  // NON-null: an F3 is the one path that carries a recipient. A ticket the module never recorded
  // makes this throw (`fiscal.sale_not_recorded`), rolling back everything above with nothing chained.
  const fiscal = await backend.recordSubstitution(
    tx,
    {
      tenantId: input.tenantId,
      tillId: input.tillId,
      nodeId: input.nodeId,
      saleId,
      seriesId: input.seriesId,
      seriesCode: series.code,
      invoiceNumber,
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
      descriptionOfOperation: location.operationDescription,
      total: decimal(input.total),
      // The SAME breakdown stored on `sales.vat_breakdown` above — one variable feeds both (spec 8a).
      vatBreakdown,
      counterparty: input.counterparty,
    },
    { substitutedSaleIds: input.substitutedSaleIds },
  );

  // Step 8 is the caller's. Returning inside the transaction rather than committing here lets the
  // till write the F3, its substitution links and its fiscal record as one unit of work.
  return { saleId, fiscal };
}
