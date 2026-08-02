// A bare side-effect import, not a value used anywhere in this file. It is what makes TypeScript
// treat "@waitron/shared" as a real module to augment rather than defining a fresh ambient module
// of the same name — the same idiom packages/db/src/errors.ts, packages/fiscal/src/errors.ts and
// packages/fiscal-verifactu/src/errors.ts already use for their own contributions.
import "@waitron/shared";

/**
 * packages/core's own contribution to the shared error registry, added by declaration merging
 * rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/core adds its own codes without packages/shared knowing about them in advance.
 *
 * **Deviation from Task 16's brief.** The brief's Step 1 said to append five members
 * (`sale.tender_unsettled`, `sale.tender_shortfall`, `sale.series_not_found`,
 * `sale.series_wrong_till`, `sale.number_reused`) directly to `packages/shared/src/errors.ts`'s
 * `ErrorCode` union. That is wrong under this repo's OWN documented, already-precedented
 * convention (see `packages/shared/src/errors.ts`'s design note, and Task 13's identical
 * correction in `packages/fiscal-verifactu/src/errors.ts`, and Task 14's in the same file): only
 * codes NATIVE to `packages/shared` itself (`ids.ts`, `money.ts`) belong in that file's own
 * registry; every dependent package — `packages/db`, `packages/fiscal`,
 * `packages/fiscal-verifactu`, and now `packages/core` — contributes its own by
 * `declare module "@waitron/shared"` from its OWN source, exactly as this file does. Overridden
 * here for the identical reason those three files already give: `packages/shared` must never
 * change just because a dependent package adds a code, and the namespace convention is
 * DOMAIN-CONCEPT, lowercase, dot-namespaced (`sale.*`) — never the throwing package's name
 * (never `core.*`).
 *
 * `sale.number_reused` is registered here per the brief's own instruction, for the constraint-
 * violation translation a later task adds — no `throw` in this package raises it yet, so
 * `errors.reachability.test.ts`'s check (this file is reachable from `./index.ts`) is the only
 * thing keeping it visible outside this package until then.
 *
 * Reachability: this file is a side-effect import of `./record-sale.ts` (`import "./errors.js"`),
 * which is re-exported from `./index.ts`, so this augmentation is transitively reachable from the
 * package's own public barrel. See `./errors.reachability.test.ts`, which mirrors
 * `packages/db/src/errors.reachability.test.ts`'s identical mechanical check for the same
 * property.
 *
 * **Task 17 addition.** The brief for `recordVoid` said to append `sale.not_found` and
 * `sale.already_voided` directly to `packages/shared/src/errors.ts`'s `ErrorCode` union — the
 * identical, already-corrected-twice mistake this file's own header above already explains: only
 * codes native to `packages/shared` itself belong there. Added here instead, alongside every other
 * `sale.*` code, by the same `declare module` this file already uses.
 *
 * **Task 18 addition.** `chain.verification_failed`, for the identical reason and by the
 * identical mechanism: the brief said to append it directly to
 * `packages/shared/src/errors.ts`'s `ErrorCode` union, which is the same already-corrected
 * mistake as above. Filed here rather than in `packages/fiscal`/`packages/fiscal-verifactu`
 * because `checkIntegrity`'s real `IntegrityIssue.code` is a regime-specific, ad hoc string (e.g.
 * `predecessor-hash-mismatch` — see `packages/fiscal-verifactu/src/verify.ts`), not an `ErrorCode`
 * at all: `IntegrityReport`/`IntegrityIssue` (`packages/fiscal/src/backend.ts`) are typed
 * `{ code: string; params: Record<string, unknown> }` specifically so a regime module never has
 * to register a member on the shared registry per issue kind. `./record-sale.ts`/`./record-void.ts`
 * are what translate "verification failed" into a stable, translatable incident code — one
 * generic code regardless of which specific issues the module reported, and one incident per
 * (sale) carrying ALL of that call's issues in `params.issues` rather than one row per issue — and
 * it is this translation, done in `packages/core`, that needs the registered `ErrorCode`.
 * Aggregating rather than emitting a row per issue is what makes the incident write agree with the
 * table-wide `incidents_open_dedup` invariant: that partial unique index holds at most one open
 * incident per (tenant, till, code, sale), so N same-key rows would silently collapse to one and
 * lose detail — carrying every issue under one row keeps all of it. `clock.degraded`
 * needs no such addition here: it is already registered by `packages/fiscal/src/errors.ts` (Task
 * 10), and `./record-sale.ts` reuses `TrustedReading.warning` — an `AppError` already carrying
 * that exact code — verbatim rather than re-deriving it.
 *
 * **Sale-settlement model addition (2026-08-01).** Two codes added — `sale.already_settled` and
 * `sale.voided` — and two RE-SHAPED: `sale.tender_unsettled` and `sale.tender_shortfall` now carry
 * `saleId` where they carried `workingOrderId`, because both are now raised by the settlement path
 * (`settleSale`, and `recordSale`'s inline `settlement:{kind:"immediate"}` half that calls the same
 * code) — which holds a `saleId` and no `workingOrderId` (design §4, decision 2). The CODES are
 * unchanged, only their params: codes are never renamed once shipped, so a param re-shape is the
 * only move available. `sale.tender_shortfall`'s identity is now `sum(amount) = total +
 * sum(tip_amount)` because the tip moved off the sale and onto each tender (`tenders.tip_amount`).
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Raised by the settlement path — `settleSale`, and `recordSale`'s inline
     * `settlement:{kind:"immediate"}` half that calls the same code (design §4) — when at least one
     * tender still has `settledAt: null`. The settlement (its `sale_settlements` row and `tenders`)
     * is refused, so the sale stays unsettled and retryable rather than a settlement being recorded
     * against a payment that has not landed. Sale-centric: the settlement path holds a `saleId`,
     * never a `workingOrderId` (decision 2 — codes are never renamed once shipped, only re-shaped). */
    "sale.tender_unsettled": { tillId: string; saleId: string; unsettledCount: number };
    /** Raised by the settlement path (like `sale.tender_unsettled`, from both the inline and the
     * deferred half) when every tender has settled but `sum(amount) = total + sum(tip_amount)` does
     * not hold — the tip now lives per tender (`tenders.tip_amount`), not on the sale. Despite the
     * name it still fires in BOTH directions: `charged` under OR over `due`. Kept distinct from
     * `sale.tender_unsettled` so a translator can tell "still waiting on a payment" from "the
     * payments don't add up" apart. Sale-centric `saleId`, never `workingOrderId` — codes are never
     * renamed once shipped (design §4). */
    "sale.tender_shortfall": {
      tillId: string;
      saleId: string;
      due: string;
      charged: string;
    };
    /** Thrown by `recordSale` when `RecordSaleInput.seriesId` names no row in `invoice_series` —
     * either it never existed, or row-level security hid a series belonging to another tenant,
     * which reads identically from here (spec's own fail-closed shape for a cross-tenant probe). */
    "sale.series_not_found": { seriesId: string; tenantId: string };
    /** Thrown by `recordSale` when `RecordSaleInput.seriesId` names a real series, but one that
     * belongs to a DIFFERENT till than `RecordSaleInput.tillId`. A till may own several series,
     * but a series belongs to exactly one till — allocating from another till's series would let
     * two chains issue from one counter, which no constraint downstream can detect. */
    "sale.series_wrong_till": { seriesId: string; expected: string; actual: string };
    /** Thrown when a series is real and on the right till, but the WRONG KIND for the operation:
     * `recordSale` demands a `purpose='standard'` series, `recordCorrection` a
     * `purpose='rectificative'` one, and each throws this if handed the other. The domain concept
     * is "this series is not the right kind for this operation" — it models the mandatory
     * separation of corrective numbering (RD 1619/2012 art. 6.1.a, «en todo caso»): a rectificativa
     * draws from its own series, an ordinary sale never does. `expected`/`actual` carry the two
     * purposes so a translator can say which was wanted. Matches `sale.series_wrong_till`'s shape
     * on purpose (both are "the series you named is real but unusable here"). */
    "sale.series_wrong_purpose": { seriesId: string; expected: string; actual: string };
    /** Reserved for the constraint-violation translation `UNIQUE (tenant_id, series_id,
     * invoice_number)` produces when something outside the ordinary write path tries to reuse a
     * number that already reached a committed sale. Still not thrown anywhere in this package:
     * Task 17's own "burned number" test (`record-void.test.ts`) proves the constraint fires by
     * reading the raw SQLSTATE off the rejected INSERT directly (`captureError`/`pgErrorCode`),
     * the same way `record-sale.test.ts`'s "never reissues a number" test already does — neither
     * `recordSale` nor `recordVoid` catches and translates that violation into this code. */
    "sale.number_reused": { seriesId: string; invoiceNumber: number };
    /** Thrown by `recordVoid` (`./record-void.ts`) when `saleId` names no row in `sales` — either
     * it never existed, or row-level security hid a sale belonging to another tenant, which reads
     * identically from here (the same fail-closed shape `sale.series_not_found` already uses for
     * an analogous cross-tenant probe). An operational failure, not a fiscal one: NO FISCAL
     * CONDITION BLOCKS a void applies to a chain-integrity failure, never to "there is nothing
     * here to void". */
    "sale.not_found": { saleId: string };
    /** Thrown by `recordVoid` when `sale_voids.sale_id` already carries a row for this sale — the
     * translation of `sale_voids_sale_id_key`'s unique violation (`packages/db/src/schema/
     * sale-voids.ts`), which is the actual control against double-voiding. Also an operational
     * failure: a second void of an already-voided sale is a staff/UI error, not a fiscal
     * condition, and must not be confused with a chain-verification failure. */
    "sale.already_voided": { saleId: string };
    /** Thrown by `settleSale` when the sale is already settled. Three sources converge on this one
     * code (`packages/db/drizzle/0012_sale_settlement.sql`): the sequential retry is caught by the
     * prior SELECT, and a concurrent loser is caught at *whichever* insert it reaches — the
     * `sale_settlements` `UNIQUE (tenant_id, sale_id)` violation (`sale_settlements_sale_key`,
     * detected via `isUniqueViolation`) when it collides on the settlement row, OR the `tenders`
     * post-settlement trigger (SQLSTATE `WT002`, detected via a local predicate) when it inserts a
     * tender after the winner has committed. A constraint, not a prior SELECT, is the control for
     * the concurrent paths: two settlements both pass the check-then-insert and only one wins. The
     * UNIQUE case mirrors how `sale.already_voided` translates `sale_voids_sale_id_key` in
     * `./record-void.ts`. An operational failure — a sale settles once — not a fiscal one, so it
     * must not be confused with a chain-verification failure. */
    "sale.already_settled": { saleId: string };
    /** Thrown when the sale already carries a `sale_voids` row
     * (`packages/db/src/schema/sale-voids.ts`) — by `settleSale` (a voided sale can never be
     * settled) and by `recordCorrection` (a voided sale is corrected by nothing: a sale that
     * should never have existed is annulled, and correcting an already-annulled sale is a staff/UI
     * error). Neither state could arise before deferred settlement split payment from the fiscal
     * record (design §4). Distinct from `sale.already_voided` (a second void of the same sale):
     * this is a settlement or correction attempt on a sale that was voided, refused before the
     * settlement or corrective record is written. An operational failure, not a fiscal one. */
    "sale.voided": { saleId: string };
    /** Thrown by `recordSubstitution` (`./record-substitution.ts`) when a ticket named in an F3's
     * `substitutedSaleIds` already carries a `sale_substitutions` row — the translation of
     * `sale_substitutions_substituted_key`'s unique violation
     * (`packages/db/src/schema/sales.ts`), which is the actual control against exchanging one
     * ticket twice: were the same ticket substituted by two F3s, the underlying operation would
     * appear in two canje invoices. The unique `(tenant_id, substituted_sale_id)` — not the
     * INSERT's success — is what makes it impossible under concurrency (two callers both pass any
     * prior SELECT, only one passes the constraint), exactly as `sale_voids_sale_id_key` backs
     * `sale.already_voided`. A "substitute at most once" operational failure, not a fiscal one, so
     * it must not be confused with a chain-verification failure. Distinct from a DUPLICATE id
     * within one call's own `substitutedSaleIds` list, which `recordSubstitution` rejects earlier
     * as a caller precondition (a plain Error) before any row is written. */
    "sale.already_substituted": { saleId: string };
    /** Thrown-and-caught internally by `recordSale`/`recordVoid` (never crosses either function's
     * own boundary — it is constructed only to hand its `.code`/`.params` to `recordIncident`) to
     * wrap the `IntegrityIssue`s from a failed `FiscalBackend.checkIntegrity` call as a stable,
     * translatable incident: staff and support see one consistent code regardless of which
     * regime-specific issue kinds the module actually reported, with the module's own diagnostic
     * detail preserved underneath for support to read. */
    "chain.verification_failed": {
      tillId: string;
      /** All `IntegrityIssue`s from one failed `checkIntegrity` call, aggregated into a single
       * incident: the table-wide open-incident invariant (`incidents_open_dedup`) holds at most one
       * open incident per (tenant, till, code, sale), so a chain that fails multiple checks at once
       * records one incident carrying every issue rather than N same-key rows (of which the index
       * would keep only one). Each entry preserves the module's own diagnostic detail verbatim. */
      issues: Array<{
        /** The module's own issue code — e.g. `predecessor-hash-mismatch` — never itself a
         * translation key: it is regime-specific and not registered on this shared surface. */
        issueCode: string;
        recordId: string | null;
        /** The module's own structured params for that issue, carried verbatim — never
         * re-rendered into prose. */
        issueParams: Record<string, unknown>;
      }>;
    };
  }
}
