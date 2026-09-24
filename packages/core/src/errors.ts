// Makes this file a module, so the block below augments "@waitron/shared" rather than declaring
// a new ambient module of that name.
import "@waitron/shared";

/**
 * packages/core's error codes, added to the shared registry by declaration merging (see the note
 * atop packages/shared/src/errors.ts). `scripts/errors-reachable.test.ts` checks that this file
 * stays reachable from the package's `index.ts`.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A tender still has `settledAt: null`, so `settleSale` settles nothing and the sale stays
     * retryable. `recordSale`'s immediate settlement runs the same `settleSale`. */
    "sale.tender_unsettled": { tillId: string; saleId: string; unsettledCount: number };
    /** Every tender has settled, but `sum(amount) = total + sum(corrections) + sum(tip_amount)`
     * does not hold, where the corrections are the signed totals of this sale's corrective
     * invoices. Fires on overpayment as well as shortfall. The `sale_settlements_check_coverage`
     * trigger checks the same identity. */
    "sale.tender_shortfall": {
      tillId: string;
      saleId: string;
      due: string;
      charged: string;
    };
    /** `seriesId` names no row in `invoice_series`. */
    "sale.series_not_found": { seriesId: string };
    /** The series belongs to a different node. A series belongs to exactly one node: allocating
     * from another node's series would let two chains issue from one counter, which no constraint
     * downstream can detect. */
    "sale.series_wrong_node": { seriesId: string; expected: string; actual: string };
    /** The series is the wrong kind for the operation: `recordSale` and `recordSubstitution` demand
     * a `standard` series, `recordCorrection` a `rectificative` one. Corrective invoices are
     * numbered in their own series (RD 1619/2012 art. 6.1.a). */
    "sale.series_wrong_purpose": { seriesId: string; expected: string; actual: string };
    /** The series is retired: a restore retired it and opened a replacement, so numbering from it
     * would re-issue an invoice identity the tax agency may already hold. */
    "sale.series_retired": { seriesId: string; retiredAt: string };
    /** Registered, but nothing throws it: no path translates a `sales_series_invoice_number_key`
     * violation into this code. */
    "sale.number_reused": { seriesId: string; invoiceNumber: number };
    /**
     * `saleId` names no row in `sales`. An operational failure: "no fiscal condition blocks a
     * void" is about chain-integrity failures, not about there being nothing to void.
     */
    "sale.not_found": { saleId: string };
    /** Thrown by `recordVoid` for a sale that already has a `sale_voids` row: the translation of
     * `sale_voids_sale_id_key`'s unique violation, which is the control against double-voiding. */
    "sale.already_voided": { saleId: string };
    /** Thrown by `settleSale` when the sale is already settled, whichever check catches it: the
     * read of `sale_settlements` before writing, the `tenders_reject_post_settlement` trigger, or
     * the `sale_settlements_sale_key` unique violation. */
    "sale.already_settled": { saleId: string };
    /** The sale has been voided, so it can be neither settled (`settleSale`) nor corrected or
     * substituted (`recordCorrection`, `recordSubstitution`). Refused before anything is written.
     * Distinct from `sale.already_voided`, which is a second void of the same sale. */
    "sale.voided": { saleId: string };
    /** Thrown by `recordSubstitution` for a ticket that already has a `sale_substitutions` row:
     * the translation of `sale_substitutions_substituted_key`'s unique violation, so no ticket is
     * exchanged by two F3s. A duplicate id within one call's list is refused earlier, as a plain
     * Error. */
    "sale.already_substituted": { saleId: string };
    /** Thrown by `recordSale` when a caller-supplied `vatBreakdown`'s bases and taxes, summed and
     * compared by value, do not equal `total`. The breakdown is handed to the fiscal backend as
     * given, and a chained record that disagrees with its own total cannot be repaired. */
    "sale.total_mismatch": { declaredTotal: string; breakdownTotal: string };
    /** Never thrown: the write paths build it from a failed `FiscalBackend.checkIntegrity` and
     * record it as an incident. One code whatever issues the regime reported. */
    "chain.verification_failed": {
      tillId: string;
      /** Every issue from one check, in one incident: `incidents_open_dedup` allows one open
       * incident per (till, code, sale), so one row per issue would keep only the first. */
      issues: Array<{
        /** The module's own issue code — e.g. `predecessor-hash-mismatch` — never itself a
         * translation key: it is regime-specific and not registered on this shared surface. */
        issueCode: string;
        recordId: string | null;
        /** Carried verbatim, never re-rendered into prose. */
        issueParams: Record<string, unknown>;
      }>;
    };
  }
}
